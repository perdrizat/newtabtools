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
 * Also home to the Decision-2 bridge accessor (MODERNIZATION.md): the
 * `Prefs`/`Blocked`/`Filters`/`NeverCapture`/`compareVersions` globals live on
 * `globalThis`, put there by prefs.js/common.js's own top-level
 * `globalThis.X = …` assignments (those two files are dual-scope — loaded as
 * a classic `<script>` by the page AND side-effect-imported by
 * lib/background-main.js; real `export` syntax would break their page load —
 * see prefs.js/common.js's own doc comments). Every OTHER lib module that
 * needs one of these five reads it through exactly one of the typed getters
 * below rather than a bare identifier of its own — this is the ONLY
 * sanctioned read site for a lib module. The getters still do an untyped
 * `globalThis` read underneath (there is no other way to reach a global that
 * was never `export`ed), but that read now happens in exactly one place per
 * global, decorated with the type its callers actually rely on, instead of a
 * `/* globals X *\/` ESLint directive scattered across the lib/ tree.
 *
 * This accessor retires the day the page itself goes modular (out of scope
 * for this arc — see MODERNIZATION.md "Out of scope"): once prefs.js/
 * common.js can use real `export`, every caller here switches to a real
 * `import` and this file loses these five functions.
 */

/**
 * @typedef {Object} PrefsGlobal
 * @property {number} rows
 * @property {number} columns
 * @property {boolean} history
 * @property {string|number} version
 * @property {() => Promise<void>} init
 */

/**
 * @typedef {Object} BlockedGlobal
 * @property {(url: string) => boolean} isBlocked
 */

/**
 * @typedef {Object} FiltersGlobal
 * @property {() => Record<string, number>} getList
 * @property {(input: string) => string} normalizeHost
 */

/**
 * @typedef {Object} NeverCaptureGlobal
 * @property {(url: string) => boolean} matches
 * @property {(host: string, pattern: string) => boolean} hostMatchesPattern
 */

/** @returns {PrefsGlobal} */
export function getPrefs() {
	return /** @type {PrefsGlobal} */ (/** @type {any} */ (globalThis).Prefs);
}

/** @returns {BlockedGlobal} */
export function getBlocked() {
	return /** @type {BlockedGlobal} */ (/** @type {any} */ (globalThis).Blocked);
}

/** @returns {FiltersGlobal} */
export function getFilters() {
	return /** @type {FiltersGlobal} */ (/** @type {any} */ (globalThis).Filters);
}

/** @returns {NeverCaptureGlobal} */
export function getNeverCapture() {
	return /** @type {NeverCaptureGlobal} */ (/** @type {any} */ (globalThis).NeverCapture);
}

/** @returns {(a: string|number, b: string|number) => number} */
export function getCompareVersions() {
	return /** @type {any} */ (globalThis).compareVersions;
}

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
