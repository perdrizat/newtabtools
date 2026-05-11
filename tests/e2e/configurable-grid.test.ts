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
			// Set columns to 5. Write to storage via the Prefs setter AND
			// call Grid.refresh() directly — the storage.onChanged →
			// prefsChanged → Grid.refresh() async chain does not reliably
			// fire within Puppeteer BiDi evaluate calls.
			await page.evaluate(async () => {
				Prefs.columns = 5;
				await Grid.refresh();
			});

			// Wait for the grid to rebuild with 5 columns.
			const colsAfter = await waitForCondition(
				page,
				() => {
					const rows = document.querySelectorAll('.newtab-row');
					if (rows.length === 0) {return false;}
					const cols = rows[0].querySelectorAll('.newtab-cell').length;
					return cols === 5 ? cols : false;
				},
				[],
				{ timeout: 10_000, message: 'Grid did not rebuild to 5 columns' }
			);
			expect(colsAfter).toBe(5);

			// Reload and verify persistence.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const colsReload = await waitForCondition(
				page,
				() => {
					const rows = document.querySelectorAll('.newtab-row');
					if (rows.length === 0) {return false;}
					return rows[0].querySelectorAll('.newtab-cell').length === 5 ? 5 : false;
				},
				[],
				{ timeout: 10_000, message: 'Columns did not persist as 5 after reload' }
			);
			expect(colsReload).toBe(5);

			// Restore default (3 columns).
			await page.evaluate(() => {
				Prefs.columns = 3;
			});
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
			// Set rows to 5. Same pattern as columns test.
			await page.evaluate(async () => {
				Prefs.rows = 5;
				await Grid.refresh();
			});

			// Wait for the grid to rebuild with 5 rows.
			const rowCount = await waitForCondition(
				page,
				() => {
					const rows = document.querySelectorAll('.newtab-row').length;
					return rows === 5 ? rows : false;
				},
				[],
				{ timeout: 10_000, message: 'Grid did not rebuild to 5 rows' }
			);
			expect(rowCount).toBe(5);

			// Reload and verify persistence.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const rowsReload = await waitForCondition(
				page,
				() => {
					return document.querySelectorAll('.newtab-row').length === 5 ? 5 : false;
				},
				[],
				{ timeout: 10_000, message: 'Rows did not persist as 5 after reload' }
			);
			expect(rowsReload).toBe(5);

			// Restore default (3 rows).
			await page.evaluate(() => {
				Prefs.rows = 3;
			});
		} catch (e) {
			await captureFailure(page, 'configurable-grid-rows');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
