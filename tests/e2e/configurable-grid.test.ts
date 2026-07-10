import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	setPrefs,
} from './_helpers.ts';

describe('E2E: Configurable columns and rows (slot 19)', () => {
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

	it('changing columns via settings updates grid and persists across reload', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Writing the pref triggers the Prefs.onChange listener
			// (page-main.js), which calls Grid.refresh() automatically for
			// rows/columns changes — no direct call needed.
			await setPrefs(page, { columns: 5 });

			const colsAfter = await waitForCondition(
				page,
				() => {
					const grid = document.getElementById('newtab-grid');
					if (!grid) {return false;}
					const cols = parseInt(getComputedStyle(grid).getPropertyValue('--ntt-cols')) || 0;
					return cols === 5 ? cols : false;
				},
				[],
				{ timeout: 10_000, message: 'Grid did not rebuild to 5 columns' }
			);
			expect(colsAfter).toBe(5);

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const colsReload = await waitForCondition(
				page,
				() => {
					const grid = document.getElementById('newtab-grid');
					if (!grid) {return false;}
					const cols = parseInt(getComputedStyle(grid).getPropertyValue('--ntt-cols')) || 0;
					return cols === 5 ? 5 : false;
				},
				[],
				{ timeout: 10_000, message: 'Columns did not persist as 5 after reload' }
			);
			expect(colsReload).toBe(5);

			await setPrefs(page, { columns: 3 });
		} catch (e) {
			await captureFailure(page, 'configurable-grid-columns');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('changing rows via settings updates grid and persists across reload', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			await setPrefs(page, { rows: 5 });

			const cellCount = await waitForCondition(
				page,
				() => {
					const grid = document.getElementById('newtab-grid');
					if (!grid) {return false;}
					const cells = grid.querySelectorAll('.newtab-cell').length;
					const cols = parseInt(getComputedStyle(grid).getPropertyValue('--ntt-cols')) || 3;
					return cells === 5 * cols ? cells : false;
				},
				[],
				{ timeout: 10_000, message: 'Grid did not rebuild to 5 rows' }
			);
			expect(cellCount).toBe(15);

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const cellsReload = await waitForCondition(
				page,
				() => {
					const grid = document.getElementById('newtab-grid');
					if (!grid) {return false;}
					const cells = grid.querySelectorAll('.newtab-cell').length;
					return cells === 15 ? 15 : false;
				},
				[],
				{ timeout: 10_000, message: 'Rows did not persist as 5 after reload' }
			);
			expect(cellsReload).toBe(15);

			await setPrefs(page, { rows: 3 });
		} catch (e) {
			await captureFailure(page, 'configurable-grid-rows');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
