/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals addPendingCapture, Background, disarmNetworkIdle, getTZDateString, makeZip, NeverCapture, Prefs, purgeNeverCaptureHost, readZip, removeCaptureSession, removePendingCapture, resetNetworkIdleTimer, SAFE_PROTOCOLS, startCaptureSession, takePendingCapture, Tiles, withStore */

Prefs.init().then(async function() {
	let previousVersion = Prefs.version;
	let {version: currentVersion} = await browser.management.getSelf();
	if (previousVersion != currentVersion) {
		Prefs.version = currentVersion;
	}
}).catch(function(event) {
	console.error(event);
});

// M2 (MODERNIZATION.md, "the readiness redesign"): the IndexedDB connection
// lifecycle (`initDB`/`waitForDB`/the raw `db` handle) moved to lib/db.js,
// which exposes only `withStore(storeNames, mode, fn)` — it awaits
// readiness itself, so no caller anywhere (including this file) ever holds
// or races a raw connection. `withStore` reaches this file via
// `globalThis.withStore`, bridged in lib/background-main.js (this file is
// still bridge-mode — no `import` syntax — until its own carve-up in
// M3/M5). The top-level eager `waitForDB()` call the old code ran in
// parallel with `Prefs.init()` is gone too: every handler below already
// awaits readiness via `withStore` before touching a store, so the eager
// warm-up was redundant — the first caller (whichever event wakes the page)
// now triggers the lazy open, same as before minus the one redundant kick.

// M3 (MODERNIZATION.md, "carve the auto-thumbnail capture pipeline into real
// ES modules"): the entire capture pipeline — network-idle watching,
// captureTab/fetchFaviconBlob, the A/B/C capture-session state machine, the
// storage.session-backed pendingCaptures queue, and purgeNeverCaptureHost —
// moved to lib/capture.js; the DOM Image/canvas resize + blankness-detection
// code (resizeThumbnail/isBlank/dataURLtoBlob) moved to
// lib/thumbnail-image.js, a narrow seam a service-worker/Chrome build can
// swap for an OffscreenCanvas implementation without this file changing at
// all. This file (still bridge-mode) reaches all of it as bare identifiers
// bridged onto `globalThis` by lib/background-main.js, same mechanism as
// `withStore`/`SAFE_PROTOCOLS` above. `getTZDateString` moved alongside
// (lib/capture.js's `pickAndStore` needs it) and is bridged back here too,
// since the message handlers/`cleanupThumbnails`/`idleListener` below still
// need it.

const NEW_TAB_URL = chrome.runtime.getURL('newTab.xhtml');

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
		// M2: Tiles.ensureReady() -> getGridTiles() reaches withStore directly
		// now, which awaits DB readiness itself — the explicit waitForDB()
		// wrap the pre-release fix added (audit §2.1: this is the toolbar
		// popup's sole wake message) collapses into that.
		Tiles.ensureReady().then(() => {
			sendResponse(Tiles.isPinned(message.url));
		}).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Tiles.getAllTiles':
		// Wire name frozen (MODERNIZATION.md Decision 3); internal method
		// renamed getAllTiles -> getGridTiles (M2, lib/tiles-store.js).
		Tiles.getGridTiles().then(function(tiles) {
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
		Tiles.clear().then(sendResponse);
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
		Background.getBackground().then(sendResponse).catch(function(event) {
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
			// withStore() guard (supersedes audit §2.1's waitForDB() wrap):
			// fire-and-forget write, so no sendResponse either way — just
			// don't reach the store before the connection is open.
			withStore('thumbnails', 'readwrite', function(store) {
				store.put({
					url,
					image,
					stored: today,
					used: today
				});
			}).catch(console.error);
		}
		return false;
	case 'Thumbnails.get':
		// withStore() guard: this fires on every new-tab-page load, so an
		// event-page wake races it against the still-opening connection.
		let map = new Map();
		withStore('thumbnails', 'readwrite', function(store) {
			return new Promise(function(resolve) {
				store.openCursor().onsuccess = function() {
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
						resolve();
					}
				};
			});
		}).then(function() {
			sendResponse(map);
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
		let faviconMap = new Map();
		withStore('thumbnails', 'readonly', function(store) {
			return new Promise(function(resolve) {
				store.openCursor().onsuccess = function() {
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
						resolve();
					}
				};
			});
		}).then(function() {
			sendResponse(faviconMap);
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
		let faviconsByHost = new Map();
		let wantedHosts = new Set(message.hosts || []);
		withStore('thumbnails', 'readonly', function(store) {
			return new Promise(function(resolve) {
				store.openCursor().onsuccess = function() {
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
						resolve();
					}
				};
			});
		}).then(function() {
			sendResponse(faviconsByHost);
		}).catch(function(event) {
			console.error(event);
			sendResponse(faviconsByHost);
		});
		return true;

	case 'Thumbnails.delete':
		// M2: previously an unguarded `globalThis.db.transaction(...)` call
		// (no waitForDB() wrap existed here) — withStore now closes that gap
		// too, as a side effect of every raw transaction site moving onto it.
		withStore('thumbnails', 'readwrite', function(store) {
			store.delete(message.url);
		}).catch(console.error);
		return false;

	case 'Thumbnails.purgeHost':
		// Validate: host must be a non-empty string.
		if (typeof message.host !== 'string' || !message.host) {
			sendResponse(null);
			return true;
		}
		// purgeNeverCaptureHost awaits DB readiness internally (via withStore).
		purgeNeverCaptureHost(message.host).then(sendResponse).catch(function(event) {
			console.error('Thumbnails.purgeHost failed:', event);
			sendResponse(null);
		});
		return true;

	case 'Thumbnails.clear':
		// Wipe every stored screenshot + cached favicon. Used by the drawer's
		// "Reset all settings" so a factory reset doesn't leave captured images
		// of visited sites on disk.
		withStore('thumbnails', 'readwrite', function(store) {
			return new Promise(function(resolve) {
				store.clear().onsuccess = function() {
					resolve();
				};
			});
		}).then(function() {
			sendResponse();
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
// Network idle monitor — networkIdleWatchers/armNetworkIdle/disarmNetworkIdle/
// resetNetworkIdleTimer moved to lib/capture.js in M3 (module-local in-memory
// Map, per MODERNIZATION.md's in-memory-state directive). The three listeners
// below stay here (this file keeps all listener registrations) and reach
// `resetNetworkIdleTimer` via the same globalThis bridge as `withStore` — but
// wrapped in a local closure rather than passed directly. `resetNetworkIdleTimer`
// is used at TOP LEVEL here (registered at module-evaluation time), before
// lib/background-main.js's own body (where the bridge assignment happens) can
// run — ES module evaluation always finishes evaluating an imported module
// (this file) before the importing module's (lib/background-main.js's) own
// top-level statements execute, so a bare top-level reference to
// `resetNetworkIdleTimer` here would throw ReferenceError. Deferring the
// lookup inside a closure, invoked only when a real webRequest event fires
// (long after evaluation completes), sidesteps that entirely —
// `disarmNetworkIdle`/`startCaptureSession`/etc. don't need this treatment
// because they're only ever read from inside other listener callbacks below
// (already lazy).
// ---------------------------------------------------------------------------

chrome.webRequest.onBeforeRequest.addListener(function(details) { resetNetworkIdleTimer(details); }, {urls: ['<all_urls>']});
chrome.webRequest.onCompleted.addListener(function(details) { resetNetworkIdleTimer(details); }, {urls: ['<all_urls>']});
chrome.webRequest.onErrorOccurred.addListener(function(details) { resetNetworkIdleTimer(details); }, {urls: ['<all_urls>']});

// ---------------------------------------------------------------------------
// Thumbnail helpers (resize/capture/blankness-detection) and the multi-stage
// (A/B/C) capture-session state machine moved to lib/capture.js (session glue)
// and lib/thumbnail-image.js (the DOM Image/canvas seam) in M3. This file
// reaches `startCaptureSession` from the 'Thumbnails.capture' message handler
// above and the webNavigation.onCompleted/tabs.onActivated listeners below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Navigation triggers
// ---------------------------------------------------------------------------

chrome.webNavigation.onCompleted.addListener(function(details) {
	if (details.frameId !== 0) {
		return;
	}

	if (!SAFE_PROTOCOLS.includes(new URL(details.url).protocol)) {
		// browser.action is promise-based in MV3; enable/disable on a since-
		// closed tab can reject, so this fire-and-forget call needs a catch.
		browser.action.disable(details.tabId).catch(console.error);
		return;
	}

	browser.action.enable(details.tabId).catch(console.error);

	// Tiles.ensureReady() -> getGridTiles() awaits DB readiness via withStore
	// itself now (M2) — on an event-page wake this can otherwise have fired
	// before the connection finished opening, which (pre-fix) permanently
	// lost this capture AND sticky-disabled the cache for the rest of the
	// respawn (tiles.js §2.2, now lib/tiles-store.js).
	Tiles.ensureReady().then(async function({cache}) {
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
// pendingCaptures: serialized storage.session read-modify-write — the
// pendingWriteChain/enqueuePendingCapturesWrite machinery and the
// addPendingCapture/takePendingCapture/removePendingCapture helpers built on
// it moved to lib/capture.js in M3. This file calls the bridged helpers from
// webNavigation.onCompleted (above) and the tabs.onActivated/onRemoved
// listeners below.
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(function(activeInfo) {
	takePendingCapture(activeInfo.tabId).then(function(pending) {
		if (pending) {
			startCaptureSession(activeInfo.tabId, pending.windowId, pending.url);
		}
	}).catch(console.error);
});

chrome.tabs.onRemoved.addListener(function(tabId) {
	removePendingCapture(tabId).catch(console.error);
	removeCaptureSession(tabId);
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
		} else if (!SAFE_PROTOCOLS.includes(new URL(tab.url).protocol)) {
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

/**
 * Delete every thumbnail whose `used` date is older than two weeks. Runs via
 * withStore(), so a caller (idleListener, below) that fires before the
 * connection is ready no longer needs its own guard (M2 closes this gap:
 * this call site was previously unguarded raw `globalThis.db` access).
 * @returns {Promise<void>} Resolves once the sweep finishes.
 */
function cleanupThumbnails() {
	let expiry = getTZDateString(new Date(Date.now() - 1209600000)); // ms in two weeks.
	return withStore('thumbnails', 'readwrite', function(store) {
		return new Promise(function(resolve) {
			let index = store.index('used');
			let keyRange = IDBKeyRange.upperBound(expiry);

			index.openCursor(keyRange).onsuccess = function() {
				let cursor = this.result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				} else {
					resolve();
				}
			};
		});
	});
}

// purgeNeverCaptureHost moved to lib/capture.js in M3 (thumbnails-domain, but
// driven entirely by the same never-capture/thumbnails-store machinery as
// the rest of that file) — bridged onto globalThis by lib/background-main.js,
// same as withStore/SAFE_PROTOCOLS. Reached from this file's
// 'Thumbnails.purgeHost' handler above and export.js's restore path.

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
				cleanupThumbnails().catch(console.error);
				browser.storage.local.set({thumbnailCleanupLastRun: today}).catch(console.error);
			}
		}).catch(console.error);
	}
}

chrome.idle.onStateChanged.addListener(idleListener);
