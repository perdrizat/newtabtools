/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tile tab default behaviour + width containment.
 *
 * Two follow-ups to Phase 3-2:
 *
 *   - When the drawer opens on the Tile tab (or the user switches to it)
 *     with no selection, default to the first available tile (top-left)
 *     instead of leaving the "Click a tile to edit" empty state showing.
 *     The empty state still surfaces when there are no tiles at all.
 *
 *   - The `#options-tile` legacy editor markup used to overflow the 360-px
 *     drawer envelope: the thumbnail wrap had ~32 px of inline padding, the
 *     bg-colour row carried 5 children, and the file inputs/buttons in the
 *     saved-thumbnail row had no `min-width` floor. Drawer-scoped CSS now
 *     pins everything to `min-width: 0 / max-width: 100%`.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) { throw new Error(`${methodName} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

// ===========================================================================
// Auto-select first tile on Tile tab open / switch
// ===========================================================================

describe('Tile tab auto-selects the first available tile', () => {
	let harness: any;
	let selectedIndices: (number | null)[];

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading methods for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const openDrawer = extractMethod(source, 'openDrawer');
		const switchDrawerTab = extractMethod(source, 'switchDrawerTab');
		const autoSelect = extractMethod(source, '_autoSelectFirstTileIfNeeded');
		const code = `
			var _tileDefaultsHarness = {
				${openDrawer},
				${switchDrawerTab},
				${autoSelect},
				_refreshGridPositionsAfterDrawerTransition() {},
				get selectedSiteIndex() { return this._selectedSiteIndex; },
				set selectedSiteIndex(i) { this._selectedSiteIndex = i; this._setLog.push(i); },
				_setLog: [],
			};
		`;
		vm.runInThisContext(code, { filename: 'tile-defaults-harness.js' });
		harness = (globalThis as any)._tileDefaultsHarness;
	});

	beforeEach(() => {
		document.documentElement.removeAttribute('drawer-open');
		document.documentElement.setAttribute('drawer-tab', 'tile');
		document.body.innerHTML = `
			<aside id="ntt-drawer"></aside>
			<nav>
				<button data-drawer-tab="tile" data-active="true"></button>
				<button data-drawer-tab="page" data-active="false"></button>
				<button data-drawer-tab="advanced" data-active="false"></button>
			</nav>
			<section data-drawer-panel="tile"></section>
			<section data-drawer-panel="page" hidden=""></section>
			<section data-drawer-panel="advanced" hidden=""></section>
		`;
		harness._selectedSiteIndex = null;
		harness._setLog = [];
		selectedIndices = harness._setLog;
		const makeSite = (i: number | null) => i == null ? null : {
			node: Object.assign(document.createElement('div'), { _idx: i }),
			link: { url: `https://x.example/${i}` },
		};
		(globalThis as any).Grid = { sites: [makeSite(0), makeSite(1), makeSite(2)] };
	});

	it('openDrawer on the Tile tab auto-selects index 0 when nothing is selected', () => {
		harness.openDrawer();
		expect(selectedIndices).toContain(0);
		expect(harness.selectedSiteIndex).toBe(0);
	});

	it('openDrawer on a non-Tile tab does NOT touch the selection', () => {
		document.documentElement.setAttribute('drawer-tab', 'page');
		harness.openDrawer();
		expect(selectedIndices).not.toContain(0);
		expect(harness.selectedSiteIndex).toBeNull();
	});

	it('openDrawer leaves an existing selection alone', () => {
		harness._selectedSiteIndex = 2;
		harness.openDrawer();
		expect(selectedIndices).not.toContain(0);
		expect(harness.selectedSiteIndex).toBe(2);
	});

	it('switchDrawerTab("tile") auto-selects index 0 when nothing is selected', () => {
		document.documentElement.setAttribute('drawer-tab', 'page');
		harness.switchDrawerTab('tile');
		expect(selectedIndices).toContain(0);
	});

	it('skips null slots and picks the first non-null tile', () => {
		const makeSite = (i: number) => ({
			node: Object.assign(document.createElement('div'), { _idx: i }),
			link: { url: `https://x.example/${i}` },
		});
		(globalThis as any).Grid = { sites: [null, null, makeSite(2), makeSite(3)] };
		harness.openDrawer();
		expect(harness.selectedSiteIndex).toBe(2);
	});

	it('no-ops when the grid is empty so the empty state still shows', () => {
		(globalThis as any).Grid = { sites: [null, null, null] };
		harness.openDrawer();
		expect(harness.selectedSiteIndex).toBeNull();
	});
});

// ===========================================================================
// CSS containment — no #options-tile child can exceed the drawer width
// ===========================================================================

describe('Tile editor width containment — newTab.css', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rule presence
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	function ruleBody(selector: string): string {
		// Match the selector followed only by whitespace and a `{` — without
		// this we'd false-positive when one selector is a prefix of another
		// (e.g. `#options-thumbnail` vs `#options-thumbnail-wrap`).
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const rule = new RegExp(`${escaped}\\s*\\{`);
		const m = css.match(rule);
		if (!m || m.index === undefined) { throw new Error(`selector ${selector} not found`); }
		const braceStart = css.indexOf('{', m.index);
		const braceEnd = css.indexOf('}', braceStart);
		return css.substring(braceStart + 1, braceEnd);
	}

	it('drops the 1em horizontal padding from #options-thumbnail-wrap inside the drawer', () => {
		// The wrap dates back to the 752-px modal; in a 360-px drawer the 32-px
		// horizontal padding swallows space the thumbnail needs.
		const body = ruleBody('#ntt-drawer-body #options-thumbnail-wrap');
		expect(body).toMatch(/padding[^;]*0/);
	});

	it('clamps #options-thumbnail to the drawer width', () => {
		const body = ruleBody('#ntt-drawer-body #options-thumbnail');
		expect(body).toMatch(/max-width:\s*100%/);
	});

	it('forces #options-tile to behave as a constrained flex child', () => {
		// `min-width: 0` is the standard escape hatch for nested-flex overflow:
		// without it, content drives the min-width and the column overflows.
		const body = ruleBody('#ntt-drawer-body #options-tile');
		expect(body).toMatch(/min-width:\s*0/);
		expect(body).toMatch(/max-width:\s*100%/);
	});

	it('caps every #options-tile descendant at 100% width with border-box sizing', () => {
		const body = ruleBody('#ntt-drawer-body #options-tile *');
		expect(body).toMatch(/max-width:\s*100%/);
		expect(body).toMatch(/box-sizing:\s*border-box/);
	});

	it('lets the bg-colour and saved-thumb rows wrap when the children would overflow', () => {
		const body = ruleBody('#ntt-drawer-body #options-tile .options-row');
		expect(body).toMatch(/flex-wrap:\s*wrap/);
		expect(body).toMatch(/min-width:\s*0/);
	});
});
