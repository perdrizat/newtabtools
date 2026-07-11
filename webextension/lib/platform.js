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
 * chrome-prep C5a (CHROME_PREP.md, namespace normalization): every
 * `browser.*`/`chrome.*` call below (and in every other lib/** module) is
 * now `api.*`, `api` being this file's exported namespace leaf. See `api`'s
 * own doc comment for why it's a live-resolving Proxy rather than a plain
 * `const api = globalThis.browser ?? chrome`.
 *
 * PAGE_MODULES.md P3 (the dual-scope endgame) retired the Decision-2 bridge
 * accessor this file used to hold: `getPrefs()`/`getBlocked()`/
 * `getFilters()`/`getNeverCapture()`/`getCompareVersions()` are gone. The
 * background's read path (lib/background-main.js and every other lib
 * consumer) now does a real `import { Prefs, Blocked, Filters, NeverCapture }
 * from '../prefs.js'` / `import { compareVersions } from '../common.js'`
 * instead — those two files' `export`s are real now, and their
 * `globalThis.X = …` bridge assignments are gone too as of chrome-prep C3d
 * (see prefs.js/common.js's own doc comments): the page imports both files
 * for real, so nothing reads either off `globalThis` anymore.
 */

// ---------------------------------------------------------------------------
// Normalized namespace
// ---------------------------------------------------------------------------

/**
 * Normalized namespace object: every extension API call in `lib/**` routes
 * through this single identifier instead of a raw `chrome.*`/bare
 * `browser.*` reference, so a future Chrome build (promise-capable
 * `chrome.*` under MV3) needs zero call-site churn — only this leaf (and its
 * page-side twin, `webextension/api.js`) forks.
 *
 * Implemented as a Proxy that re-resolves `globalThis.browser ?? chrome` on
 * EVERY property access, rather than a plain `const api = globalThis.browser
 * ?? chrome` captured once at import time. Firefox/Chrome runtimes never
 * reassign either global after startup, so the two are behaviorally
 * identical there — but the test suite widely reassigns
 * `globalThis.chrome`/`globalThis.browser` per test case (e.g.
 * tests/integration/drawer-permissions.test.ts, theme.test.ts) to inject a
 * fresh spy object, expecting a call site to observe whatever is CURRENTLY
 * global at call time — exactly how the bare `chrome.foo()`/`browser.foo()`
 * calls this replaces always behaved. A frozen reference would keep
 * pointing at whichever global existed at first import (typically the
 * baseline jest-webextension-mock fixture), silently missing every later
 * per-test override. The Proxy preserves that call-time semantics with zero
 * behavior change on Firefox (the real gate) or in a genuine Chrome build.
 *
 * Typed `any`, not `typeof browser`: `@types/firefox-webext-browser` models
 * only the promise-based `browser.*` surface, but this namespace still
 * carries plenty of pre-existing callback-style calls (`chrome.x(msg, cb)`,
 * unchanged call SHAPE per this slice's scope discipline — only the
 * namespace object was swapped, not promisified). Every such call site was
 * already untyped (`chrome` resolves to `any` via
 * tests/integration/globals.d.ts); `typeof browser` would newly reject them
 * all (no callback overload exists on the promise-only type), which is a
 * type-only regression this refactor must not introduce.
 * @type {any}
 */
export const api = new Proxy(/** @type {any} */ ({}), {
	get(_target, prop, receiver) {
		return Reflect.get(globalThis.browser ?? globalThis.chrome, prop, receiver);
	},
	has(_target, prop) {
		return prop in (globalThis.browser ?? globalThis.chrome);
	},
});

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
	return api.permissions.contains({origins: ['<all_urls>']}).catch(() => false);
}

/**
 * Firefox hides `tabs.captureVisibleTab` entirely — not merely denies it,
 * `typeof` is `undefined` — when the extension lacks (or has lost) the
 * `<all_urls>` host permission the API requires (spike finding, 2026-07-09).
 * @returns {boolean}
 */
export function isCaptureAvailable() {
	return typeof api.tabs.captureVisibleTab === 'function';
}

/**
 * Enable the toolbar action for a tab. Fire-and-forget: enabling/disabling a
 * since-closed tab can reject, so failures are logged, never thrown.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function enableAction(tabId) {
	return api.action.enable(tabId).catch(console.error);
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function disableAction(tabId) {
	return api.action.disable(tabId).catch(console.error);
}

/**
 * @param {string} key
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function getMessage(key, substitutions) {
	return api.i18n.getMessage(key, substitutions);
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
	api.menus.create(props, function() {
		return api.runtime.lastError;
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
	return api.runtime.sendMessage({name}).catch(() => {});
}
