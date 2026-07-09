/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Type declarations for integration tests that load legacy script-mode files
 * via vm.runInThisContext. These globals are injected at runtime by the
 * production code or by jest-webextension-mock; TypeScript needs declarations
 * to avoid TS2304/TS7017 under strict mode.
 */

// Extension globals injected by vm.runInThisContext and jest-webextension-mock.
// Using `declare var` inside `declare global` so both bare references (e.g.
// `Prefs._theme`) and globalThis assignments (e.g. `globalThis.Prefs = ...`)
// are valid under strict mode.

// The export {} makes this file a module, which is required for `declare global`.
export {};

declare global {
	var Prefs: any;
	var Blocked: any;
	var Filters: any;
	var compareVersions: any;
	var Tiles: any;
	var Background: any;
	var Updater: any;
	var Grid: any;
	var Drag: any;
	var Drop: any;
	var DropTargetShim: any;
	var Site: any;
	var Cell: any;
	var newTabTools: any;
	var zip: any;
	var chrome: any;
}

