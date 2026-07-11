/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Page-side normalized namespace leaf (chrome-prep C5a, CHROME_PREP.md
 * Decision 4). Page files cannot import `lib/**` (PAGE_MODULES.md Decision
 * 6), so this is a small standalone twin of `lib/platform.js`'s `api`
 * export rather than a shared dual-scope file (the two seams stay
 * parallel, per the C5 design decision). Every page module's raw
 * `chrome.*`/bare `browser.*` call site imports `api` from here instead.
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
