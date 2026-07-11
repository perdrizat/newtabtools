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
 *
 * chrome-prep C5b (CHROME_PREP.md, audit §2): Chrome keeps
 * `tabs.captureVisibleTab` always defined — it never hides the function, it
 * would instead reject the call at invocation time — so this `typeof` probe
 * is a Firefox-only detection trick and stays the ONLY check here. It is
 * deliberately NOT collapsed onto `hasAllUrlsPermission()` even though that
 * promise is "the truth" on both engines: the 2026-07-09 MV3 code review
 * (`audit/2026-07-09-mv3-code-review.md`) already examined this exact pair at
 * `lib/capture.js`'s two call sites and documented them as INDEPENDENT
 * defense-in-depth layers, not a provably-redundant guard — collapsing them
 * would be an undocumented behavior change this slice must not make. See
 * `isCaptureAvailableViaPermission` below for the Chrome-dormant fork point.
 * @returns {boolean}
 */
export function isCaptureAvailable() {
	return typeof api.tabs.captureVisibleTab === 'function';
}

/**
 * Chrome-dormant permission-based capture-availability check (written but
 * unwired — no call site uses this yet, per Decision 4/CHROME_PREP.md C5).
 * Chrome's `tabs.captureVisibleTab` is always defined, so `isCaptureAvailable`'s
 * `typeof` probe would always read `true` there regardless of the actual
 * `<all_urls>` grant — a Chrome-targeting fork of `isCaptureAvailable` should
 * call this instead. Not merged into `isCaptureAvailable` itself: see that
 * function's doc comment for why the two checks stay independent on Firefox.
 * @returns {Promise<boolean>}
 */
export function isCaptureAvailableViaPermission() {
	return hasAllUrlsPermission();
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
 * Chrome-dormant stub (audit §seam-homes, #4). Firefox's manifest
 * `theme_icons` entry auto-swaps the toolbar icon for the light/dark theme —
 * no JS involvement at all, which is why nothing in this codebase has ever
 * called an icon-swap function. Chrome MV3 has no `theme_icons` equivalent;
 * a Chrome fork needs this to actually call `api.action.setIcon()` with the
 * icon set matching the current theme (mirroring `theme.js`'s
 * `prefers-color-scheme` detection). No-op on Firefox by design — do NOT
 * wire this into any live call site while `theme_icons` still handles it.
 * @returns {void}
 */
export function syncActionIconWithTheme() {
	// Intentionally empty: see doc comment above.
}

/**
 * Read from `storage.session`. Call shape is identical on Firefox and Chrome
 * MV3, but the two engines diverge underneath it (audit §traps,
 * `audit/2026-07-11-chrome-api-divergence.md` #1): Chrome MV3 defaults the
 * store's access level to `TRUSTED_CONTEXTS` (extension pages/background
 * only — content scripts are excluded unless
 * `storage.session.setAccessLevel()` is called first) and caps it at a 10 MB
 * quota; Firefox's `storage.session` has no access-level concept and no
 * documented quota below `storage.local`'s. This wrapper is a thin
 * pass-through today (no behavior to gate — this extension never touches
 * `storage.session` from a content script), but it is the one place that
 * caveat needs to be written down before a Chrome build starts relying on
 * this store.
 * @param {string|string[]|Record<string, unknown>|null} [keys]
 * @returns {Promise<Record<string, any>>}
 */
export function sessionGet(keys) {
	return api.storage.session.get(keys);
}

/**
 * Write to `storage.session`. See `sessionGet`'s doc comment for the
 * Chrome-vs-Firefox divergence this wraps.
 * @param {Record<string, unknown>} items
 * @returns {Promise<void>}
 */
export function sessionSet(items) {
	return api.storage.session.set(items);
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
