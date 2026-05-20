/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: computeCellDimensions — pure cell-sizing helper extracted
 * from newTab.js. Used by applyTileAspect to drive CSS variables when the
 * tile aspect ratio is locked.
 *
 * Algorithm: given grid dimensions, rows × cols, inter-cell gap, and a target
 * aspect, returns the largest {cellWidth, cellHeight} that fits the entire
 * grid in both axes while preserving aspect. When aspect is null (fill mode),
 * returns null and the caller leaves cells under the default flex behavior.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) {throw new Error(`${methodName} not found`);}
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') {depth++;}
		else if (source[i] === '}') { depth--; if (depth === 0) {return source.substring(start, i + 1);} }
	}
	throw new Error('Unbalanced braces');
}

describe('computeCellDimensions — newTab.js', () => {
	let compute: (w: number, h: number, rows: number, cols: number, gap: number, aspect: number | null) =>
		{ cellWidth: number; cellHeight: number } | null;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const fn = extractMethod(source, 'computeCellDimensions');
		const code = `var newTabTools = { ${fn} };`;
		vm.runInThisContext(code, { filename: 'tile-aspect-compute-harness.js' });
		compute = (globalThis as any).newTabTools.computeCellDimensions.bind((globalThis as any).newTabTools);
	});

	it('returns null in fill mode (aspect = null)', () => {
		expect(compute(800, 600, 3, 3, 5, null)).toBe(null);
	});

	it('returns null for non-positive grid dimensions', () => {
		expect(compute(0, 600, 3, 3, 5, 16/9)).toBe(null);
		expect(compute(800, 0, 3, 3, 5, 16/9)).toBe(null);
	});

	it('width-constrained 1x1 16:9 fits a wide viewport without overflow', () => {
		// 800w × 200h, 1×1, no gap, 16:9: width=800 → height=450 > 200, so height-constrained.
		// height = 200 → width = 200 × 16/9 ≈ 355.56
		const r = compute(800, 200, 1, 1, 0, 16/9)!;
		expect(r.cellHeight).toBeCloseTo(200, 1);
		expect(r.cellWidth).toBeCloseTo(200 * 16/9, 1);
	});

	it('height-constrained 1x1 16:9 fits a tall viewport', () => {
		// 200w × 800h, 1×1, no gap, 16:9: width=200 → height=112.5; total height 112.5 ≤ 800 → width-constrained.
		const r = compute(200, 800, 1, 1, 0, 16/9)!;
		expect(r.cellWidth).toBeCloseTo(200, 1);
		expect(r.cellHeight).toBeCloseTo(200 * 9/16, 1);
	});

	it('square cells in 3x3 grid', () => {
		// 600w × 600h, 3×3, no gap, 1:1: cellW = 200, cellH = 200.
		const r = compute(600, 600, 3, 3, 0, 1)!;
		expect(r.cellWidth).toBeCloseTo(200, 1);
		expect(r.cellHeight).toBeCloseTo(200, 1);
	});

	it('portrait 3:4 cells in 1x3 grid', () => {
		// 900w × 600h, 1 row × 3 cols, no gap, 3:4 = 0.75:
		// width-constrained: cellW = 300, cellH = 300/0.75 = 400. Total height 400 ≤ 600 ✓.
		const r = compute(900, 600, 1, 3, 0, 3/4)!;
		expect(r.cellWidth).toBeCloseTo(300, 1);
		expect(r.cellHeight).toBeCloseTo(400, 1);
	});

	it('subtracts gap from both axes for multi-row × multi-col grids', () => {
		// 610w × 610h, 3×3, gap 5, 1:1: availW = 610 - 2*5 = 600, cellW = 200.
		// availH = 610 - 2*5 = 600, cellH = 200. Aspect 1:1 → cellW = 200.
		const r = compute(610, 610, 3, 3, 5, 1)!;
		expect(r.cellWidth).toBeCloseTo(200, 1);
		expect(r.cellHeight).toBeCloseTo(200, 1);
	});

	it('picks height-constrained when grid is short relative to row count', () => {
		// 1600w × 400h, 4 rows × 4 cols, gap 5.
		// width-constrained: availW = 1600 - 15 = 1585, cellW = 396.25; cellH at 16:9 = 222.89.
		// total height = 4 × 222.89 + 3*5 = 906.55 > 400 → height-constrained.
		// availH = 400 - 15 = 385, cellH = 96.25; cellW = 96.25 × 16/9 ≈ 171.11.
		const r = compute(1600, 400, 4, 4, 5, 16/9)!;
		expect(r.cellHeight).toBeCloseTo((400 - 15) / 4, 1);
		expect(r.cellWidth).toBeCloseTo(((400 - 15) / 4) * 16/9, 1);
	});
});
