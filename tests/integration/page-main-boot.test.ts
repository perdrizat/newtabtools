/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Behavioral coverage for `webextension/page-main.js` — the new-tab page's
 * single module entry point (PAGE_MODULES.md P1).
 *
 * Code review 2026-07-10-page-modules-p1-code-review.md finding 1: nothing in
 * the fast tier executed page-main.js itself. page-module-scope.test.ts
 * imports the eight *leaf* files directly (never the entry), and
 * tile-stats.test.ts only did a source-string
 * `readFileSync(page-main.js).toContain('./stats.js')` — the `ntt/no-
 * source-grep` antipattern re-licensed with a disable comment, and (per the
 * review's "also noted" §) that waiver said *what* the check does, not *why*
 * a behavioral test wasn't possible — because until this file existed, one
 * wasn't written. This test is that behavioral test; it subsumes the grep,
 * which tile-stats.test.ts's own test and disable comment have been deleted
 * accordingly.
 *
 * page-main.js's two contracts under test:
 *   1. Import completeness — its eight side-effect imports resolve and run
 *      without throwing (Decision-3: no cross-module top-level calls).
 *   2. Boot order — after the imports settle, it calls `UndoDialog.init()`,
 *      then `newTabTools.startup()`, in that order. (A third boot-trailer
 *      step, `pageMessageHandler.flushQueued()`, was retired in chrome-prep
 *      C3a — CHROME_PREP.md — once PAGE_MODULES.md's P5 import cycle made the
 *      early-broadcast queue it replayed provably unreachable; the boot order
 *      this suite pins shrank from three steps to two accordingly.)
 *
 * Design: leaf-import the eight page files first (same mechanism as
 * page-module-scope.test.ts) via real `import`s (chrome-prep C3d retired the
 * `globalThis` bridge these used to also land on), which gives this file the
 * real UndoDialog/newTabTools/pageMessageHandler bindings. Then spy on their
 * three boot entry points and stub them inert — actually running startup()
 * end-to-end in jsdom (real grid render, Prefs.init() network/storage chain,
 * etc.) is out of scope for this tier; the real boot is covered by E2E/UAT
 * (see boot-timing.test.ts for the timing side of that gate). Only then
 * natively `import()` page-main.js: its own eight imports hit the module
 * cache this test file already populated (imports are per-file-registry, not
 * per-describe-block, and this suite runs in one test file), so its boot
 * calls land on the very SAME objects (same binding identity) this file just
 * spied on.
 *
 * Import completeness through the entry itself: with the leaf-imports-first
 * design above, by the time page-main.js is imported every one of these
 * modules is already loaded, so re-asserting a couple of them post-import
 * would be pre-satisfied by construction, not a real check of page-main.js's
 * own import list. The real net for "does page-main.js's import list actually
 * name all eight files, in order" is page-module-scope.test.ts's derived
 * PAGE_FILES_IN_LOAD_ORDER (parsed from this same page-main.js source, code
 * review finding 8) plus its per-file import assertions; what THIS file adds
 * on top is the thing nothing else covers — that importing the real entry
 * point doesn't throw, and that its boot trailer actually runs in the right
 * order.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseNewTabDocument } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// page-main.js's exact side-effect-import order (crib: page-module-scope.test.ts).
// Kept as dynamic imports (not static top-of-file ones) deliberately: newTab.js's
// top-level IIFE wires up real DOM element refs by id, so it must run AFTER
// `document.body.innerHTML` is set in beforeAll below, not at test-file-parse
// time (same DOM-mount-before-evaluation ordering `_helpers.ts`'s
// `ensureSiteEnv` documents for fx-newTab.js).
const PAGE_FILES_IN_LOAD_ORDER = [
	'common.js',
	'icons.js',
	'stats.js',
	'tiles-shim.js',
	'prefs.js',
	'awesomebar.js',
	'newTab.js',
	'fx-newTab.js',
];

describe('page-main.js — the new-tab page\'s module entry point', () => {
	let importError: unknown = null;
	let initSpy: ReturnType<typeof vi.spyOn>;
	let startupSpy: ReturnType<typeof vi.spyOn>;
	let pageMessageHandler: any;

	beforeAll(async () => {
		// --- DOM -----------------------------------------------------------
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;

		// --- browser/chrome surface ------------------------------------------
		// jest-webextension-mock (tests/setup.js) provides globalThis.chrome/
		// browser, including the shared browser.menus mock newTab.js's
		// top-level IIFE needs (code review finding 7).

		// --- leaf-import the eight page files first, in order, via real
		// `import`s (chrome-prep C3d retired the `globalThis` bridge these
		// used to also land on) — capture the two bindings this file needs
		// from newTab.js/fx-newTab.js's own module exports.
		let newTabToolsModule: any;
		let fxNewTabModule: any;
		for (const file of PAGE_FILES_IN_LOAD_ORDER) {
			const mod = await import(/* @vite-ignore */ webext(file));
			if (file === 'newTab.js') { newTabToolsModule = mod; }
			if (file === 'fx-newTab.js') { fxNewTabModule = mod; }
		}
		pageMessageHandler = newTabToolsModule.pageMessageHandler;

		// --- stub the two boot entry points inert -----------------------------
		// Spying on the real, just-imported singletons wraps the actual
		// production objects — ESM's module cache means page-main.js's own
		// imports (below) resolve to these same bindings.
		initSpy = vi.spyOn(fxNewTabModule.UndoDialog, 'init').mockImplementation(() => {});
		startupSpy = vi.spyOn(newTabToolsModule.newTabTools, 'startup').mockImplementation(() => {});

		// --- import the real entry point --------------------------------------
		// Its eight `import './X.js'` lines hit the module cache this same test
		// file already populated above, so no code re-runs; only page-main.js's
		// own top-level boot trailer executes, against the spied objects.
		try {
			await import(/* @vite-ignore */ webext('page-main.js'));
		} catch (e) {
			importError = e;
		}
	});

	it('imports without throwing', () => {
		expect(importError).toBeNull();
	});

	it('calls UndoDialog.init() exactly once', () => {
		expect(initSpy).toHaveBeenCalledTimes(1);
	});

	it('calls newTabTools.startup() exactly once', () => {
		expect(startupSpy).toHaveBeenCalledTimes(1);
	});

	it('boots in order: UndoDialog.init() -> newTabTools.startup()', () => {
		const initOrder = initSpy.mock.invocationCallOrder[0];
		const startupOrder = startupSpy.mock.invocationCallOrder[0];
		expect(initOrder).toBeLessThan(startupOrder);
	});

	it('pageMessageHandler exposes no flushQueued (chrome-prep C3a retired the replay step)', () => {
		expect(pageMessageHandler.flushQueued).toBeUndefined();
	});
});
