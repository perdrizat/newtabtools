/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Type declarations for integration tests that read page/bridge globals as
 * bare identifiers (set at runtime by the production files' TEST-ONLY
 * `globalThis.X = X;` bridge assignments, or by jest-webextension-mock).
 * TypeScript needs declarations to avoid TS2304/TS7017 under strict mode.
 * Deliberately loose (`any`): partial per-suite mocks must stay assignable
 * — prefs.js/common.js cast their bridge assignments through `any` for the
 * same reason (see the P3 notes in PAGE_MODULES.md).
 *
 * Pruned per the P2–P5 review (2026-07-10, "also noted"): `Site`/`Drop`/
 * `Cell`/`DropTargetShim`/`zip` — no test reads them as bare identifiers
 * anymore (consumers use real named imports or `(globalThis as any)` casts).
 */

// The export {} makes this file a module, which is required for `declare global`.
export {};

declare global {
	var Prefs: any;
	var Blocked: any;
	var Filters: any;
	var NeverCapture: any;
	var compareVersions: any;
	var Tiles: any;
	var Background: any;
	var Updater: any;
	var Grid: any;
	var Drag: any;
	var newTabTools: any;
	var chrome: any;
}

