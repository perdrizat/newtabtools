import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
	getPref,
} from './_helpers.ts';

describe('E2E: Arbitrarily large tiles — flex layout scaling (slot 18)', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
	});

	it('tiles fill available grid space via CSS Grid layout', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const layout = await page.evaluate(() => {
				const grid = document.getElementById('newtab-grid');
				if (!grid) {return null;}

				const cells = grid.querySelectorAll('.newtab-cell');
				if (cells.length === 0) {return null;}

				const gridRect = grid.getBoundingClientRect();
				const cols = parseInt(getComputedStyle(grid).getPropertyValue('--ntt-cols')) || 3;
				const firstRowCells = [...cells].slice(0, cols);
				const cellRects = firstRowCells.map(c => {
					const r = c.getBoundingClientRect();
					return { width: Math.round(r.width), height: Math.round(r.height) };
				});

				const totalCellWidth = cellRects.reduce((sum, c) => sum + c.width, 0);

				return {
					gridWidth: Math.round(gridRect.width),
					gridHeight: Math.round(gridRect.height),
					cellsPerRow: cols,
					totalCells: cells.length,
					cellWidths: cellRects.map(c => c.width),
					cellHeights: cellRects.map(c => c.height),
					totalCellWidth,
				};
			});

			expect(layout).not.toBeNull();
			const l = layout!;

			expect(l.gridWidth).toBeGreaterThanOrEqual(600);
			expect(l.gridHeight).toBeGreaterThanOrEqual(400);

			for (const w of l.cellWidths) {
				expect(w).toBeGreaterThan(100);
			}
			for (const h of l.cellHeights) {
				expect(h).toBeGreaterThan(50);
			}

			const maxW = Math.max(...l.cellWidths);
			const minW = Math.min(...l.cellWidths);
			expect(maxW - minW).toBeLessThanOrEqual(2);

			const gapBudget = (l.cellsPerRow - 1) * 25;
			expect(l.totalCellWidth).toBeGreaterThan(l.gridWidth - gapBudget);
		} catch (e) {
			await captureFailure(page, 'large-tiles-grid');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('grid cell count matches Prefs.rows × Prefs.columns', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const totalCells = await page.evaluate(() => {
				const grid = document.getElementById('newtab-grid');
				return grid ? grid.querySelectorAll('.newtab-cell').length : null;
			});
			const rows = await getPref(page, 'rows') as number;
			const columns = await getPref(page, 'columns') as number;

			expect(totalCells).not.toBeNull();
			expect(rows).toBeGreaterThan(0);
			expect(columns).toBeGreaterThan(0);
			expect(totalCells).toBe(rows * columns);
		} catch (e) {
			await captureFailure(page, 'large-tiles-grid-shape');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
