/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The page-side module-scope regression test (PAGE_MODULES.md, slice P1) —
 * mirrors module-scope.test.ts's role for the background.
 *
 * P1's premise: newTab.html flips from eight classic `<script>` tags
 * (common.js, icons.js, stats.js, tiles-shim.js, prefs.js, awesomebar.js,
 * newTab.js, and the page monolith later dissolved in chrome-prep C4c) —
 * sharing one implicit global scope — to a single
 * `<script type="module" src="page-main.js">` that side-effect-imports the
 * same eight files in the same order. Through P1–P5, each of the eight files
 * carried a `globalThis.X = X;` bridge assignment (common.js/prefs.js had it
 * permanently, as the pre-existing dual-scope bridge; the other six gained it
 * in P1) so no in-page bare-identifier read broke while every file converted
 * to real `import`/`export` one slice at a time.
 *
 * chrome-prep C3d (CHROME_PREP.md maintainer directive 1) retires every one
 * of those bridge assignments: every production cross-reference now goes
 * through a real `import`, and the E2E/UAT harness that used to read the
 * TEST-ONLY survivors off page-context `globalThis` now drives the real page
 * via runtime messages/`browser.storage.local`/DOM observation/synthesized
 * DOM events instead. This test's inventory therefore flips from "every
 * bridge assignment lands on globalThis" to its negation — the repo ends
 * this arc with ZERO bridge assignments, and this is the static proof.
 *
 * This also proves PAGE_MODULES.md's Decision 3 (no page module executes
 * another module's code at its own top level): before P1, the page
 * monolith's own top level unconditionally ran `UndoDialog.init();
 * newTabTools.startup(); pageMessageHandler.flushQueued();` — a direct reach
 * into newTab.js's globals from its own module-top-level execution. As a
 * real, separately-imported ES module, it had no local `newTabTools` binding
 * at all, so that statement would throw a ReferenceError before this slice
 * hoisted it out to page-main.js's boot sequence (not imported here —
 * booting in jsdom is out of scope; the real boot is covered by E2E/UAT).
 *
 * Natively `import()`s the ten page files (chrome-prep C4a, CHROME_PREP.md:
 * grew from eight — `Updater`/`UndoDialog` moved to their own
 * updater.js/undo-dialog.js modules; chrome-prep C4c further dissolved the
 * former page monolith into grid.js/cell.js/site.js/page.js, reached
 * transitively — the list stays at ten entries, see its own comment below),
 * in page-main.js's exact load order, with the browser/chrome/DOM surface
 * each file's own top level touches (see each import site below)
 * mocked/provided just enough that import doesn't throw.
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
// newTab.js/grid.js/prefs.js directly, so several of the lines are
// named imports (`import { X } from './Y.js';`) rather than side-effect-only
// (`import './Y.js';`) — the regex matches either form, still capturing just
// the specifier.
//
// chrome-prep C4a (CHROME_PREP.md): page-main.js's import list grows from
// eight entries to ten here — `Updater`/`UndoDialog` moved to their own
// updater.js/undo-dialog.js modules, imported by name just before the former
// page monolith's own import. The two invariants below (starts with
// common.js, ends with the monolith's specifier) are unchanged; only the
// length grew — per the arc's own instruction to update this sanity net
// honestly rather than hardcode around it. chrome-prep C4c (CHROME_PREP.md)
// dissolved that monolith into grid.js/cell.js/site.js/page.js; page-main.js
// only ever named-imported `Grid` from it, so the last-entry invariant below
// now reads `grid.js` — cell.js/site.js/page.js are reached transitively,
// so the length (ten) is unchanged too.
// eslint-disable-next-line ntt/no-source-grep -- supplies the expected load order from the single source of truth (page-main.js); the import behavior itself is exercised natively below, not asserted via string match
const pageMainSource = fs.readFileSync(PAGE_MAIN_PATH, 'utf8');
const PAGE_FILES_IN_LOAD_ORDER = [...pageMainSource.matchAll(/^import\s+(?:\{[^}]*\}\s+from\s+)?'\.\/([^']+)';$/gm)]
	.map(m => m[1]);

// Sanity net: if the regex silently matches nothing (or the wrong thing)
// because page-main.js's import syntax changes, fail loudly here instead of
// quietly running zero/wrong imports below.
if (PAGE_FILES_IN_LOAD_ORDER.length !== 10
	|| PAGE_FILES_IN_LOAD_ORDER[0] !== 'common.js'
	|| PAGE_FILES_IN_LOAD_ORDER[PAGE_FILES_IN_LOAD_ORDER.length - 1] !== 'grid.js') {
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

	it('imports all ten page files without throwing (Decision-3 guard: no top-level cross-module calls)', () => {
		expect(importError).toBeNull();
	});

	// ------------------------------------------------------------------
	// chrome-prep C3d: every former bridge assignment is GONE from
	// globalThis — negative assertions, the retirement's static proof.
	// ------------------------------------------------------------------
	it('common.js does not define globalThis.compareVersions', () => {
		expect(typeof (globalThis as any).compareVersions).toBe('undefined');
	});

	it('prefs.js does not define globalThis.Prefs', () => {
		expect(typeof (globalThis as any).Prefs).toBe('undefined');
	});

	it('prefs.js does not define globalThis.Blocked', () => {
		expect(typeof (globalThis as any).Blocked).toBe('undefined');
	});

	it('prefs.js does not define globalThis.Filters', () => {
		expect(typeof (globalThis as any).Filters).toBe('undefined');
	});

	it('prefs.js does not define globalThis.NeverCapture', () => {
		expect(typeof (globalThis as any).NeverCapture).toBe('undefined');
	});

	it('icons.js does not define globalThis.NttIcons', () => {
		expect(typeof (globalThis as any).NttIcons).toBe('undefined');
	});

	it('stats.js does not define globalThis.TileStats', () => {
		expect(typeof (globalThis as any).TileStats).toBe('undefined');
	});

	it('tiles-shim.js does not define globalThis.Tiles', () => {
		expect(typeof (globalThis as any).Tiles).toBe('undefined');
	});

	it('tiles-shim.js does not define globalThis.Background', () => {
		expect(typeof (globalThis as any).Background).toBe('undefined');
	});

	it('awesomebar.js does not define globalThis.AwesomeBar', () => {
		expect(typeof (globalThis as any).AwesomeBar).toBe('undefined');
	});

	it('newTab.js does not define globalThis.newTabTools', () => {
		expect(typeof (globalThis as any).newTabTools).toBe('undefined');
	});

	it('newTab.js does not define globalThis.pageMessageHandler', () => {
		expect(typeof (globalThis as any).pageMessageHandler).toBe('undefined');
	});

	it('page.js does not define globalThis.Page', () => {
		expect(typeof (globalThis as any).Page).toBe('undefined');
	});

	it('grid.js does not define globalThis.Grid', () => {
		expect(typeof (globalThis as any).Grid).toBe('undefined');
	});

	it('updater.js does not define globalThis.Updater (chrome-prep C4a: split out of the former page monolith)', () => {
		expect(typeof (globalThis as any).Updater).toBe('undefined');
	});

	it('undo-dialog.js does not define globalThis.UndoDialog (chrome-prep C4a: split out of the former page monolith)', () => {
		expect(typeof (globalThis as any).UndoDialog).toBe('undefined');
	});

	it('drag-drop.js does not define globalThis.Drag (the E2E drag-layout bridge is retired — real dragstart/dragend events drive it now)', () => {
		expect(typeof (globalThis as any).Drag).toBe('undefined');
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
		// boot); if importing one of these page files still ran startup() as a
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
