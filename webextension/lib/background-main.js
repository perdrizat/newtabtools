/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Background entry point (MODERNIZATION.md, Stage M, slice M5 — dissolves
 * the former webextension/background.js).
 *
 * manifest.json's `background` is `{"scripts": ["lib/background-main.js"],
 * "type": "module"}`. This file is now the ONE place every listener
 * registration is visible: the message dispatcher (lib/messages.js) is
 * registered here, and every other top-level `addListener`/init call that
 * used to live in background.js — webRequest × 3, webNavigation.onCompleted,
 * tabs.onActivated/onRemoved, runtime.onInstalled (reload sweep + the §3.1
 * action-sweep seed), runtime.onStartup (the other §3.1 seed), menus
 * creation + onShown, and the idle-cleanup listener — is registered directly
 * below, all still top-level synchronous on import (MV3 event-page respawn
 * hygiene; every registration must be live before the module's first
 * `await` could otherwise let a real event slip past an unregistered
 * listener).
 *
 * `common.js` and `prefs.js` stay dual-scope bridge files PERMANENTLY
 * (MODERNIZATION.md Decision 2: real `export` syntax would break their
 * classic-`<script>` page load in newTab.xhtml). They are still
 * side-effect-imported here so their top-level `globalThis.X = …`
 * assignments run before anything below needs `Prefs`/`Blocked`/`Filters`/
 * `NeverCapture`/`compareVersions` — reached, from this file and every other
 * lib/ module, ONLY through lib/platform.js's typed accessors (the
 * sanctioned Decision-2 read seam), never as a bare identifier. `tiles.js`
 * (the former `Tiles`/`Background` → `globalThis` bridge shim) is gone: it
 * existed solely so background.js's bare-identifier reads could reach
 * `Tiles`/`Background`, and background.js is dissolved — every consumer
 * (lib/messages.js, the webNavigation listener below) now does a real
 * `import { Tiles } from './tiles-store.js'` instead. Likewise every M2–M4
 * `globalThis.X = …` bridge assignment this file used to make (`withStore`,
 * `SAFE_PROTOCOLS`, the capture-pipeline exports, `makeZip`/`readZip`) is
 * gone — nothing left reads them as bare identifiers, since lib/messages.js
 * and this file both reach them via real imports. The remaining `globalThis`
 * surface after this slice is exactly the dual-scope bridge files' own
 * self-assignments (`Prefs`, `Blocked`, `Filters`, `NeverCapture` from
 * prefs.js; `compareVersions` from common.js) plus whatever the page itself
 * still needs from them — nothing this file assigns.
 */

import '../common.js';
import '../prefs.js';
import { registerMessageHandler } from './messages.js';
import { Tiles } from './tiles-store.js';
import { SAFE_PROTOCOLS, getTZDateString } from './constants.js';
import { withStore } from './db.js';
import {
	resetNetworkIdleTimer,
	disarmNetworkIdle,
	startCaptureSession,
	removeCaptureSession,
	addPendingCapture,
	takePendingCapture,
	removePendingCapture,
} from './capture.js';
import {
	getPrefs,
	getNeverCapture,
	enableAction,
	disableAction,
	getMessage,
	createMenuTolerant,
} from './platform.js';

const NEW_TAB_URL = chrome.runtime.getURL('newTab.xhtml');

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

registerMessageHandler();

// ---------------------------------------------------------------------------
// Version-check on startup
// ---------------------------------------------------------------------------

getPrefs().init().then(async function() {
	let previousVersion = getPrefs().version;
	let {version: currentVersion} = await browser.management.getSelf();
	if (previousVersion != currentVersion) {
		getPrefs().version = currentVersion;
	}
}).catch(function(event) {
	console.error(event);
});

// ---------------------------------------------------------------------------
// Network idle monitor. `resetNetworkIdleTimer` is wrapped in a closure at
// each call site (rather than passed directly) purely as a defensive habit
// carried over from background.js's own bridge-era version of this file —
// it's a real, already-resolved import binding now, so the wrapping is no
// longer load-bearing, but keeping the three listeners visually uniform with
// the rest of this file's registrations costs nothing.
// ---------------------------------------------------------------------------

chrome.webRequest.onBeforeRequest.addListener(function(details) { resetNetworkIdleTimer(details); }, {urls: ['<all_urls>']});
chrome.webRequest.onCompleted.addListener(function(details) { resetNetworkIdleTimer(details); }, {urls: ['<all_urls>']});
chrome.webRequest.onErrorOccurred.addListener(function(details) { resetNetworkIdleTimer(details); }, {urls: ['<all_urls>']});

// ---------------------------------------------------------------------------
// Navigation triggers
// ---------------------------------------------------------------------------

chrome.webNavigation.onCompleted.addListener(function(details) {
	if (details.frameId !== 0) {
		return;
	}

	if (!SAFE_PROTOCOLS.includes(new URL(details.url).protocol)) {
		disableAction(details.tabId);
		return;
	}

	enableAction(details.tabId);

	// Tiles.ensureReady() -> getGridTiles() awaits DB readiness via withStore
	// itself (M2) — on an event-page wake this can otherwise have fired
	// before the connection finished opening, which (pre-fix) permanently
	// lost this capture AND sticky-disabled the cache for the rest of the
	// respawn (lib/tiles-store.js §2.2).
	Tiles.ensureReady().then(async function({cache}) {
		if (cache.includes(details.url)) {
			// Never-capture privacy guard: skip both paths for listed hosts.
			if (getNeverCapture().matches(details.url)) {
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

// ---------------------------------------------------------------------------
// §3.1 (MV3 review, folded into MODERNIZATION.md M5): action-button sweep.
//
// The old per-respawn top-level `tabs.query({})` enable/disable sweep is
// replaced by a SEED that runs at `runtime.onInstalled` AND
// `runtime.onStartup` — not on every respawn. Per-tab action state (enabled/
// disabled) persists for the whole browser session once set, independent of
// the event page suspending and respawning; a fresh seed is only needed after
// an install/update (onInstalled) or a full browser restart (onStartup).
// Between those, `webNavigation.onCompleted` above already keeps each tab's
// action state current as the user navigates — that per-navigation
// maintenance was already top-level-listener-registered and unchanged by
// this slice.
// ---------------------------------------------------------------------------

/**
 * Seed the action button's enabled/disabled state for every currently open
 * tab. New-tab-page tabs are skipped (`continue`) rather than falling into
 * the disable branch — the action button is pointless on the new-tab page
 * itself.
 * @returns {Promise<void>}
 */
function seedActionSweep() {
	return browser.tabs.query({}).then(function(tabs) {
		for (let tab of tabs) {
			if (tab.url == NEW_TAB_URL) {
				continue;
			} else if (!SAFE_PROTOCOLS.includes(new URL(/** @type {string} */ (tab.url)).protocol)) {
				disableAction(/** @type {number} */ (tab.id));
			} else {
				enableAction(/** @type {number} */ (tab.id));
			}
		}
	}).catch(console.error);
}

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
				chrome.tabs.reload(/** @type {number} */ (tab.id));
			}
		}
	}).catch(console.error);
	seedActionSweep();
});

// `runtime.onStartup` fires once per browser launch (not per event-page
// respawn) — the other half of §3.1's seed, covering the case where the
// browser restarts without an install/update (so onInstalled never fires).
browser.runtime.onStartup.addListener(seedActionSweep);

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

createMenuTolerant({
	id: 'edit',
	title: getMessage('contextmenu_edit'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'pin',
	title: getMessage('contextmenu_pin'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'unpin',
	title: getMessage('contextmenu_unpin'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'block',
	title: getMessage('contextmenu_block'),
	contexts: ['link'],
});
createMenuTolerant({
	id: 'options',
	title: getMessage('contextmenu_options'),
	contexts: ['page'],
});

browser.menus.onShown.addListener(info => {
	let visible = /** @type {string} */ (info.pageUrl).startsWith(NEW_TAB_URL);
	for (let id of info.menuIds) {
		browser.menus.update(id, { visible });
	}
	browser.menus.refresh();
});

// ---------------------------------------------------------------------------
// Idle cleanup
// ---------------------------------------------------------------------------

/**
 * Delete every thumbnail whose `used` date is older than two weeks. Runs via
 * withStore(), so a caller (idleListener, below) that fires before the
 * connection is ready no longer needs its own guard.
 * @returns {Promise<void>}
 */
function cleanupThumbnails() {
	let expiry = getTZDateString(new Date(Date.now() - 1209600000)); // ms in two weeks.
	return withStore('thumbnails', 'readwrite', function(storeOrTx) {
		let store = /** @type {IDBObjectStore} */ (storeOrTx);
		return new Promise(function(resolve) {
			let index = store.index('used');
			let keyRange = IDBKeyRange.upperBound(expiry);

			index.openCursor(keyRange).onsuccess = function() {
				let cursor = this.result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				} else {
					resolve(undefined);
				}
			};
		});
	});
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
				cleanupThumbnails().catch(console.error);
				browser.storage.local.set({thumbnailCleanupLastRun: today}).catch(console.error);
			}
		}).catch(console.error);
	}
}

chrome.idle.onStateChanged.addListener(idleListener);
