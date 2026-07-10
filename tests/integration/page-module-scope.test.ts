/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The page-side module-scope regression test (PAGE_MODULES.md, slice P1) —
 * mirrors module-scope.test.ts's role for the background.
 *
 * P1's premise: newTab.html flips from eight classic `<script>` tags
 * (common.js, icons.js, stats.js, tiles-shim.js, prefs.js, awesomebar.js,
 * newTab.js, fx-newTab.js) sharing one implicit global scope to a single
 * `<script type="module" src="page-main.js">` that side-effect-imports the
 * same eight files in the same order. In module scope, a top-level
 * `var X = …` / `function X() {}` no longer attaches to `globalThis` the way
 * it did as a classic script — a file that still relied on that for a
 * cross-file symbol would load fine here (native `import()` doesn't care)
 * while silently breaking every OTHER file's bare-identifier reads of `X` in
 * production. Each of the eight files therefore ends with an explicit
 * `globalThis.X = X;` bridge assignment (common.js/prefs.js already had this
 * permanently, as the pre-existing dual-scope bridge; the other six gained
 * it in P1).
 *
 * This also proves PAGE_MODULES.md's Decision 3 (no page module executes
 * another module's code at its own top level): before P1, fx-newTab.js's own
 * top level unconditionally ran `UndoDialog.init(); newTabTools.startup();
 * pageMessageHandler.flushQueued();` — a direct reach into newTab.js's
 * globals from fx-newTab.js's own module-top-level execution. As a real,
 * separately-imported ES module, fx-newTab.js has no local `newTabTools`
 * binding at all, so that statement would throw a ReferenceError before this
 * slice hoisted it out to page-main.js's boot sequence (not imported here —
 * booting in jsdom is out of scope; the real boot is covered by E2E/UAT).
 *
 * Natively `import()`s the eight page files, in page-main.js's exact load
 * order, with the browser/chrome/DOM surface each file's own top level
 * touches (see each import site below) mocked/provided just enough that
 * import doesn't throw.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseNewTabDocument } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const PAGE_MAIN_PATH = path.join(WEBEXT, 'page-main.js');

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// Derived from page-main.js's own `import './X.js';` lines, rather than
// hardcoded, so this test and the entry it mirrors cannot drift apart (code
// review, 2026-07-10-page-modules-p1-code-review.md finding 8). This is a
// source read, not a source-string assertion of behavior: it supplies the
// EXPECTED order from the single source of truth so a later reorder/rename in
// page-main.js is caught here rather than silently leaving this test's order
// stale; the behavior itself — that these files actually import cleanly, in
// this order, without throwing — is exercised below by natively importing
// each one, and page-main-boot.test.ts separately proves the real entry point
// runs the same import list plus the boot sequence.
//
// page-modules P5 (PAGE_MODULES.md): page-main.js now calls into
// newTab.js/fx-newTab.js/prefs.js directly, so three of the eight lines are
// named imports (`import { X } from './Y.js';`) rather than side-effect-only
// (`import './Y.js';`) — the regex matches either form, still capturing just
// the specifier.
// eslint-disable-next-line ntt/no-source-grep -- supplies the expected load order from the single source of truth (page-main.js); the import behavior itself is exercised natively below, not asserted via string match
const pageMainSource = fs.readFileSync(PAGE_MAIN_PATH, 'utf8');
const PAGE_FILES_IN_LOAD_ORDER = [...pageMainSource.matchAll(/^import\s+(?:\{[^}]*\}\s+from\s+)?'\.\/([^']+)';$/gm)]
	.map(m => m[1]);

// Sanity net: if the regex silently matches nothing (or the wrong thing)
// because page-main.js's import syntax changes, fail loudly here instead of
// quietly running zero/wrong imports below.
if (PAGE_FILES_IN_LOAD_ORDER.length !== 8
	|| PAGE_FILES_IN_LOAD_ORDER[0] !== 'common.js'
	|| PAGE_FILES_IN_LOAD_ORDER[PAGE_FILES_IN_LOAD_ORDER.length - 1] !== 'fx-newTab.js') {
	throw new Error(
		`Failed to parse page-main.js's import list (got: ${JSON.stringify(PAGE_FILES_IN_LOAD_ORDER)}) — `
		+ 'the regex over its `import \'./X.js\';` lines may be stale.',
	);
}

describe('module-scope bridge — page files\' globalThis surface after PAGE_MODULES.md P1', () => {
	let importError: unknown = null;

	beforeAll(async () => {
		// --- DOM ---------------------------------------------------------
		// newTab.js's top level has exactly one non-declaration statement
		// besides `browser.runtime.onMessage.addListener(pageMessageHandler)`
		// below: a self-invoking function that wires up DOM element refs and
		// event listeners against the real markup's ids (options-toggle,
		// ntt-drawer, ntt-search-input, the wallpaper-picker controls, …).
		// Reusing the shipped newTab.html body is simpler and more honest
		// than hand-rolling a partial fixture that happens to cover whatever
		// ids that IIFE currently touches.
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;

		// --- browser/chrome surface --------------------------------------
		// jest-webextension-mock (tests/setup.js) already provides
		// globalThis.chrome/browser (aliased to the same object) with
		// runtime.onMessage.addListener, i18n.getMessage, storage, tabs,
		// permissions, etc., plus a shared `browser.menus` mock (create/
		// update/refresh/onShown/onClicked — tests/setup.js) covering both
		// this file's and module-scope.test.ts's menu-wiring needs (code
		// review, 2026-07-10-page-modules-p1-code-review.md finding 7) —
		// newTab.js's top-level IIFE registers `browser.menus.onShown`/
		// `onClicked` listeners against it.

		try {
			for (const file of PAGE_FILES_IN_LOAD_ORDER) {
				await import(/* @vite-ignore */ webext(file));
			}
		} catch (e) {
			importError = e;
		}
	});

	it('imports all eight page files without throwing (Decision-3 guard: no top-level cross-module calls)', () => {
		expect(importError).toBeNull();
	});

	// ------------------------------------------------------------------
	// Every P1 bridge assignment lands on globalThis.
	// ------------------------------------------------------------------
	it('common.js defines globalThis.compareVersions', () => {
		expect(typeof (globalThis as any).compareVersions).toBe('function');
	});

	it('prefs.js defines globalThis.Prefs', () => {
		expect(typeof (globalThis as any).Prefs).toBe('object');
	});

	it('prefs.js defines globalThis.Blocked', () => {
		expect(typeof (globalThis as any).Blocked).toBe('object');
	});

	it('prefs.js defines globalThis.Filters', () => {
		expect(typeof (globalThis as any).Filters).toBe('object');
	});

	it('prefs.js defines globalThis.NeverCapture', () => {
		expect(typeof (globalThis as any).NeverCapture).toBe('object');
	});

	it('icons.js defines globalThis.NttIcons', () => {
		expect(typeof (globalThis as any).NttIcons).toBe('object');
	});

	it('stats.js defines globalThis.TileStats', () => {
		expect(typeof (globalThis as any).TileStats).toBe('object');
	});

	it('tiles-shim.js defines globalThis.Tiles', () => {
		expect(typeof (globalThis as any).Tiles).toBe('object');
	});

	it('tiles-shim.js defines globalThis.Background', () => {
		expect(typeof (globalThis as any).Background).toBe('object');
	});

	it('awesomebar.js defines globalThis.AwesomeBar', () => {
		expect(typeof (globalThis as any).AwesomeBar).toBe('object');
	});

	it('newTab.js defines globalThis.newTabTools', () => {
		expect(typeof (globalThis as any).newTabTools).toBe('object');
	});

	it('newTab.js defines globalThis.pageMessageHandler', () => {
		expect(typeof (globalThis as any).pageMessageHandler).toBe('function');
	});

	it('fx-newTab.js defines globalThis.Page', () => {
		expect(typeof (globalThis as any).Page).toBe('object');
	});

	it('fx-newTab.js defines globalThis.Grid', () => {
		expect(typeof (globalThis as any).Grid).toBe('object');
	});

	it('fx-newTab.js defines globalThis.Updater', () => {
		expect(typeof (globalThis as any).Updater).toBe('object');
	});

	it('fx-newTab.js defines globalThis.UndoDialog', () => {
		expect(typeof (globalThis as any).UndoDialog).toBe('object');
	});

	it('fx-newTab.js defines globalThis.Drag (not cross-referenced in-page, but E2E drag-layout drives it via page-context evaluation)', () => {
		expect(typeof (globalThis as any).Drag).toBe('object');
	});

	// ------------------------------------------------------------------
	// Decision 3: importing must not run the boot sequence. page-main.js
	// alone owns `UndoDialog.init(); newTabTools.startup();
	// pageMessageHandler.flushQueued();` now.
	// ------------------------------------------------------------------
	it('does not call newTabTools.startup() as an import side effect (boot stays in page-main.js)', () => {
		// startup()'s very first synchronous act (before any of its async
		// Prefs.init().then(...) work) is to localize every `[data-message]`
		// node's textContent via newTabTools.getString(). The shipped markup
		// ships those nodes empty (real strings are filled in by startup() at
		// boot); if importing fx-newTab.js still ran startup() as a
		// top-level side effect, the options-toggle button (which carries
		// data-message="options_edit") would already have text by the time
		// this assertion runs. Picked over spying on UndoDialog.init because
		// it's an effect of startup() specifically, not of anything else on
		// the page.
		const optionsToggle = document.getElementById('options-toggle');
		expect(optionsToggle).not.toBeNull();
		expect(optionsToggle!.textContent).toBe('');
	});
});
