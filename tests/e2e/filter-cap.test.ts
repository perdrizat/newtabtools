import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

describe('E2E: Per-domain filter cap (slot 23)', () => {
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

	it('adding a filter via the UI creates a row in the filter table', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings panel.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Ensure history is enabled (filter button is only active when history is on).
			// Ensure history is enabled (the historytiles-filter button is
			// disabled when history is off).
			await page.evaluate(() => { (window as any).Prefs.history = true; });
			await new Promise(r => setTimeout(r, 300));

			// Open the drawer's Advanced tab where the filter UI lives.
			await page.evaluate(() => {
				(window as any).newTabTools.openDrawer();
				(window as any).newTabTools.switchDrawerTab('advanced');
			});
			await new Promise(r => setTimeout(r, 300));

			// Populate the filter table.
			await page.evaluate(() => {
				document.getElementById('historytiles-filter')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Filter panel is part of the Advanced tab and is visible.
			const filterVisible = await page.evaluate(() => {
				const el = document.getElementById('options-filter') as HTMLElement;
				return el && el.offsetParent !== null;
			});
			expect(filterVisible).toBe(true);

			// Add a filter: domain "test.example.com", count 2.
			await page.evaluate(() => {
				const hostInput = document.getElementById('options-filter-host') as HTMLInputElement;
				const countInput = document.getElementById('options-filter-count') as HTMLInputElement;
				hostInput.value = 'test.example.com';
				countInput.value = '2';
				// Trigger input events to enable the set button.
				hostInput.dispatchEvent(new Event('input', { bubbles: true }));
				countInput.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			// Click set.
			await page.evaluate(() => {
				document.getElementById('options-filter-set')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify the filter appears in the table body.
			const filterRow = await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody');
				if (!tbody) {return null;}
				const rows = tbody.querySelectorAll('tr');
				for (const row of rows) {
					const domain = row.cells[0]?.textContent;
					if (domain === 'test.example.com') {
						const count = row.cells[2]?.querySelector('span')?.textContent;
						return { domain, count };
					}
				}
				return null;
			});

			expect(filterRow).not.toBeNull();
			expect(filterRow!.domain).toBe('test.example.com');
			expect(filterRow!.count).toBe('2');

			// Verify the filter is persisted via Filters.getList().
			const stored = await page.evaluate(() => {
				return Filters.getList();
			});
			expect(stored['test.example.com']).toBe(2);

			// Clean up: remove the filter by setting it to -1 (unlimited).
			await page.evaluate(() => {
				Filters.setFilter('test.example.com', -1);
			});
		} catch (e) {
			await captureFailure(page, 'filter-cap-add');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('plus/minus buttons adjust filter count', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Pre-set a filter.
			await page.evaluate(() => {
				Filters.setFilter('adjust.example.com', 3);
			});

			// Open settings → filter panel.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => {
				const cb = document.querySelector('[name="history"]') as HTMLInputElement;
				if (!cb.checked) {
					cb.checked = true;
					cb.dispatchEvent(new Event('change', { bubbles: true }));
				}
			});
			await new Promise(r => setTimeout(r, 300));
			await page.evaluate(() => {
				document.getElementById('historytiles-filter')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Find the filter row and click plus.
			const countBefore = await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'adjust.example.com') {
						return row.cells[2]?.querySelector('span')?.textContent;
					}
				}
				return null;
			});
			expect(countBefore).toBe('3');

			// Click plus button.
			await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'adjust.example.com') {
						(row.querySelector('.plus-button') as HTMLElement)!.click();
						break;
					}
				}
			});
			await new Promise(r => setTimeout(r, 300));

			const countAfterPlus = await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'adjust.example.com') {
						return row.cells[2]?.querySelector('span')?.textContent;
					}
				}
				return null;
			});
			expect(countAfterPlus).toBe('4');

			// Click minus button.
			await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'adjust.example.com') {
						(row.querySelector('.minus-button') as HTMLElement)!.click();
						break;
					}
				}
			});
			await new Promise(r => setTimeout(r, 300));

			const countAfterMinus = await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'adjust.example.com') {
						return row.cells[2]?.querySelector('span')?.textContent;
					}
				}
				return null;
			});
			expect(countAfterMinus).toBe('3');

			// Clean up.
			await page.evaluate(() => {
				Filters.setFilter('adjust.example.com', -1);
			});
		} catch (e) {
			await captureFailure(page, 'filter-cap-buttons');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
