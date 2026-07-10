/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression tests for the CSS invariants that the drag-and-drop pipeline
 * depends on. These caught a cluster of bugs introduced during the NTT v2
 * grid migration:
 *
 *   1. `.newtab-cell { position: relative }` broke the drag math because the
 *      cell became the offsetParent of any `[frozen]` tile — `style.left`
 *      then meant "left from the cell" instead of "left from the page", so
 *      the dragged tile flew to (cellLeft + clientX).
 *   2. `#newtab-grid` set `grid-template-columns` but no `grid-template-rows`,
 *      so row heights auto-sized to (empty) content as soon as the rearrange
 *      gave all tiles `[frozen]`. Rows collapsed to 0 and the grid "exploded"
 *      into giant vertical gaps mid-drag.
 *   3. Aspect-locked modes need to opt out of the rows: 1fr rule because the
 *      cell sizing comes from `aspect-ratio` + JS-set `--cell-width`/`--cell-height`.
 *
 * These are source-grep tests because the bugs are pure CSS regressions that
 * are best surfaced by reading the stylesheet directly — they don't require
 * (and can't be cleanly written with) a behavioural test in jsdom.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const FX_PATH = path.resolve(__dirname, '../../webextension/fx-newTab.js');

describe('Drag invariants — CSS rules the drag pipeline depends on', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: critical drag invariants
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('.newtab-cell must NOT be `position: relative` (would break drag offsetParent)', () => {
		// Match `.newtab-cell { ... position: relative ... }` regardless of
		// property order or whitespace within the block.
		const cellBlockRe = /\.newtab-cell\s*\{[^}]*\}/g;
		const blocks = css.match(cellBlockRe) || [];
		for (const block of blocks) {
			expect(block).not.toMatch(/position:\s*relative/);
		}
	});

	it('#newtab-grid declares `grid-template-rows: repeat(var(--ntt-rows...))` so rows do not collapse', () => {
		expect(css).toMatch(/#newtab-grid\s*\{[^}]*grid-template-rows:\s*repeat\(var\(--ntt-rows[^)]*\),\s*1fr\)/);
	});

	it('#newtab-grid declares `grid-template-columns: repeat(var(--ntt-cols...))` (paired with rows)', () => {
		// Sanity: rows would be useless without matching columns.
		expect(css).toMatch(/#newtab-grid\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--ntt-cols[^)]*\),\s*1fr\)/);
	});

	it('aspect-locked modes opt out of `grid-template-rows: 1fr`', () => {
		// In aspect-locked modes (16-9, 4-3, 1-1, 3-4) the cells get
		// explicit aspect-ratio + JS-set --cell-width/--cell-height, so
		// the 1fr rows rule must NOT apply. `grid-template-rows: none`
		// resets it back to auto.
		expect(css).toMatch(/:root\[tileaspect="(?:16-9|4-3|1-1|3-4)"\][^{}]*#newtab-grid\s*\{[^}]*grid-template-rows:\s*none/);
	});

	it('.newtab-site[frozen] is `position: absolute` (drag math depends on this)', () => {
		expect(css).toMatch(/\.newtab-site\[frozen\]\s*\{[^}]*position:\s*absolute/);
	});

	it('#newtab-vertical-margin is `position: relative` (acts as the drag offsetParent)', () => {
		expect(css).toMatch(/#newtab-vertical-margin\s*\{[^}]*position:\s*relative/);
	});
});

describe('Drag invariants — JS contracts the drag pipeline depends on', () => {
	let fxSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: drag invariants
		fxSource = fs.readFileSync(FX_PATH, 'utf8');
	});

	it('--ntt-rows is set on the grid alongside --ntt-cols', () => {
		// Required so the `grid-template-rows: repeat(var(--ntt-rows...))`
		// CSS rule has a value to use; otherwise it falls back to the
		// default of 3 and a 4×4 grid renders its 4th row at auto size.
		// The `(?:\/\*\*.*?\*\/\s*\(\s*)*` bit tolerates chrome-prep C3b's
		// JSDoc type-assertion wrappers around the value (type-only, erased
		// at runtime — `setProperty`'s string param needs a cast since
		// `Prefs.rows`/`columns` are numbers) without loosening what the test
		// actually checks: that `Prefs.rows`/`Prefs.columns` is the value.
		expect(fxSource).toMatch(/setProperty\(\s*['"]--ntt-rows['"]\s*,\s*(?:\/\*\*.*?\*\/\s*\(\s*)*Prefs\.rows\s*\)+/);
		expect(fxSource).toMatch(/setProperty\(\s*['"]--ntt-cols['"]\s*,\s*(?:\/\*\*.*?\*\/\s*\(\s*)*Prefs\.columns\s*\)+/);
	});

	it('Drag.start refreshes the cell position cache before computing offsets', () => {
		// Without this the drag math uses Grid.cells[*].position from the
		// last cacheCellPositions call, which is stale if the drawer
		// opened/closed since then (push-layout shrinks the grid but no
		// resize event fires).
		const startBlock = fxSource.match(/start\(site,\s*event\)\s*\{[\s\S]*?_setDragData/);
		expect(startBlock).not.toBeNull();
		expect(startBlock![0]).toMatch(/Grid\.cacheCellPositions\(\)/);
	});

	it('Grid.cacheCellPositions early-returns when there are no cells', () => {
		// Defensive guard: openDrawer/closeDrawer schedule a refresh via
		// setTimeout, and the page can be torn down (cells gone) between
		// scheduling and firing. The guard also keeps the integration
		// drag-reorder harness (which mocks an empty Grid) green.
		const cacheBlock = fxSource.match(/cacheCellPositions\(\)\s*\{[\s\S]*?\},/);
		expect(cacheBlock).not.toBeNull();
		expect(cacheBlock![0]).toMatch(/(!Grid\.cells|Grid\.cells\.length\s*===?\s*0)/);
	});
});
