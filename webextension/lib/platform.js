/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Browser-capability layer (MODERNIZATION.md, Stage M, slice M5).
 *
 * This is the file a Chrome/stage-3 (service-worker) port forks: every
 * browser-API surface the background touches that differs across engines —
 * permission checks, capture-API presence, action enable/disable, i18n,
 * duplicate-tolerant menu creation, and the cross-page broadcast helper —
 * lives here behind a narrow, typed function. Keep it THIN: this module
 * holds capability WRAPPERS, not business logic (that stays in
 * lib/capture.js, lib/messages.js, lib/background-main.js, etc.).
 *
 * PAGE_MODULES.md P3 (the dual-scope endgame) retired the Decision-2 bridge
 * accessor this file used to hold: `getPrefs()`/`getBlocked()`/
 * `getFilters()`/`getNeverCapture()`/`getCompareVersions()` are gone. The
 * background's read path (lib/background-main.js and every other lib
 * consumer) now does a real `import { Prefs, Blocked, Filters, NeverCapture }
 * from '../prefs.js'` / `import { compareVersions } from '../common.js'`
 * instead — those two files' `export`s are real now, only their
 * `globalThis.X = …` bridge assignments survive (permanently — the page
 * still needs them; see prefs.js/common.js's own doc comments).
 */

// ---------------------------------------------------------------------------
// Capability wrappers
// ---------------------------------------------------------------------------

/**
 * Whether the `<all_urls>` host permission is currently held. User-revocable
 * at runtime under MV3 (unlike MV2's install-time-only grant) — callers must
 * check before relying on any all-URLs-gated API. Never rejects: a lookup
 * failure is treated the same as "not granted".
 * @returns {Promise<boolean>}
 */
export function hasAllUrlsPermission() {
	return browser.permissions.contains({origins: ['<all_urls>']}).catch(() => false);
}

/**
 * Firefox hides `tabs.captureVisibleTab` entirely — not merely denies it,
 * `typeof` is `undefined` — when the extension lacks (or has lost) the
 * `<all_urls>` host permission the API requires (spike finding, 2026-07-09).
 * @returns {boolean}
 */
export function isCaptureAvailable() {
	return typeof browser.tabs.captureVisibleTab === 'function';
}

/**
 * Enable the toolbar action for a tab. Fire-and-forget: enabling/disabling a
 * since-closed tab can reject, so failures are logged, never thrown.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function enableAction(tabId) {
	return browser.action.enable(tabId).catch(console.error);
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function disableAction(tabId) {
	return browser.action.disable(tabId).catch(console.error);
}

/**
 * @param {string} key
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function getMessage(key, substitutions) {
	return chrome.i18n.getMessage(key, substitutions);
}

/**
 * Register a context menu item, tolerating the "already exists" duplicate
 * error. Event-page top-level code re-runs on every MV3 respawn, so these
 * `create()` calls fire repeatedly for ids that already exist; Firefox
 * reports that via `runtime.lastError` inside the optional create callback
 * rather than throwing. Reading it here "checks" it so it doesn't surface as
 * an unhandled error — a duplicate on respawn is expected, not worth
 * logging.
 * @param {object} props browser.menus.create() properties (id/title/contexts).
 * @returns {void}
 */
export function createMenuTolerant(props) {
	browser.menus.create(props, function() {
		return browser.runtime.lastError;
	});
}

/**
 * Fire-and-forget broadcast to every open extension page. When no page is
 * open the promise rejects with "Receiving end does not exist" — swallowed,
 * same as every call site this consolidates (the former background.js
 * pinTile handler, lib/backup.js's former one-off `notifyRestoreComplete`).
 * @param {string} name
 * @returns {Promise<void>}
 */
export function broadcastToPages(name) {
	return browser.runtime.sendMessage({name}).catch(() => {});
}
