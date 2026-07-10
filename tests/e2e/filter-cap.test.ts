import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	waitForCondition,
	resetTestState,
	setPrefs,
	openDrawerUI,
	switchDrawerTabUI,
	getFilters,
	setFilter,
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
			await setPrefs(page, { history: true });
			// Poll rather than fixed-sleep: updateUI's history branch enables
			// #historytiles-filter (`disabled = !history`), and the click
			// below silently no-ops on a still-disabled button.
			await waitForCondition(
				page,
				() => {
					const btn = document.getElementById('historytiles-filter') as HTMLButtonElement | null;
					return !!btn && !btn.disabled;
				},
				[],
				{ timeout: 10_000, message: '#historytiles-filter never became enabled after history=true' }
			);

			// Open the drawer's Advanced tab where the filter UI lives.
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'advanced');
			await new Promise(r => setTimeout(r, 300));

			// Populate the filter table.
			await page.evaluate(() => {
				document.getElementById('historytiles-filter')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// The Filter… button toggles the panel; one click opens (+ populates) it.
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

			// Verify the filter is persisted via the `filters` storage key
			// (Filters.getList()'s equivalent).
			const stored = await getFilters(page);
			expect(stored['test.example.com']).toBe(2);

			// Clean up: remove the filter by setting it to -1 (unlimited).
			await setFilter(page, 'test.example.com', -1);
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
			await setFilter(page, 'adjust.example.com', 3);

			// Open settings → filter panel.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			// History is a copper toggle now (no native checkbox) — enable it via
			// the pref, which updateUI mirrors onto the toggle + enables the filter.
			await setPrefs(page, { history: true });
			// Poll rather than fixed-sleep: updateUI's history branch enables
			// #historytiles-filter (`disabled = !history`), and the click
			// below silently no-ops on a still-disabled button.
			await waitForCondition(
				page,
				() => {
					const btn = document.getElementById('historytiles-filter') as HTMLButtonElement | null;
					return !!btn && !btn.disabled;
				},
				[],
				{ timeout: 10_000, message: '#historytiles-filter never became enabled after history=true' }
			);
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
			await setFilter(page, 'adjust.example.com', -1);
		} catch (e) {
			await captureFailure(page, 'filter-cap-buttons');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('the Filter… button toggles the panel open and closed', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await setPrefs(page, { history: true });
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'advanced');
			await new Promise(r => setTimeout(r, 300));

			// Panel starts hidden (it's a toggle now, not always-visible).
			const hiddenInitially = await page.evaluate(() =>
				(document.getElementById('options-filter') as HTMLElement).hidden);
			expect(hiddenInitially).toBe(true);

			// First click → open + aria-expanded=true.
			await page.evaluate(() => document.getElementById('historytiles-filter')!.click());
			await new Promise(r => setTimeout(r, 300));
			const afterOpen = await page.evaluate(() => {
				const el = document.getElementById('options-filter') as HTMLElement;
				return { hidden: el.hidden, expanded: document.getElementById('historytiles-filter')!.getAttribute('aria-expanded') };
			});
			expect(afterOpen.hidden).toBe(false);
			expect(afterOpen.expanded).toBe('true');

			// Second click → collapse + aria-expanded=false.
			await page.evaluate(() => document.getElementById('historytiles-filter')!.click());
			await new Promise(r => setTimeout(r, 300));
			const afterClose = await page.evaluate(() => {
				const el = document.getElementById('options-filter') as HTMLElement;
				return { hidden: el.hidden, expanded: document.getElementById('historytiles-filter')!.getAttribute('aria-expanded') };
			});
			expect(afterClose.hidden).toBe(true);
			expect(afterClose.expanded).toBe('false');
		} catch (e) {
			await captureFailure(page, 'filter-toggle');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('the ✕ remove control deletes a filter entry and its row', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await setFilter(page, 'remove.example.com', 2);
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await setPrefs(page, { history: true });
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'advanced');
			await new Promise(r => setTimeout(r, 300));
			await page.evaluate(() => document.getElementById('historytiles-filter')!.click());
			await new Promise(r => setTimeout(r, 500));

			// The filter row carries an explicit ✕ remove control.
			const hasRemove = await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'remove.example.com') {
						return !!row.querySelector('.ntt-filter-remove');
					}
				}
				return false;
			});
			expect(hasRemove).toBe(true);

			// Click it → the filter entry is deleted and the row disappears.
			await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'remove.example.com') {
						(row.querySelector('.ntt-filter-remove') as HTMLElement).click();
						break;
					}
				}
			});
			await new Promise(r => setTimeout(r, 400));

			const stored = await getFilters(page);
			expect(stored['remove.example.com']).toBeUndefined();

			const rowGone = await page.evaluate(() => {
				const tbody = document.querySelector('#options-filter tbody')!;
				for (const row of tbody.querySelectorAll('tr')) {
					if (row.cells[0]?.textContent === 'remove.example.com') { return false; }
				}
				return true;
			});
			expect(rowGone).toBe(true);
		} catch (e) {
			await captureFailure(page, 'filter-remove');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	// NOTE: the host-match/limit logic lives in the BACKGROUND module (tiles.js;
	// the page loads tiles-shim.js), so it is unit-tested at the Fast tier where
	// tiles.js is loaded directly (tests/integration/filter-cap.test.ts —
	// Tiles._hostFilteredOut + getAllTiles with mocked topSites). It is not
	// reachable from this page context, and the E2E profile has no seeded
	// history to drive a real reduction, so E2E here covers the page-side filter
	// UI only (toggle, ✕ remove, add-via-UI, steppers).
});
