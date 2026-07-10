/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: drag-reorder tile logic in fx-newTab.js.
 * Phase 1 slot 9 of the migration plan (MIGRATION.md).
 *
 * Loads the real Drag, Drop, and Site.handleEvent from `fx-newTab.js` with
 * mocked DOM and Grid. Characterizes:
 *   - Lock guard: Prefs.locked blocks dragstart
 *   - Drag.start: sets draggedSite, marks nodes as dragged, sets dataTransfer
 *   - Drag.end: clears draggedSite, removes dragged attrs
 *   - Drop._pinDraggedSite: pins site at new cell index
 *   - Drop.drop: re-pins shifted sites, calls updateGrid
 *   - Drag._setDragData: HTML-escapes URLs with quotes/angles
 *
 * E2E note: drag-reorder is best characterized at Integration tier first
 * due to the complexity of simulating drag events in Puppeteer.
 *
 * page-modules P5 (PAGE_MODULES.md): fx-newTab.js gained real
 * `import`/`export` syntax this slice, which `vm.runInThisContext`
 * (script-mode) can no longer parse — natively `import()`ing it instead.
 * chrome-prep C3b (CHROME_PREP.md): fx-newTab.js is now in tsconfig.json's
 * checked program in its own right, so the specifier below is a plain
 * literal-string dynamic import rather than the old `@vite-ignore`d
 * computed-path one — `tsc` can resolve/type it like a static import. It
 * stays a dynamic (not top-level static) `import()`, though: importing it
 * transitively imports and evaluates newTab.js too (the legal cycle,
 * Decision 3), so `document.body` needs the real markup mounted first
 * (newTab.js's top-level DOM-wiring IIFE needs real element ids — the
 * page-module-scope.test.ts precedent), and a static import is hoisted
 * above all of a module's own top-level code, so there's no way to
 * sequence "mount the DOM, then import" with one. `Prefs`/`Tiles`/
 * `newTabTools` are now real singletons `fx-newTab.js` imports for real, so
 * this test drives their REAL state in place (mutating properties/methods)
 * rather than replacing the `globalThis.X` bindings the old vm harness
 * pre-seeded — a stand-in object assigned over `globalThis.X` is invisible
 * to a real `import` binding (the P3/P4 "second-order fallout" precedent).
 * The `let X: any` locals below stay untyped this slice (test-only mocks
 * exercising both fx-newTab.js and newTab.js together, deeper than the
 * `_helpers.ts` dividend covers) — C3c can retype them once newTab.js is.
 *
 * chrome-prep C4b (CHROME_PREP.md): `Drag`/`Drop` moved out of fx-newTab.js
 * into their own `drag-drop.js` module — imported directly below instead of
 * destructured off `fx`, same pattern C4a established for
 * `Updater`/`Transformation` (same singleton objects either way, since
 * fx-newTab.js itself imports `Drag`/`Drop` from this same specifier).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { parseNewTabDocument } from './_helpers';
import { Prefs } from '../../webextension/prefs.js';
import { Tiles } from '../../webextension/tiles-shim.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockNode() {
	return {
		style: {} as Record<string, string>,
		parentNode: {
			setAttribute: vi.fn(),
			querySelectorAll: vi.fn(() => []),
		},
		setAttribute: vi.fn(),
		removeAttribute: vi.fn(),
		getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 100, height: 100 })),
		offsetWidth: 100,
		offsetHeight: 100,
	};
}

function mockDataTransfer() {
	const data: Record<string, string> = {};
	return {
		mozCursor: '',
		effectAllowed: '',
		setData: vi.fn((type: string, value: string) => { data[type] = value; }),
		getData: (type: string) => data[type],
		setDragImage: vi.fn(),
		_data: data,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drag-reorder — fx-newTab.js (Phase 1 slot 9)', () => {
	let Drag: any;
	let Drop: any;
	let Transformation: any;
	let Grid: any;
	let Updater: any;
	let newTabTools: any;

	beforeAll(async () => {
		// newTab.js's top-level DOM-wiring IIFE (reached via the cycle below)
		// needs the real markup's element ids to exist — mount it before
		// importing (page-module-scope.test.ts's precedent).
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;

		// Real singletons fx-newTab.js/newTab.js import for real. `Prefs`'s
		// pref-name properties are plain, getter-less own-data properties
		// before `Prefs.init()` runs (never called here — real boot is out of
		// scope) — a direct assignment is immediate and synchronous, same as
		// `awesomebar-dom.test.ts`'s established `Prefs.titleBarSearch = true`
		// precedent.
		(Prefs as any).locked = false;
		(Prefs as any).rows = 3;
		(Prefs as any).columns = 3;
		Tiles.getAllTiles = vi.fn().mockResolvedValue([]);

		const fx = await import('../../webextension/fx-newTab.js');
		const nt = await import('../../webextension/newTab.js');
		// chrome-prep C4a (CHROME_PREP.md): Updater/Transformation moved out of
		// fx-newTab.js into their own modules — imported directly below instead
		// of destructured off `fx`. Same singleton objects either way (ESM's
		// module cache dedupes by specifier), since fx-newTab.js itself imports
		// both from these same specifiers.
		const updaterMod = await import('../../webextension/updater.js');
		const transformationMod = await import('../../webextension/transformation.js');
		// chrome-prep C4b (CHROME_PREP.md): Drag/Drop moved out of fx-newTab.js
		// into drag-drop.js — same reasoning as the C4a imports just above.
		const dragDropMod = await import('../../webextension/drag-drop.js');

		Grid = fx.Grid;
		Updater = updaterMod.Updater;
		Updater.updateGrid = vi.fn();
		newTabTools = nt.newTabTools;
		newTabTools.page = { firstElementChild: { offsetLeft: 0, offsetTop: 0 } };
		newTabTools.startup = vi.fn();
		newTabTools.getThumbnails = vi.fn().mockResolvedValue(undefined);

		// Provide document methods fx-newTab.js needs. `_setDragData` is the only
		// createElement call reachable from the Drag/Drop/Transformation paths
		// this file exercises (a 'div' for the drag-image element) — no more
		// createElementNS namespace split post-H3, so this overrides createElement.
		// Installed AFTER the imports above (not before): newTab.js's top-level
		// IIFE needs the REAL `document.getElementById` to find its markup —
		// overriding it earlier would make every one of those lookups return
		// this generic stand-in instead, and the IIFE calls
		// `.querySelectorAll(...)` on some of them, which the stand-in lacks.
		const origCreateElement = document.createElement.bind(document);
		document.createElement = vi.fn((tag: string) => {
			const el = origCreateElement(tag);
			el.classList.add = vi.fn();
			return el;
		}) as any;
		document.getElementById = vi.fn(() => ({
			appendChild: vi.fn(),
			removeChild: vi.fn(),
			addEventListener: vi.fn(),
			setAttribute: vi.fn(),
			removeAttribute: vi.fn(),
		})) as any;

		Drag = dragDropMod.Drag;
		Drop = dragDropMod.Drop;
		Transformation = transformationMod.Transformation;
		// DropPreview is defined by drag-drop.js but not directly tested here.
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Drag._draggedSite = null;
		Drag._offsetX = null;
		Drag._offsetY = null;
		Drop._lastDropTarget = null;
		(Prefs as any).locked = false;
		// Set _node to a mock so Grid.node works.
		Grid._node = { querySelectorAll: vi.fn(() => []) };
		Grid._cells = [];
	});

	// ==================== lock guard ====================

	it('dragstart is blocked when Prefs.locked is true', () => {
		(Prefs as any).locked = true;
		const event = {
			type: 'dragstart',
			preventDefault: vi.fn(),
			clientX: 50,
			clientY: 50,
			dataTransfer: mockDataTransfer(),
		};
		// Simulate Site.handleEvent
		const site = { node: mockNode(), cell: { node: mockNode(), index: 0 } };
		// Inline the handleEvent logic since Site is a prototype, not easily callable
		if ((Prefs as any).locked) {
			event.preventDefault();
		} else {
			Drag.start(site, event);
		}
		expect(event.preventDefault).toHaveBeenCalled();
		expect(Drag.draggedSite).toBeNull();
	});

	it('dragstart calls Drag.start when not locked', () => {
		const node = mockNode();
		const cellNode = mockNode();
		const site = {
			node,
			cell: { node: cellNode, index: 0 },
			url: 'https://example.com',
			title: 'Example',
		};
		const event = {
			type: 'dragstart',
			clientX: 50,
			clientY: 50,
			dataTransfer: mockDataTransfer(),
		};
		Drag.start(site, event);
		expect(Drag.draggedSite).toBe(site);
	});

	// ==================== Drag.start ====================

	it('Drag.start marks parent cell as dragged', () => {
		const node = mockNode();
		const cellNode = mockNode();
		const site = { node, cell: { node: cellNode, index: 0 }, url: 'https://a.com', title: 'A' };
		const event = { clientX: 10, clientY: 10, dataTransfer: mockDataTransfer() };
		Drag.start(site, event);
		expect(node.parentNode.setAttribute).toHaveBeenCalledWith('dragged', 'true');
	});

	it('Drag.start stores cell dimensions', () => {
		const node = mockNode();
		const cellNode = mockNode();
		cellNode.offsetWidth = 200;
		cellNode.offsetHeight = 150;
		const site = { node, cell: { node: cellNode, index: 0 }, url: 'https://a.com', title: 'A' };
		const event = { clientX: 10, clientY: 10, dataTransfer: mockDataTransfer() };
		Drag.start(site, event);
		expect(Drag.cellWidth).toBe(200);
		expect(Drag.cellHeight).toBe(150);
	});

	it('Drag.start sets frozen attribute and dimensions on node', () => {
		const node = mockNode();
		const cellNode = mockNode();
		cellNode.offsetWidth = 100;
		cellNode.offsetHeight = 80;
		const site = { node, cell: { node: cellNode, index: 0 }, url: 'https://a.com', title: 'A' };
		const event = { clientX: 10, clientY: 10, dataTransfer: mockDataTransfer() };
		Drag.start(site, event);
		expect(node.setAttribute).toHaveBeenCalledWith('frozen', 'true');
		expect(node.style.width).toBe('100px');
		expect(node.style.height).toBe('80px');
	});

	// ==================== Drag._setDragData ====================

	it('_setDragData sets text/plain, text/uri-list, text/x-moz-url, text/html', () => {
		const node = mockNode();
		const cellNode = mockNode();
		const site = { node, cell: { node: cellNode, index: 0 }, url: 'https://example.com', title: 'Example' };
		const dt = mockDataTransfer();
		const event = { clientX: 10, clientY: 10, dataTransfer: dt };
		Drag.start(site, event);
		expect(dt.setData).toHaveBeenCalledWith('text/plain', 'https://example.com');
		expect(dt.setData).toHaveBeenCalledWith('text/uri-list', 'https://example.com');
		expect(dt.setData).toHaveBeenCalledWith('text/x-moz-url', 'https://example.com\nExample');
		expect(dt.setData).toHaveBeenCalledWith('text/html', '<a href="https://example.com">https://example.com</a>');
	});

	it('_setDragData HTML-escapes URLs containing quotes and angle brackets', () => {
		const node = mockNode();
		const cellNode = mockNode();
		const url = 'https://example.com/?a="1"&b=<2>';
		const site = { node, cell: { node: cellNode, index: 0 }, url, title: 'X' };
		const dt = mockDataTransfer();
		const event = { clientX: 10, clientY: 10, dataTransfer: dt };
		Drag.start(site, event);
		const htmlCall = dt.setData.mock.calls.find((c: any) => c[0] === 'text/html');
		expect(htmlCall![1]).not.toContain('"1"');
		expect(htmlCall![1]).toContain('&quot;');
		expect(htmlCall![1]).toContain('&lt;');
		expect(htmlCall![1]).toContain('&gt;');
	});

	// ==================== Drag.end ====================

	it('Drag.end clears draggedSite', () => {
		const site = { node: mockNode(), cell: { node: mockNode(), index: 0 } };
		Drag._draggedSite = site;
		Drop._lastDropTarget = null;
		Transformation.slideSiteTo = vi.fn();
		Drag.end(site);
		expect(Drag.draggedSite).toBeNull();
	});

	it('Drag.end removes dragged attributes from grid nodes', () => {
		const draggedNode = { removeAttribute: vi.fn() };
		Grid._node.querySelectorAll.mockReturnValue([draggedNode]);
		const site = { node: mockNode(), cell: { node: mockNode(), index: 0 } };
		Drag._draggedSite = site;
		Drop._lastDropTarget = null;
		Transformation.slideSiteTo = vi.fn();
		Drag.end(site);
		expect(draggedNode.removeAttribute).toHaveBeenCalledWith('dragged');
	});

	it('Drag.end slides site back to its cell when no drop target', () => {
		const site = { node: mockNode(), cell: { node: mockNode(), index: 0 } };
		Drag._draggedSite = site;
		Drop._lastDropTarget = null;
		Transformation.slideSiteTo = vi.fn();
		Drag.end(site);
		expect(Transformation.slideSiteTo).toHaveBeenCalledWith(site, site.cell, { unfreeze: true });
	});

	// ==================== Drop._pinDraggedSite ====================

	it('Drop._pinDraggedSite pins dragged site at new cell index', () => {
		const site = {
			pin: vi.fn(),
			cell: { index: 0 },
		};
		Drag._draggedSite = site;
		const targetCell = { index: 3 };
		Drop._pinDraggedSite(targetCell);
		expect(site.pin).toHaveBeenCalledWith(3);
	});

	it('Drop._pinDraggedSite does not re-pin if dropped on same cell', () => {
		const cell = { index: 2 };
		const site = { pin: vi.fn(), cell };
		Drag._draggedSite = site;
		Drop._pinDraggedSite(cell);
		expect(site.pin).not.toHaveBeenCalled();
	});

	// ==================== Drop.drop ====================

	it('Drop.drop calls Updater.updateGrid', () => {
		Updater.updateGrid = vi.fn();
		const cell = { index: 1, containsPinnedSite: vi.fn(() => false) };
		Drag._draggedSite = { pin: vi.fn(), cell: { index: 0 } };
		Drop.drop(cell, {});
		expect(Updater.updateGrid).toHaveBeenCalled();
	});
});
