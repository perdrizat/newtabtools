import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

describe('E2E: Recently-closed-tabs row (slot 24)', () => {
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

	it('recently-closed list is visible and close a tab to populate it', async () => {
		// First, open a tab to a known URL and close it to seed the session list.
		const seedPage = await browser.newPage();
		await seedPage.goto('https://example.com/', { waitUntil: 'load', timeout: 30_000 });
		await seedPage.close();

		// Now open the new tab page — recent list should show the closed tab.
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Enable Prefs.recent if not already (it's true by default).
			// Wait for the recently-closed row to appear with at least one item.
			const hasRecentItem = await waitForCondition(
				page,
				() => {
					const list = document.getElementById('newtab-recent');
					if (!list || list.hidden) {return false;}
					return list.querySelectorAll('a.ntt-recent-card').length > 0;
				},
				[],
				{ timeout: 10_000, message: 'Recently-closed list did not show any items' }
			);
			expect(hasRecentItem).toBeTruthy();

			// Verify the recently-closed row contains a link to the closed tab.
			const recentUrls = await page.evaluate(() => {
				const list = document.getElementById('newtab-recent');
				return [...list!.querySelectorAll('a.ntt-recent-card')].map(a => (a as HTMLAnchorElement).href);
			});
			expect(recentUrls.some(u => u.includes('example.com'))).toBe(true);
		} catch (e) {
			await captureFailure(page, 'recent-tabs');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('recently-closed row can be hidden via Prefs.recent toggle', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Set Prefs.recent = false (the drawer segmented button is the new
			// UI; here we drive the pref directly).
			await page.evaluate(() => { (window as any).Prefs.recent = false; });
			await new Promise(r => setTimeout(r, 500));

			const listHidden = await page.evaluate(() => {
				return document.getElementById('newtab-recent')!.hidden;
			});
			expect(listHidden).toBe(true);

			// Re-enable.
			await page.evaluate(() => { (window as any).Prefs.recent = true; });
		} catch (e) {
			await captureFailure(page, 'recent-tabs-toggle');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
