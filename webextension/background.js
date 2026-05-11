/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Background, makeZip, Prefs, readZip, Tiles */

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
			startCaptureSession(sender.tab.id, sender.tab.windowId, sender.tab.url);
		}
		return false;

	case 'Thumbnails.delete':
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').delete(message.url);
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

// ---------------------------------------------------------------------------
// Network idle monitor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Thumbnail helpers: resize, capture, blankness detection
// ---------------------------------------------------------------------------

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

/**
 * Capture the visible tab and return the data URL via callback.
 * Verifies the target tab is still active before capturing — if the user
 * switched tabs, captureVisibleTab would screenshot the wrong page.
 * Returns null if the tab is no longer active or captureVisibleTab fails.
 */
function captureTab(tabId, windowId, label, callback) {
	chrome.tabs.get(tabId, function(tab) {
		if (chrome.runtime.lastError || !tab || !tab.active) {
			console.log('[thumbnail]', label, '— skipped, tab', tabId, 'no longer active');
			callback(null);
			return;
		}
		chrome.tabs.captureVisibleTab(windowId, {format: 'png'}, function(dataURL) {
			if (!dataURL) {
				console.warn('[thumbnail]', label, '— captureVisibleTab returned empty',
					chrome.runtime.lastError ? chrome.runtime.lastError.message : '');
				callback(null);
				return;
			}
			console.log('[thumbnail]', label, '— got dataURL, length:', dataURL.length);
			callback(dataURL);
		});
	});
}

/**
 * Detect if a screenshot is blank (single-color).
 * Decodes onto a 50×50 canvas, samples all pixels.
 * Returns Promise<boolean>: true if >97% of pixels share the dominant color.
 */
function isBlank(dataURL) {
	return new Promise(function(resolve) {
		let img = new Image();
		img.onload = function() {
			let size = 50;
			let canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			let ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0, size, size);
			let data = ctx.getImageData(0, 0, size, size).data;
			let totalPixels = size * size;

			// Find dominant color (first pixel as seed).
			let dr = data[0], dg = data[1], db = data[2];
			let matchCount = 0;
			let tolerance = 5;

			for (let i = 0; i < data.length; i += 4) {
				if (Math.abs(data[i] - dr) <= tolerance &&
					Math.abs(data[i + 1] - dg) <= tolerance &&
					Math.abs(data[i + 2] - db) <= tolerance) {
					matchCount++;
				}
			}

			let ratio = matchCount / totalPixels;
			console.log('[thumbnail] isBlank — dominant: rgb(' + dr + ',' + dg + ',' + db + '), match:', (ratio * 100).toFixed(1) + '%');
			resolve(ratio > 0.97);
		};
		img.onerror = function() {
			resolve(true); // Treat decode failures as blank.
		};
		img.src = dataURL;
	});
}

// ---------------------------------------------------------------------------
// Multi-stage capture sessions
// ---------------------------------------------------------------------------

var captureSessions = new Map();
var pendingCaptures = new Map();

/**
 * Start a multi-stage capture session for a tab.
 *
 * All tabs (both active on load and activated from background):
 *   A — immediate capture
 *   B — 500ms later (SPA first meaningful paint)
 *   C — on network idle, capped at 2s (user may scroll)
 *   After C (or 2s timeout), pickAndStore selects the best capture.
 *
 * Background tabs that haven't been activated yet are deferred via
 * pendingCaptures — the full A/B/C flow starts when the user switches
 * to the tab, since SPAs often only render after activation.
 */
function startCaptureSession(tabId, windowId, url) {
	// Clean up any prior session for this tab (SPA navigations can trigger
	// multiple onCompleted events for the same tabId).
	let oldSession = captureSessions.get(tabId);
	if (oldSession) {
		oldSession.timers.forEach(function(t) { clearTimeout(t); });
		console.log('[thumbnail] startCaptureSession — cancelled', oldSession.timers.length, 'timers from prior session for tabId:', tabId);
	}
	captureSessions.delete(tabId);
	disarmNetworkIdle(tabId);

	let session = {
		url: url,
		windowId: windowId,
		captures: [],
		timers: [],
	};
	captureSessions.set(tabId, session);

	console.log('[thumbnail] startCaptureSession — tabId:', tabId, 'url:', url);

	// Capture A: immediate.
	captureTab(tabId, windowId, 'A', function(dataURL) {
		if (dataURL && captureSessions.get(tabId) === session) {
			session.captures.push({label: 'A', dataURL: dataURL});
			console.log('[thumbnail] A — stored in session for', url);
		}
	});

	// Capture B: 500ms later.
	let timerB = setTimeout(function() {
		if (captureSessions.get(tabId) !== session) {
			return;
		}
		captureTab(tabId, windowId, 'B', function(dataURL) {
			if (dataURL && captureSessions.get(tabId) === session) {
				session.captures.push({label: 'B', dataURL: dataURL});
				console.log('[thumbnail] B — stored in session for', url);
			}
		});
	}, 500);
	session.timers.push(timerB);

	// Capture C: on network idle, capped at 2s.
	// Hard deadline at 2s ensures we finalize even if network never goes idle.
	// Kept short because users frequently scroll within 2s.
	let finalized = false;

	let hardDeadline = setTimeout(function() {
		if (!finalized && captureSessions.get(tabId) === session) {
			finalized = true;
			disarmNetworkIdle(tabId);
			console.log('[thumbnail] C — hard deadline 2000ms, capturing + finalizing for', url);
			captureTab(tabId, windowId, 'C', function(dataURL) {
				if (dataURL && captureSessions.get(tabId) === session) {
					session.captures.push({label: 'C', dataURL: dataURL});
					console.log('[thumbnail] C — stored in session for', url);
				}
				pickAndStore(tabId);
			});
		}
	}, 2000);
	session.timers.push(hardDeadline);

	armNetworkIdle(tabId, function(elapsed) {
		if (finalized || captureSessions.get(tabId) !== session) {
			return;
		}
		if (elapsed <= 2000) {
			// Network idle within 2s — take Capture C, then finalize.
			captureTab(tabId, windowId, 'C', function(dataURL) {
				if (dataURL && captureSessions.get(tabId) === session) {
					session.captures.push({label: 'C', dataURL: dataURL});
					console.log('[thumbnail] C — stored in session for', url);
				}
				if (!finalized && captureSessions.get(tabId) === session) {
					finalized = true;
					clearTimeout(hardDeadline);
					pickAndStore(tabId);
				}
			});
		} else {
			// Network idle after 2s — skip C (user may have scrolled), finalize with A/B.
			console.log('[thumbnail] C — skipped, elapsed', elapsed + 'ms > 2000ms cutoff, url:', url);
			if (!finalized && captureSessions.get(tabId) === session) {
				finalized = true;
				clearTimeout(hardDeadline);
				pickAndStore(tabId);
			}
		}
	});
}

/**
 * Select the best capture from the session and write it to IDB.
 * Picks the latest non-blank capture. If all are blank, keeps the latest.
 */
function pickAndStore(tabId) {
	let session = captureSessions.get(tabId);
	if (!session || session.captures.length === 0) {
		console.log('[thumbnail] pickAndStore — no captures for tabId:', tabId);
		captureSessions.delete(tabId);
		return;
	}

	let url = session.url;
	let captures = session.captures;
	captureSessions.delete(tabId);

	// Clear any remaining timers.
	session.timers.forEach(function(t) { clearTimeout(t); });

	console.log('[thumbnail] pickAndStore — evaluating', captures.length, 'captures for', url);

	// Check blankness of all captures in parallel, then pick the best.
	Promise.all(captures.map(function(c) { return isBlank(c.dataURL); })).then(function(blankResults) {
		// Pick latest non-blank; fall back to latest overall.
		let bestIndex = captures.length - 1; // default: latest
		for (let i = captures.length - 1; i >= 0; i--) {
			if (!blankResults[i]) {
				bestIndex = i;
				break;
			}
		}

		let best = captures[bestIndex];
		console.log('[thumbnail] pickAndStore — selected', best.label,
			'(blank:', blankResults[bestIndex] + ') from', captures.map(function(c, i) { return c.label + (blankResults[i] ? '*' : ''); }).join(','),
			'for', url);

		chrome.storage.local.get({'thumbnailSize': 600}, function(prefs) {
			resizeThumbnail(best.dataURL, prefs.thumbnailSize).then(function(blob) {
				let today = getTZDateString();
				db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
					url: url,
					image: blob,
					stored: today,
					used: today,
				});
				console.log('[thumbnail] pickAndStore — stored', blob.size, 'bytes for', url);
			});
		});
	});
}

// ---------------------------------------------------------------------------
// Navigation triggers
// ---------------------------------------------------------------------------

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
					startCaptureSession(details.tabId, tab.windowId, details.url);
				} else {
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
		startCaptureSession(activeInfo.tabId, pending.windowId, pending.url);
	}
});

chrome.tabs.onRemoved.addListener(function(tabId) {
	pendingCaptures.delete(tabId);
	captureSessions.delete(tabId);
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
