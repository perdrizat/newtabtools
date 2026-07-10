/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Type declarations for integration tests' vm-harness plumbing: a handful of
 * suites still SET `globalThis.X = {...}` stand-ins internally, as a fixture
 * for a `vm`-extracted/sandboxed method body to read (test-internal
 * plumbing, not a page/production bridge — chrome-prep C3d retired every
 * production `globalThis.X = X;` bridge assignment, and with it, every test
 * that used to READ a bridge global expecting production to have set it;
 * see CHROME_PREP.md C3d). TypeScript needs declarations to avoid
 * TS2304/TS7017 under strict mode for the plain (non-cast)
 * `globalThis.X = …` assignments that remain. Deliberately loose (`any`):
 * partial per-suite mocks must stay assignable.
 *
 * Shrunk per chrome-prep C3d: `Blocked`/`NeverCapture`/`compareVersions`/
 * `Drag`/`newTabTools` dropped — every remaining reference is either a real
 * `import` or a test-local variable, never a bare `globalThis.X` write
 * needing this ambient declaration. (Earlier prune, P2–P5 review
 * 2026-07-10 "also noted": `Site`/`Drop`/`Cell`/`DropTargetShim`/`zip`.)
 */

// The export {} makes this file a module, which is required for `declare global`.
export {};

declare global {
	var Prefs: any;
	var Filters: any;
	var Tiles: any;
	var Background: any;
	var Updater: any;
	var Grid: any;
	var chrome: any;
}

