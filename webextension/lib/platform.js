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
 * CHROME.md D3 slice 1: the scope fork `lib/capture.js`'s `captureTab()`
 * actually calls (wiring `isCaptureAvailableViaPermission` in). Dispatches on
 * `isServiceWorkerScope`, the same probe `lib/thumbnail-image.js`'s
 * `_isServiceWorkerScope()` uses for the D2 OffscreenCanvas fork — passed in
 * by the caller rather than read here directly, since CHROME_PREP.md C1's
 * ESLint guard confines every raw `document` reference in `lib/**` to
 * thumbnail-image.js (the one designated Chrome-swap seam). A Chrome MV3
 * service worker has no `document`, so it uses the permission-based check;
 * Firefox's event page always has one and keeps using the `typeof` probe
 * exactly as before. `isCaptureAvailable()` and
 * `isCaptureAvailableViaPermission()` stay independently callable per their
 * own doc comments above — this function only picks WHICH one to call per
 * scope, it does not merge their logic into one expression.
 *
 * Always returns a Promise, even on the synchronous Firefox path: the one
 * real call site (`lib/capture.js`'s `captureTab()`) is already `async` and
 * awaits the result either way, so the sync→async change costs nothing
 * there — see that file's comment at the call site.
 * @param {boolean} isServiceWorkerScope
 * @returns {Promise<boolean>}
 */
export function isCaptureAvailableForScope(isServiceWorkerScope) {
	if (isServiceWorkerScope) {
		return isCaptureAvailableViaPermission();
	}
	return Promise.resolve(isCaptureAvailable());
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
 * Sync the toolbar action icon with the current color scheme (CHROME.md D4:
 * wired for real, replacing the former Chrome-dormant no-op stub — audit
 * §seam-homes #4).
 *
 * No-op on Firefox (`isServiceWorkerScope` falsy, the event-page case):
 * manifest `theme_icons` (manifest/firefox.json) already swaps the toolbar
 * icon declaratively with zero JS involvement — do NOT wire an actual
 * `api.action.setIcon()` call into that path, it would just fight the
 * manifest.
 *
 * On a Chrome MV3 service worker (`isServiceWorkerScope` true) there is no
 * `theme_icons` equivalent, and no `matchMedia` either (no `window` in a
 * service worker) — the page relays the OS/browser color scheme via the
 * `Theme.colorScheme` wire message (theme.js's
 * `_initThemeColorSchemeRelay`), and lib/messages.js's handler calls this
 * function with the relayed `dark` boolean and the `_isServiceWorkerScope()`
 * probe (thumbnail-image.js) — same shape as `isCaptureAvailableForScope`
 * above. `isServiceWorkerScope` is passed in rather than probed here directly
 * since CHROME_PREP.md C1's ESLint guard confines every raw `document`
 * reference in `lib/**` to thumbnail-image.js.
 *
 * Icon mapping, derived from manifest/firefox.json's `action.theme_icons`
 * entry (reproduced here so the two never drift):
 *
 *   "theme_icons": [{ "dark": "images/tools-light.svg", "light": "images/tools-dark.svg", "size": 16 }]
 *
 * The schema's `dark`/`light` KEYS name the theme's TEXT-color scheme (a
 * legacy WebExtension convention), not the icon file's own name — read
 * naively backwards it looks inverted. Empirically: the `dark:` slot's VALUE
 * (`tools-light.svg`) is the icon Firefox actually shows on a LIGHT theme;
 * the `light:` slot's VALUE (`tools-dark.svg`) is shown on a DARK theme. Net
 * behavior: light theme -> tools-light.svg, dark theme -> tools-dark.svg —
 * the repo's SVG (and rasterized PNG) filenames already match the THEME
 * they're shown on, one level removed from the confusing schema keys. This
 * function reproduces that net behavior directly, with no inversion of its
 * own: `dark === true` -> the 'dark' PNG variant, otherwise -> 'light'.
 * @param {boolean} [dark] Whether the relayed color scheme is dark.
 * @param {boolean} [isServiceWorkerScope] Chrome MV3 service worker vs.
 *   Firefox event page.
 * @returns {void}
 */
export function syncActionIconWithTheme(dark, isServiceWorkerScope) {
	if (!isServiceWorkerScope) {
		// Firefox event page: theme_icons already handles this declaratively.
		return;
	}
	let variant = dark ? 'dark' : 'light';
	api.action.setIcon({
		path: {
			16: `images/tools-${variant}-16.png`,
			32: `images/tools-${variant}-32.png`,
		},
	}).catch(console.error);
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
