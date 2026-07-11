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

// ---------------------------------------------------------------------------
// Capability wrappers
// ---------------------------------------------------------------------------
//
// Co-located with `api` in this one file rather than a separate
// `capabilities.js` sibling (chrome-prep C5b, CHROME_PREP.md, audit §seam-
// homes): `lib/platform.js` — the background twin this page leaf mirrors —
// already holds its namespace Proxy AND its capability wrappers together in
// one file, and the page side's wrapper surface (just `searchWeb` below) is
// far too small to justify a second file splitting that precedent. If the
// page-side wrapper surface grows substantially (e.g. the deferred theme
// presence-gating), revisit as a real capabilities.js split then.

/**
 * Web-search dispatch (audit #3): Chrome's equivalent of Firefox's
 * `search.search({query, disposition})` is the renamed `search.query({text,
 * disposition})` — no `engine` param, `text` instead of `query`. This is
 * NOT presence-selected on `'query' in api.search`: Firefox has shipped BOTH
 * `search.search` AND `search.query` since Firefox 94 (MDN), so a naive
 * presence check on `query` would pick the Chrome-shaped call on Firefox too
 * — a real behavior change this slice must not make. Selecting on `'search'
 * in api.search` instead keeps Firefox on its own, currently-shipping
 * `search.search` call unconditionally (true on every Firefox that has ever
 * run this code, whether or not it also has `query`); Chrome — which has no
 * `search.search` at all — falls through to the `query` shape, written but
 * never exercised while `search.search` exists.
 * @param {{query: string, newTab: boolean}} args
 * @returns {void}
 */
export function searchWeb({query, newTab}) {
	let disposition = newTab ? 'NEW_TAB' : 'CURRENT_TAB';
	if ('search' in api.search) {
		api.search.search({query, disposition});
		return;
	}
	// Chrome-dormant path (written but unreachable while `search.search`
	// exists — see doc comment above).
	api.search.query({text: query, disposition});
}
