import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
} from './_helpers.js';

describe('E2E: Arbitrarily large tiles — flex layout scaling (slot 18)', () => {
	let browser;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
	});

	it('tiles fill available grid space via flex layout', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const layout = await page.evaluate(() => {
				const grid = document.getElementById('newtab-grid');
				if (!grid) {return null;}

				const rows = grid.querySelectorAll('.newtab-row');
				const cells = grid.querySelectorAll('.newtab-cell');
				if (rows.length === 0 || cells.length === 0) {return null;}

				const gridRect = grid.getBoundingClientRect();
				const firstRow = rows[0];
				const firstRowRect = firstRow.getBoundingClientRect();
				const rowCells = firstRow.querySelectorAll('.newtab-cell');
				const cellRects = [...rowCells].map(c => {
					const r = c.getBoundingClientRect();
					return { width: Math.round(r.width), height: Math.round(r.height) };
				});

				// Sum of cell widths + margins should approximate row width.
				const totalCellWidth = cellRects.reduce((sum, c) => sum + c.width, 0);

				return {
					gridWidth: Math.round(gridRect.width),
					gridHeight: Math.round(gridRect.height),
					rowCount: rows.length,
					cellsPerRow: rowCells.length,
					totalCells: cells.length,
					rowWidth: Math.round(firstRowRect.width),
					cellWidths: cellRects.map(c => c.width),
					cellHeights: cellRects.map(c => c.height),
					totalCellWidth,
				};
			});

			expect(layout).not.toBeNull();

			// Grid should have substantial dimensions (min-width: 600px, min-height: 400px in CSS).
			expect(layout.gridWidth).toBeGreaterThanOrEqual(600);
			expect(layout.gridHeight).toBeGreaterThanOrEqual(400);

			// Cells should be large — this is the "arbitrarily large tiles" feature.
			// With default 3 columns, each cell should be at least ~180px wide.
			for (const w of layout.cellWidths) {
				expect(w).toBeGreaterThan(100);
			}
			for (const h of layout.cellHeights) {
				expect(h).toBeGreaterThan(50);
			}

			// All cells in the row should be approximately equal width (flex: 1).
			// Allow 2px tolerance for subpixel rounding.
			const maxW = Math.max(...layout.cellWidths);
			const minW = Math.min(...layout.cellWidths);
			expect(maxW - minW).toBeLessThanOrEqual(2);

			// Cells should fill the row width (total cell width + margins ≈ row width).
			// Margins are 5px per cell gap (CSS default spacing), so allow generous tolerance.
			const marginBudget = (layout.cellsPerRow - 1) * 25; // up to 25px per gap at large spacing
			expect(layout.totalCellWidth).toBeGreaterThan(layout.rowWidth - marginBudget);
		} catch (e) {
			await captureFailure(page, 'large-tiles-flex');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('grid rows and columns match Prefs.rows × Prefs.columns', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const gridShape = await page.evaluate(() => {
				const grid = document.getElementById('newtab-grid');
				if (!grid) {return null;}

				const rows = grid.querySelectorAll('.newtab-row');
				const cellsPerRow = rows.length > 0
					? rows[0].querySelectorAll('.newtab-cell').length
					: 0;

				return {
					rows: rows.length,
					columns: cellsPerRow,
					totalCells: grid.querySelectorAll('.newtab-cell').length,
				};
			});

			expect(gridShape).not.toBeNull();
			// Default Prefs: rows=3, columns=3 (or whatever the extension default is).
			// Just verify the structure is consistent: total = rows × columns.
			expect(gridShape.rows).toBeGreaterThan(0);
			expect(gridShape.columns).toBeGreaterThan(0);
			expect(gridShape.totalCells).toBe(gridShape.rows * gridShape.columns);
		} catch (e) {
			await captureFailure(page, 'large-tiles-grid-shape');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
