/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Background, compareVersions, makeZip, Prefs, readZip, Tiles */

Promise.all([
	Prefs.init(),
	initDB()
]).then(function() {
	if (initDB.waitingQueue) {
		for (let waiting of initDB.waitingQueue) {
			waiting.resolve.call();
		}
		delete initDB.waitingQueue;
	}

	let previousVersion = Prefs.version;
	chrome.management.getSelf(function({version: currentVersion}) {
		if (previousVersion != currentVersion) {
			Prefs.version = currentVersion;
			if (previousVersion != -1 &&
					compareVersions(currentVersion, previousVersion) > 0 &&
					(currentVersion.includes('b') || parseFloat(currentVersion, 10) != parseFloat(previousVersion, 10))) {
				Prefs.versionLastUpdate = new Date();
			}
		}
	});
}).catch(function(event) {
	console.error(event);
	db = 'broken';
	if (initDB.waitingQueue) {
		for (let waiting of initDB.waitingQueue) {
			waiting.reject.call();
		}
		delete initDB.waitingQueue;
	}
});

var db;
const NEW_TAB_URL = chrome.runtime.getURL('newTab.xhtml');

function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 9);

		request.onsuccess = function(/* event */) {
			// console.log(event.type, event);
			db = this.result;
			resolve();
		};

		request.onblocked = request.onerror = function(event) {
			reject(event);
		};

		request.onupgradeneeded = function(/* event */) {
			// console.log(event.type, event);
			db = this.result;

			if (!db.objectStoreNames.contains('tiles')) {
				db.createObjectStore('tiles', { autoIncrement: true, keyPath: 'id' });
			}
			if (!this.transaction.objectStore('tiles').indexNames.contains('url')) {
				this.transaction.objectStore('tiles').createIndex('url', 'url');
			}

			if (!db.objectStoreNames.contains('background')) {
				db.createObjectStore('background', { autoIncrement: true });
			}

			if (!db.objectStoreNames.contains('thumbnails')) {
				db.createObjectStore('thumbnails', { keyPath: 'url' });
			}
			if (!this.transaction.objectStore('thumbnails').indexNames.contains('used')) {
				this.transaction.objectStore('thumbnails').createIndex('used', 'used');
			}
		};
	});
}

function waitForDB() {
	return new Promise(function(resolve, reject) {
		if (db) {
			if (db == 'broken') {
				reject('Database connection failed.');
			} else {
				resolve();
			}
			return;
		}

		initDB.waitingQueue = initDB.waitingQueue || [];
		initDB.waitingQueue.push({resolve, reject});
	});
}

function getTZDateString(date = new Date()) {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(p => p.toString().padStart(2, '0')).join('-');
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	// Sender validation. Only the extension's own pages may message the
	// background. The MV2 manifest does not declare `externally_connectable`,
	// so legitimate senders always carry `sender.id === browser.runtime.id`.
	// Anything else — including a content script in a hostile page reached
	// via `<all_urls>` — gets dropped here. See §2.4 of
	// audit/2026-05-04-security-review.md.
	if (!sender || sender.id !== browser.runtime.id) {
		return false;
	}

	let today = getTZDateString();

	switch (message.name) {
	case 'Tiles.isPinned':
		Tiles.ensureReady().then(() => {
			sendResponse(Tiles.isPinned(message.url));
		});
		return true;
	case 'Tiles.getAllTiles':
		waitForDB().then(function() {
			return Tiles.getAllTiles();
		}).then(function(tiles) {
			sendResponse({ tiles, list: Tiles._list });
		}).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Tiles.getTile':
		Tiles.getTile(message.url).then(sendResponse, console.error);
		return true;
	case 'Tiles.putTile':
		Tiles.putTile(message.tile).then(sendResponse, console.error);
		return true;
	case 'Tiles.removeTile':
		Tiles.removeTile(message.tile).then(sendResponse, console.error);
		return true;
	// Exposes the existing Tiles.clear() (single IDB objectStore.clear) over
	// the message protocol. Added to support hermetic E2E test cleanup, but
	// also useful for any future "reset all tiles" UI action.
	case 'Tiles.clear':
		waitForDB().then(() => Tiles.clear()).then(sendResponse);
		return true;
	case 'Tiles.pinTile':
		Tiles.pinTile(message.title, message.url).then(function(id) {
			for (let view of chrome.extension.getViews()) {
				if (view.location.pathname == '/newTab.xhtml') {
					view.Updater.updateGrid();
				}
			}
			sendResponse(id);
		}, console.error);
		return true;

	case 'Background.getBackground':
		waitForDB().then(function() {
			return Background.getBackground();
		}).then(sendResponse).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Background.setBackground':
		Background.setBackground(message.file).then(sendResponse);
		return true;

	case 'Thumbnails.save':
		let {url, image} = message;
		if (url && image) {
			db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
				url,
				image,
				stored: today,
				used: today
			});
		}
		return false;
	case 'Thumbnails.get':
		let map = new Map();
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').openCursor().onsuccess = function() {
			let cursor = this.result;
			if (cursor) {
				let thumb = cursor.value;
				if (message.urls.includes(thumb.url)) {
					map.set(thumb.url, thumb.image);
					if (thumb.used != today) {
						thumb.used = today;
						cursor.update(thumb);
					}
				}
				cursor.continue();
			} else {
				sendResponse(map);
			}
		};
		return true;

	case 'Thumbnails.capture':
		if (sender.tab) {
			captureAndStore(sender.tab.id, sender.tab.windowId, sender.tab.url);
		}
		return false;

	case 'Export:backup':
		makeZip().then(sendResponse());
		return true;
	case 'Import:restore':
		readZip(message.file).then(sendResponse());
		return true;
	}
	return false;
});

var networkIdleWatchers = new Map();

function armNetworkIdle(tabId, callback) {
	disarmNetworkIdle(tabId);
	console.log('[thumbnail] armNetworkIdle — tabId:', tabId);
	let watcher = {
		startTime: Date.now(),
		callback: callback,
		resetCount: 0,
		timer: setTimeout(function() {
			let elapsed = Date.now() - watcher.startTime;
			networkIdleWatchers.delete(tabId);
			console.log('[thumbnail] networkIdle fired — tabId:', tabId, 'elapsed:', elapsed + 'ms', 'resets:', watcher.resetCount);
			callback(elapsed);
		}, 2000),
	};
	networkIdleWatchers.set(tabId, watcher);
}

function disarmNetworkIdle(tabId) {
	let watcher = networkIdleWatchers.get(tabId);
	if (watcher) {
		clearTimeout(watcher.timer);
		networkIdleWatchers.delete(tabId);
	}
}

function resetNetworkIdleTimer(details) {
	let watcher = networkIdleWatchers.get(details.tabId);
	if (watcher) {
		watcher.resetCount++;
		clearTimeout(watcher.timer);
		watcher.timer = setTimeout(function() {
			let elapsed = Date.now() - watcher.startTime;
			networkIdleWatchers.delete(details.tabId);
			console.log('[thumbnail] networkIdle fired — tabId:', details.tabId, 'elapsed:', elapsed + 'ms', 'resets:', watcher.resetCount);
			watcher.callback(elapsed);
		}, 2000);
	}
}

chrome.webRequest.onBeforeRequest.addListener(resetNetworkIdleTimer, {urls: ['<all_urls>']});
chrome.webRequest.onCompleted.addListener(resetNetworkIdleTimer, {urls: ['<all_urls>']});
chrome.webRequest.onErrorOccurred.addListener(resetNetworkIdleTimer, {urls: ['<all_urls>']});

function resizeThumbnail(dataURL, targetWidth) {
	return new Promise(function(resolve) {
		let img = new Image();
		img.onload = function() {
			let scale = targetWidth / img.width;
			let canvas = document.createElement('canvas');
			canvas.width = targetWidth;
			canvas.height = Math.min(targetWidth, scale * img.height);
			let ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			canvas.toBlob(resolve);
		};
		img.src = dataURL;
	});
}

function captureAndStore(tabId, windowId, url, label) {
	console.log('[thumbnail]', label || 'capture', '— tabId:', tabId, 'url:', url);
	chrome.tabs.captureVisibleTab(windowId, {format: 'png'}, function(dataURL) {
		if (!dataURL) {
			console.warn('[thumbnail]', label || 'capture', '— captureVisibleTab returned empty for', url,
				chrome.runtime.lastError ? chrome.runtime.lastError.message : '');
			return;
		}
		console.log('[thumbnail]', label || 'capture', '— got dataURL, length:', dataURL.length, 'for', url);
		chrome.storage.local.get({'thumbnailSize': 600}, function(prefs) {
			resizeThumbnail(dataURL, prefs.thumbnailSize).then(function(blob) {
				let today = getTZDateString();
				db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
					url,
					image: blob,
					stored: today,
					used: today,
				});
				console.log('[thumbnail]', label || 'capture', '— stored', blob.size, 'bytes for', url);
			});
		});
	});
}

var pendingCaptures = new Map();

chrome.webNavigation.onCompleted.addListener(function(details) {
	console.log('[thumbnail] onCompleted — frameId:', details.frameId, 'url:', details.url);
	if (details.frameId !== 0) {
		return;
	}

	if (!['http:', 'https:', 'ftp:'].includes(new URL(details.url).protocol)) {
		chrome.browserAction.disable(details.tabId);
		return;
	}

	chrome.browserAction.enable(details.tabId);

	// We might not have called getAllTiles yet.
	Tiles.ensureReady().then(function({cache}) {
		console.log('[thumbnail] cache check — url:', details.url, 'inCache:', cache.includes(details.url), 'cacheSize:', cache.length);
		if (cache.includes(details.url)) {
			chrome.tabs.get(details.tabId, function(tab) {
				if (tab.incognito) {
					console.log('[thumbnail] skipped — incognito tab');
					return;
				}
				console.log('[thumbnail] tab state — active:', tab.active, 'tabId:', details.tabId);
				if (tab.active) {
					// Capture A: immediate screenshot (page at top, may be incomplete)
					captureAndStore(details.tabId, tab.windowId, details.url, 'A');
					// Arm network idle for Capture B (fully rendered replacement)
					armNetworkIdle(details.tabId, function(elapsed) {
						if (elapsed <= 5000) {
							// Page idle within 5s — user likely hasn't scrolled
							captureAndStore(details.tabId, tab.windowId, details.url, 'B');
						} else {
							console.log('[thumbnail] Capture B skipped — elapsed', elapsed + 'ms > 5000ms cutoff, url:', details.url);
						}
					});
				} else {
					// Tab not active — captureVisibleTab won't work.
					// Mark as pending; capture on tabs.onActivated.
					pendingCaptures.set(details.tabId, {
						url: details.url,
						windowId: tab.windowId,
					});
				}
			});
		}
	}).catch(console.error);
});

chrome.tabs.onActivated.addListener(function(activeInfo) {
	let pending = pendingCaptures.get(activeInfo.tabId);
	if (pending) {
		pendingCaptures.delete(activeInfo.tabId);
		captureAndStore(activeInfo.tabId, pending.windowId, pending.url);
		armNetworkIdle(activeInfo.tabId, function(elapsed) {
			if (elapsed <= 5000) {
				captureAndStore(activeInfo.tabId, pending.windowId, pending.url);
			}
		});
	}
});

chrome.tabs.onRemoved.addListener(function(tabId) {
	pendingCaptures.delete(tabId);
	disarmNetworkIdle(tabId);
});

chrome.tabs.query({}, function(tabs) {
	for (let tab of tabs) {
		if (tab.url == NEW_TAB_URL) {
			chrome.tabs.reload(tab.id);
		} else if (!['http:', 'https:', 'ftp:'].includes(new URL(tab.url).protocol)) {
			chrome.browserAction.disable(tab.id);
		} else {
			chrome.browserAction.enable(tab.id);
		}
	}
});

browser.menus.create({
	id: 'edit',
	title: chrome.i18n.getMessage('contextmenu_edit'),
	contexts: ['link'],
});
browser.menus.create({
	id: 'pin',
	title: chrome.i18n.getMessage('contextmenu_pin'),
	contexts: ['link'],
});
browser.menus.create({
	id: 'unpin',
	title: chrome.i18n.getMessage('contextmenu_unpin'),
	contexts: ['link'],
});
browser.menus.create({
	id: 'block',
	title: chrome.i18n.getMessage('contextmenu_block'),
	contexts: ['link'],
});
browser.menus.create({
	id: 'options',
	title: chrome.i18n.getMessage('contextmenu_options'),
	contexts: ['page'],
});

browser.menus.onShown.addListener(info => {
	let visible = info.pageUrl.startsWith(NEW_TAB_URL);
	for (let id of info.menuIds) {
		browser.menus.update(id, { visible });
	}
	browser.menus.refresh();
});

function cleanupThumbnails() {
	let expiry = getTZDateString(new Date(Date.now() - 1209600000)); // ms in two weeks.
	let index = db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').index('used');
	let keyRange = IDBKeyRange.upperBound(expiry);

	index.openCursor(keyRange).onsuccess = function() {
		let cursor = this.result;
		if (cursor) {
			cursor.delete();
			cursor.continue();
		}
	};
}

function idleListener(state) {
	if (state == 'idle') {
		chrome.idle.onStateChanged.removeListener(idleListener);
		cleanupThumbnails();
	}
}

chrome.idle.onStateChanged.addListener(idleListener);
