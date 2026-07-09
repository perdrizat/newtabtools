/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Background, makeZip, NeverCapture, Prefs, readZip, Tiles */

Promise.all([
	Prefs.init(),
	waitForDB()
]).then(async function() {
	let previousVersion = Prefs.version;
	let {version: currentVersion} = await browser.management.getSelf();
	if (previousVersion != currentVersion) {
		Prefs.version = currentVersion;
	}
}).catch(function(event) {
	console.error(event);
});

var db;
// Memoizes the in-flight initDB() call so concurrent waitForDB() callers
// share one open request; cleared on settle (success or failure) so a LATER
// call retries from scratch. See waitForDB() below.
var dbInitPromise;
const NEW_TAB_URL = chrome.runtime.getURL('newTab.xhtml');

/**
 * Open (or reopen) the IndexedDB connection, resolving once `db` is set.
 * Attaches `onclose`/`onversionchange` handlers that clear `db` when the
 * connection drops — independent of event-page respawn (e.g. another
 * context bumping the DB version) — so `waitForDB()` knows to reopen it.
 * @returns {Promise<void>} Rejects with the triggering event on a genuine
 *   open failure (`onblocked`/`onerror`).
 */
function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 9);

		request.onsuccess = function(/* event */) {
			// console.log(event.type, event);
			db = this.result;
			db.onclose = function() {
				db = undefined;
			};
			db.onversionchange = function() {
				db.close();
				db = undefined;
			};
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

/**
 * Resolve once the IndexedDB connection is ready, (re)opening it if needed.
 * Concurrent callers dedupe onto the same in-flight `initDB()` call via
 * `dbInitPromise`; once that call settles the dedup is cleared, so a LATER
 * call — after a dropped connection (`onclose`/`onversionchange`) or a
 * failed open — retries `initDB()` from scratch instead of being doomed for
 * the lifetime of the context.
 * @returns {Promise<void>}
 */
function waitForDB() {
	if (db) {
		return Promise.resolve();
	}
	if (!dbInitPromise) {
		dbInitPromise = initDB().finally(function() {
			dbInitPromise = undefined;
		});
	}
	return dbInitPromise;
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
		// Wrapped in waitForDB() (audit §2.1): this is the toolbar popup's sole
		// wake message — on an event-page wake, db can still be opening when it
		// fires, and Tiles.ensureReady()/getAllTiles() reach db directly.
		waitForDB().then(() => Tiles.ensureReady()).then(() => {
			sendResponse(Tiles.isPinned(message.url));
		}).catch(function(event) {
			console.error(event);
			sendResponse(null);
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
		// waitForDB() guard (audit §2.1) — these three were the "missed by the
		// report" unguarded handlers; response shape unchanged (no sendResponse
		// on error, matching the pre-existing sibling pattern).
		waitForDB().then(() => Tiles.getTile(message.url)).then(sendResponse, console.error);
		return true;
	case 'Tiles.putTile':
		waitForDB().then(() => Tiles.putTile(message.tile)).then(sendResponse, console.error);
		return true;
	case 'Tiles.removeTile':
		waitForDB().then(() => Tiles.removeTile(message.tile)).then(sendResponse, console.error);
		return true;
	// Exposes the existing Tiles.clear() (single IDB objectStore.clear) over
	// the message protocol. Added to support hermetic E2E test cleanup, but
	// also useful for any future "reset all tiles" UI action.
	case 'Tiles.clear':
		waitForDB().then(() => Tiles.clear()).then(sendResponse);
		return true;
	case 'Tiles.pinTile':
		Tiles.pinTile(message.title, message.url).then(function(id) {
			// Broadcast so any open new-tab pages re-render the grid (Slice A
			// of the MV3 migration — replaces the extension.getViews()
			// loop; see pageMessageHandler in newTab.js). When no page is open
			// the promise rejects with "Receiving end does not exist" — swallow.
			browser.runtime.sendMessage({name: 'Page.updateGrid'}).catch(() => {});
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
		// Never-capture guard: refuse to store a thumbnail for a listed host.
		if (url && image && !NeverCapture.matches(url)) {
			// waitForDB() guard (audit §2.1): fire-and-forget write, so no
			// sendResponse either way — just don't reach db before it's open.
			waitForDB().then(function() {
				db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
					url,
					image,
					stored: today,
					used: today
				});
			}).catch(console.error);
		}
		return false;
	case 'Thumbnails.get':
		// waitForDB() guard (audit §2.1): this fires on every new-tab-page
		// load, so an event-page wake races it against the still-opening db.
		let map = new Map();
		waitForDB().then(function() {
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
		}).catch(function(event) {
			console.error(event);
			sendResponse(map);
		});
		return true;

	case 'Thumbnails.capture':
		if (sender.tab) {
			startCaptureSession(sender.tab.id, sender.tab.windowId, sender.tab.url);
		}
		return false;

	case 'Thumbnails.getFavicons':
		// Walk the thumbnails store and return a `url -> (Blob | string)` map.
		// A cached `data:` favicon comes back as a `favicon` Blob; a remote
		// favicon comes back as its `faviconUrl` string for the page to render
		// live via <img>. The page-side handler distinguishes the two.
		// waitForDB() guard (audit §2.1).
		let faviconMap = new Map();
		waitForDB().then(function() {
			db.transaction('thumbnails', 'readonly').objectStore('thumbnails').openCursor().onsuccess = function() {
				let cursor = this.result;
				if (cursor) {
					let row = cursor.value;
					if (message.urls.includes(row.url)) {
						if (row.favicon) {
							faviconMap.set(row.url, row.favicon);
						} else if (row.faviconUrl) {
							faviconMap.set(row.url, row.faviconUrl);
						}
					}
					cursor.continue();
				} else {
					sendResponse(faviconMap);
				}
			};
		}).catch(function(event) {
			console.error(event);
			sendResponse(faviconMap);
		});
		return true;

	case 'Thumbnails.getFaviconsByHost':
		// Like Thumbnails.getFavicons, but keyed by registrable host (leading
		// `www.` dropped) instead of exact URL. Favicons are per-site, so a
		// recently-closed deep article URL can reuse the favicon stored for any
		// page on the same site. Returns a `host -> (Blob | string)` map.
		// waitForDB() guard (audit §2.1).
		let faviconsByHost = new Map();
		let wantedHosts = new Set(message.hosts || []);
		waitForDB().then(function() {
			db.transaction('thumbnails', 'readonly').objectStore('thumbnails').openCursor().onsuccess = function() {
				let cursor = this.result;
				if (cursor) {
					let row = cursor.value;
					let host = null;
					try { host = new URL(row.url).hostname.replace(/^www\./, ''); } catch (e) { /* skip unparseable */ }
					if (host && wantedHosts.has(host) && !faviconsByHost.has(host)) {
						if (row.favicon) {
							faviconsByHost.set(host, row.favicon);
						} else if (row.faviconUrl) {
							faviconsByHost.set(host, row.faviconUrl);
						}
					}
					cursor.continue();
				} else {
					sendResponse(faviconsByHost);
				}
			};
		}).catch(function(event) {
			console.error(event);
			sendResponse(faviconsByHost);
		});
		return true;

	case 'Thumbnails.delete':
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').delete(message.url);
		return false;

	case 'Thumbnails.purgeHost':
		// Validate: host must be a non-empty string.
		if (typeof message.host !== 'string' || !message.host) {
			sendResponse(null);
			return true;
		}
		// purgeNeverCaptureHost awaits DB readiness internally.
		purgeNeverCaptureHost(message.host).then(sendResponse).catch(function(event) {
			console.error('Thumbnails.purgeHost failed:', event);
			sendResponse(null);
		});
		return true;

	case 'Thumbnails.clear':
		// Wipe every stored screenshot + cached favicon. Used by the drawer's
		// "Reset all settings" so a factory reset doesn't leave captured images
		// of visited sites on disk.
		waitForDB().then(function() {
			db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').clear().onsuccess = function() {
				sendResponse();
			};
		});
		return true;

	case 'Export:backup':
		makeZip().then(sendResponse);
		return true;
	case 'Import:restore':
		// Surface restore failures instead of swallowing the rejection — a
		// malformed backup must report an error, not fail silently.
		readZip(message.file).then(
			() => sendResponse({ ok: true }),
			err => {
				console.error('Import:restore failed:', err);
				sendResponse({ ok: false, error: String(err && err.message || err) });
			},
		);
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
	let watcher = {
		startTime: Date.now(),
		callback: callback,
		resetCount: 0,
		timer: setTimeout(function() {
			let elapsed = Date.now() - watcher.startTime;
			networkIdleWatchers.delete(tabId);
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
 * Capture the visible tab and return the data URL and favicon URL.
 * Verifies the target tab is still active before capturing — if the user
 * switched tabs, captureVisibleTab would screenshot the wrong page.
 * dataURL is null if the tab is gone/inactive or captureVisibleTab fails.
 * @param {number} tabId
 * @param {number} windowId
 * @returns {Promise<{dataURL: string|null, favIconUrl: string|null}>}
 */
async function captureTab(tabId, windowId) {
	// Firefox hides tabs.captureVisibleTab entirely when the extension lacks
	// (or has lost) the <all_urls> host permission it requires — the API
	// isn't merely denied, `typeof` is `undefined` (spike finding, 2026-07-09).
	// startCaptureSession() already guards on browser.permissions.contains()
	// before creating a session, but this is a second, independent guard for
	// any other caller (e.g. the action popup's Thumbnails.capture message).
	if (typeof browser.tabs.captureVisibleTab !== 'function') {
		return {dataURL: null, favIconUrl: null};
	}
	let tab;
	try {
		tab = await browser.tabs.get(tabId);
	} catch (ex) {
		// Tab is gone — same as the old callback's `runtime.lastError` check.
		return {dataURL: null, favIconUrl: null};
	}
	if (!tab.active) {
		return {dataURL: null, favIconUrl: null};
	}
	// `favIconUrl` can become available before or after the screenshot
	// is ready — grab whichever value is current at this moment.
	let favIconUrl = tab.favIconUrl || null;
	let dataURL;
	try {
		dataURL = await browser.tabs.captureVisibleTab(windowId, {format: 'png'});
	} catch (ex) {
		return {dataURL: null, favIconUrl};
	}
	return {dataURL: dataURL || null, favIconUrl};
}

/**
 * Decode a `data:` URL into a Blob without going through `fetch`.
 * The manifest CSP is `connect-src 'self' https://firefox.settings.services.mozilla.com`
 * (no wildcard — see audit/2026-05-31-csp-tightening.md), which blocks
 * `fetch('data:…')`. Many sites (Mozilla properties, Wikipedia, SPAs) inline
 * their favicon as a data URL, so we decode in-process. Returns `null` for
 * malformed input.
 */
function dataURLtoBlob(dataURL) {
	let m = /^data:([^,;]*)(;base64)?,(.*)$/.exec(dataURL);
	if (!m) {
		return null;
	}
	let mime = m[1] || 'application/octet-stream';
	let isBase64 = !!m[2];
	let payload = m[3];
	let bytes;
	try {
		let binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
	} catch (ex) {
		return null;
	}
	return new Blob([bytes], { type: mime });
}

/**
 * Turn a tab's `favIconUrl` into a cached favicon Blob, or `null`.
 *
 * Only `data:` URLs are cached here: they're decoded in-process (see
 * `dataURLtoBlob`), capped at ~64 KB so we don't bloat the IDB store. Remote
 * `http(s):` favicons are deliberately NOT fetched — that required a
 * `connect-src https:` wildcard in the manifest CSP (any-HTTPS read access),
 * which the 2026-05-31 review flagged. Instead they render live on the page as
 * `<img src="https://…/favicon.ico">`, governed by `img-src https:` (paint-only,
 * can't exfiltrate). See `audit/2026-05-31-csp-tightening.md`. So this returns
 * null for non-`data:` URLs and the page falls back to a live <img> via the
 * stored `favIconUrl` string.
 */
function fetchFaviconBlob(favIconUrl) {
	if (!favIconUrl || !favIconUrl.startsWith('data:')) {
		return Promise.resolve(null);
	}
	let blob = dataURLtoBlob(favIconUrl);
	if (!blob || blob.size === 0 || blob.size > 64 * 1024) {
		return Promise.resolve(null);
	}
	return Promise.resolve(blob);
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
 * `storage.session`'s `pendingCaptures` (an unbounded wait for tab
 * activation, which doesn't survive event-page suspension in-memory) —
 * the full A/B/C flow starts when the user switches to the tab, since
 * SPAs often only render after activation.
 *
 * Host permissions are user-revocable at runtime in MV3 (unlike MV2's
 * install-time-only grant), so this first confirms <all_urls> is still
 * held before creating any session — no timers, no watchers, if it's been
 * revoked. The check is async, so the granted case takes one extra
 * microtask/promise tick before `_startCaptureSession` runs; callers here
 * are all fire-and-forget, so this does not change observable ordering.
 * @param {number} tabId
 * @param {number} windowId
 * @param {string} url
 * @returns {Promise<void>}
 */
async function startCaptureSession(tabId, windowId, url) {
	let granted;
	try {
		granted = await browser.permissions.contains({origins: ['<all_urls>']});
	} catch (ex) {
		granted = false;
	}
	if (!granted) {
		return;
	}
	_startCaptureSession(tabId, windowId, url);
}

/**
 * Internal implementation of `startCaptureSession` — see there for the
 * capture-stage documentation. Split out so the permission guard above can
 * wrap it without duplicating the session-setup logic.
 * @param {number} tabId
 * @param {number} windowId
 * @param {string} url
 */
function _startCaptureSession(tabId, windowId, url) {
	// Privacy guard: never capture sites the user has opted-out of.
	// Accepted millisecond startup race (same class as Blocked/Filters): if the
	// list is updated concurrently with a navigation the guard may miss one
	// capture — acceptable given the infrequency of list mutations.
	if (NeverCapture.matches(url)) {
		return;
	}

	// Clean up any prior session for this tab (SPA navigations can trigger
	// multiple onCompleted events for the same tabId).
	let oldSession = captureSessions.get(tabId);
	if (oldSession) {
		oldSession.timers.forEach(function(t) { clearTimeout(t); });
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

	// Capture A: immediate.
	captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
		if (dataURL && captureSessions.get(tabId) === session) {
			session.captures.push({label: 'A', dataURL: dataURL});
		}
		if (favIconUrl && captureSessions.get(tabId) === session) {
			session.favIconUrl = favIconUrl;
		}
	});

	// Capture B: 500ms later.
	let timerB = setTimeout(function() {
		if (captureSessions.get(tabId) !== session) {
			return;
		}
		captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
			if (dataURL && captureSessions.get(tabId) === session) {
				session.captures.push({label: 'B', dataURL: dataURL});
			}
			if (favIconUrl && captureSessions.get(tabId) === session) {
				session.favIconUrl = favIconUrl;
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
			captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
				if (dataURL && captureSessions.get(tabId) === session) {
					session.captures.push({label: 'C', dataURL: dataURL});
				}
				if (favIconUrl && captureSessions.get(tabId) === session) {
					session.favIconUrl = favIconUrl;
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
			captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
				if (dataURL && captureSessions.get(tabId) === session) {
					session.captures.push({label: 'C', dataURL: dataURL});
				}
				if (favIconUrl && captureSessions.get(tabId) === session) {
					session.favIconUrl = favIconUrl;
				}
				if (!finalized && captureSessions.get(tabId) === session) {
					finalized = true;
					clearTimeout(hardDeadline);
					pickAndStore(tabId);
				}
			});
		} else {
			// Network idle after 2s — skip C (user may have scrolled), finalize with A/B.
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
		captureSessions.delete(tabId);
		return;
	}

	let url = session.url;

	// Re-check never-capture list. Closes the in-flight-session race: if the
	// user added the host to the list after the session started, we must not
	// store the capture that was taken before the list update landed.
	if (NeverCapture.matches(url)) {
		captureSessions.delete(tabId);
		return;
	}
	let favIconUrl = session.favIconUrl || null;
	let captures = session.captures;
	captureSessions.delete(tabId);

	// Clear any remaining timers.
	session.timers.forEach(function(t) { clearTimeout(t); });

	// Check blankness of all captures in parallel, then pick the best.
	// Fetch the favicon in parallel so we don't add latency to the
	// thumbnail finalisation.
	Promise.all([
		Promise.all(captures.map(function(c) { return isBlank(c.dataURL); })),
		fetchFaviconBlob(favIconUrl),
	]).then(async function(results) {
		let blankResults = results[0];
		let faviconBlob = results[1];

		// Pick latest non-blank; fall back to latest overall.
		let bestIndex = captures.length - 1; // default: latest
		for (let i = captures.length - 1; i >= 0; i--) {
			if (!blankResults[i]) {
				bestIndex = i;
				break;
			}
		}

		let best = captures[bestIndex];

		let prefs = await browser.storage.local.get({'thumbnailSize': 600});
		let blob = await resizeThumbnail(best.dataURL, prefs.thumbnailSize);
		let today = getTZDateString();
		let record = {
			url: url,
			image: blob,
			stored: today,
			used: today,
		};
		if (faviconBlob) {
			// data: favicon, decoded + cached as a Blob (offline-capable).
			record.favicon = faviconBlob;
		} else if (favIconUrl && /^https?:\/\//.test(favIconUrl)) {
			// Remote favicon: store the URL so the page can render it
			// live via <img> (no fetch / no connect-src wildcard).
			record.faviconUrl = favIconUrl;
		}
		// Re-guard db (audit §2.4): the isBlank/favicon/resize awaits above
		// give the connection time to drop via onclose/onversionchange —
		// waitForDB() re-opens it if so, instead of throwing on a stale
		// `db` reference and losing the freshly-captured thumbnail silently.
		await waitForDB();
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put(record);
	}).catch(console.error);
}

// ---------------------------------------------------------------------------
// Navigation triggers
// ---------------------------------------------------------------------------

chrome.webNavigation.onCompleted.addListener(function(details) {
	if (details.frameId !== 0) {
		return;
	}

	if (!['http:', 'https:', 'ftp:'].includes(new URL(details.url).protocol)) {
		// browser.action is promise-based in MV3; enable/disable on a since-
		// closed tab can reject, so this fire-and-forget call needs a catch.
		browser.action.disable(details.tabId).catch(console.error);
		return;
	}

	browser.action.enable(details.tabId).catch(console.error);

	// waitForDB() guard (audit §2.1): Tiles.ensureReady() reaches db directly
	// via getAllTiles() — on an event-page wake this can otherwise fire
	// before db finishes opening, which (pre-fix) permanently loses this
	// capture AND sticky-disables the cache for the rest of the respawn
	// (tiles.js §2.2). Inserted ahead of the existing chain, not restructured.
	waitForDB().then(() => Tiles.ensureReady()).then(async function({cache}) {
		if (cache.includes(details.url)) {
			// Never-capture privacy guard: skip both paths for listed hosts.
			if (NeverCapture.matches(details.url)) {
				return;
			}
			let tab = await browser.tabs.get(details.tabId);
			if (tab.incognito) {
				return;
			}
			if (tab.active) {
				startCaptureSession(details.tabId, tab.windowId, details.url);
			} else {
				// Unbounded wait for tab activation — doesn't survive event-page
				// suspension in-memory, so it lives in storage.session instead.
				await addPendingCapture(details.tabId, {
					url: details.url,
					windowId: tab.windowId,
				});
			}
		}
	}).catch(console.error);
});

// ---------------------------------------------------------------------------
// pendingCaptures: serialized storage.session read-modify-write (audit §2.3)
// ---------------------------------------------------------------------------

// Chains every pendingCaptures mutation onto one promise, so two concurrent
// callers (e.g. two `onCompleted` events for different background tabs)
// can't both read the same storage.session snapshot and clobber each other's
// write — the second caller's get() only starts once the first's set() has
// finished. Also dedups the three previously open-coded RMW blocks (§4.1).
var pendingWriteChain = Promise.resolve();

/**
 * Queue a pendingCaptures read-modify-write behind any already in flight.
 * @param {function(Record<string, {url: string, windowId: number}>): *} mutate
 *   Receives the current pendingCaptures object (mutate in place); its
 *   return value becomes this call's resolved value.
 * @returns {Promise<*>}
 */
function enqueuePendingCapturesWrite(mutate) {
	let result = pendingWriteChain.then(async function() {
		let {pendingCaptures} = await browser.storage.session.get('pendingCaptures');
		pendingCaptures = pendingCaptures || {};
		let returnValue = mutate(pendingCaptures);
		await browser.storage.session.set({pendingCaptures});
		return returnValue;
	});
	// Keep the chain alive even if this write failed, so a later caller still
	// gets a turn instead of every subsequent write rejecting forever.
	pendingWriteChain = result.catch(function(event) {
		console.error(event);
	});
	return result;
}

/**
 * Record a deferred capture for a background tab.
 * @param {number} tabId
 * @param {{url: string, windowId: number}} data
 * @returns {Promise<void>}
 */
function addPendingCapture(tabId, data) {
	return enqueuePendingCapturesWrite(function(pendingCaptures) {
		pendingCaptures[tabId] = data;
	});
}

/**
 * Remove and return the deferred capture for a tab, if any.
 * @param {number} tabId
 * @returns {Promise<{url: string, windowId: number}|undefined>}
 */
function takePendingCapture(tabId) {
	return enqueuePendingCapturesWrite(function(pendingCaptures) {
		let pending = pendingCaptures[tabId];
		if (pending) {
			delete pendingCaptures[tabId];
		}
		return pending;
	});
}

/**
 * Discard the deferred capture for a tab, if any (no return value needed —
 * used for cleanup on tab close).
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function removePendingCapture(tabId) {
	return enqueuePendingCapturesWrite(function(pendingCaptures) {
		delete pendingCaptures[tabId];
	});
}

chrome.tabs.onActivated.addListener(function(activeInfo) {
	takePendingCapture(activeInfo.tabId).then(function(pending) {
		if (pending) {
			startCaptureSession(activeInfo.tabId, pending.windowId, pending.url);
		}
	}).catch(console.error);
});

chrome.tabs.onRemoved.addListener(function(tabId) {
	removePendingCapture(tabId).catch(console.error);
	captureSessions.delete(tabId);
	disarmNetworkIdle(tabId);
});

/**
 * Reload open new-tab pages after an extension install/update, so a stale
 * page (running the previous version's script) gets the fresh one.
 *
 * This lives in `runtime.onInstalled` — NOT in top-level script code — on
 * purpose. Under MV3 the background is an event page that is torn down and
 * respawned on essentially every idle cycle (~30s), and top-level code
 * re-runs on every respawn. A top-level reload sweep therefore reloaded the
 * user's open new-tab pages continuously rather than once per install/
 * update, killing any open drawer/edit-mode state (UAT finding 2026-07-09:
 * observed 4 reloads in a single scenario). `runtime.onInstalled` fires
 * exactly once per install/update/browser-update, matching the original
 * (MV2, persistent-background) intent.
 */
browser.runtime.onInstalled.addListener(function() {
	browser.tabs.query({}).then(function(tabs) {
		for (let tab of tabs) {
			if (tab.url == NEW_TAB_URL) {
				chrome.tabs.reload(tab.id);
			}
		}
	}).catch(console.error);
});

// Per-respawn action-button sweep: harmless (and useful) to re-run every
// time the event page wakes, unlike the reload above. New-tab-page tabs are
// skipped (`continue`) rather than falling into the disable branch below —
// the action button is pointless on the new-tab page itself, and this
// preserves the pre-MV3 behavior where the (now-removed) reload branch
// exited the loop iteration before reaching the enable/disable check.
browser.tabs.query({}).then(function(tabs) {
	for (let tab of tabs) {
		if (tab.url == NEW_TAB_URL) {
			continue;
		} else if (!['http:', 'https:', 'ftp:'].includes(new URL(tab.url).protocol)) {
			browser.action.disable(tab.id).catch(console.error);
		} else {
			browser.action.enable(tab.id).catch(console.error);
		}
	}
}).catch(console.error);

/**
 * Register a context menu item, tolerating the "already exists" duplicate
 * error. Event-page top-level code re-runs on every MV3 respawn, so these
 * `create()` calls fire repeatedly for ids that already exist; Firefox
 * reports that via `runtime.lastError` inside the optional create callback
 * rather than throwing. Reading it here "checks" it so it doesn't surface
 * as an unhandled error — a duplicate on respawn is expected, not worth
 * logging.
 * @param {object} props browser.menus.create() properties (id/title/contexts).
 */
function createMenuTolerant(props) {
	browser.menus.create(props, function() {
		return browser.runtime.lastError;
	});
}

createMenuTolerant({
	id: 'edit',
	title: chrome.i18n.getMessage('contextmenu_edit'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'pin',
	title: chrome.i18n.getMessage('contextmenu_pin'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'unpin',
	title: chrome.i18n.getMessage('contextmenu_unpin'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'block',
	title: chrome.i18n.getMessage('contextmenu_block'),
	contexts: ['link'],
});
createMenuTolerant({
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

/**
 * Purge all captured data for a single host pattern from both the thumbnails
 * and tiles stores.
 *
 * Two sequential cursor passes:
 *   1. thumbnails — delete every record whose URL matches `pattern`.
 *   2. tiles — for every matching tile that holds an auto-captured thumbnail
 *      (`imageIsThumbnail: true`), strip the `image` and `imageIsThumbnail`
 *      fields and update the record in place (the tile itself is kept).
 *      Tiles with a custom image (no `imageIsThumbnail`) are untouched.
 *
 * Unparseable URLs in either store are skipped silently (same idiom used by
 * `Thumbnails.getFaviconsByHost` at background.js:237). Host matching keys on
 * URL.hostname (no port) — the canonical never-capture entry is a port-less
 * host, so a listed `example.com` also covers `example.com:8443`.
 *
 * Awaits DB readiness internally so callers on the restore path (readZip, which
 * runs without a preceding waitForDB) can't crash on an uninitialised db.
 *
 * @param {string} pattern  A NeverCapture host pattern, e.g. '.example.com' or 'example.com'.
 * @returns {Promise<{thumbnails: number, tiles: number}>}
 */
function purgeNeverCaptureHost(pattern) {
	return waitForDB().then(() => new Promise(function(resolve) {
		let thumbCount = 0;
		let tileCount = 0;

		// Pass 1: thumbnails store — delete matching records.
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').openCursor().onsuccess = function() {
			let cursor = this.result;
			if (cursor) {
				let row = cursor.value;
				let host = null;
				try { host = new URL(row.url).hostname; } catch (e) { /* skip unparseable */ }
				if (host && NeverCapture.hostMatchesPattern(host, pattern)) {
					cursor.delete();
					thumbCount++;
				}
				cursor.continue();
			} else {
				// Pass 2: tiles store — strip auto-thumbnail image from matching tiles.
				db.transaction('tiles', 'readwrite').objectStore('tiles').openCursor().onsuccess = function() {
					let tileCursor = this.result;
					if (tileCursor) {
						let row = tileCursor.value;
						let host = null;
						try { host = new URL(row.url).hostname; } catch (e) { /* skip unparseable */ }
						if (host && NeverCapture.hostMatchesPattern(host, pattern)
							&& row.image && row.imageIsThumbnail) {
							delete row.image;
							delete row.imageIsThumbnail;
							tileCursor.update(row);
							tileCount++;
						}
						tileCursor.continue();
					} else {
						resolve({ thumbnails: thumbCount, tiles: tileCount });
					}
				};
			}
		};
	}));
}

/**
 * One-shot-per-respawn idle listener. `cleanupThumbnails()` itself is
 * guarded to run at most once per day (`thumbnailCleanupLastRun` in
 * `storage.local`) — the listener re-arms on every MV3 event-page respawn
 * (top-level code re-runs), so without the date guard it would run once per
 * respawn instead of once per day.
 * @param {string} state chrome.idle.onStateChanged state ('idle', 'active', 'locked').
 */
function idleListener(state) {
	if (state == 'idle') {
		chrome.idle.onStateChanged.removeListener(idleListener);
		let today = getTZDateString();
		browser.storage.local.get({thumbnailCleanupLastRun: null}).then(function(result) {
			if (result.thumbnailCleanupLastRun !== today) {
				cleanupThumbnails();
				browser.storage.local.set({thumbnailCleanupLastRun: today}).catch(console.error);
			}
		}).catch(console.error);
	}
}

chrome.idle.onStateChanged.addListener(idleListener);
