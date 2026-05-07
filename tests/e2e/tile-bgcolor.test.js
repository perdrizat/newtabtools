import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
} from './_helpers.js';

const TEST_URL = 'https://bgcolor-test.example.com/';

describe('E2E: Per-tile background color (slot 22)', () => {
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

	it('setting bgcolor via settings changes the tile thumbnail backgroundColor', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Pin a tile so we have something to edit.
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'BgColor Test',
						url: u,
					}, resolve);
				});
			}, TEST_URL);

			// Reload to show pinned tile.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Wait for the tile to appear in grid.
			await waitForCondition(
				page,
				(u) => {
					const g = window.Grid;
					return g && g.sites && g.sites.some(s => s && s.url === u);
				},
				[TEST_URL],
				{ timeout: 10_000, message: 'Pinned tile not in grid' }
			);

			// Open settings and select the pinned tile.
			await page.evaluate((u) => {
				document.getElementById('options-toggle').click();
				// Find the index of our tile and select it.
				const idx = window.Grid.sites.findIndex(s => s && s.url === u);
				if (idx >= 0) {
					newTabTools.selectedSiteIndex = idx;
				}
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 500));

			// Set background color via the color input. The change event
			// enables the set button (initially disabled when no bgcolor).
			await page.evaluate(() => {
				const colorInput = document.getElementById('options-bgcolor-input');
				colorInput.value = '#ff0000';
				colorInput.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			// Click set button (now enabled after change event).
			await page.evaluate(() => {
				document.getElementById('options-bgcolor-set').click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify the tile's thumbnail has the background color.
			const bgColor = await page.evaluate((u) => {
				const site = window.Grid.sites.find(s => s && s.url === u);
				if (!site) {return null;}
				return site.thumbnail.style.backgroundColor;
			}, TEST_URL);
			expect(bgColor).toBe('rgb(255, 0, 0)');

			// Reset the color.
			await page.evaluate(() => {
				document.getElementById('options-bgcolor-reset').click();
			});
			await new Promise(r => setTimeout(r, 300));

			const bgColorAfterReset = await page.evaluate((u) => {
				const site = window.Grid.sites.find(s => s && s.url === u);
				if (!site) {return 'still-set';}
				return site.thumbnail.style.backgroundColor;
			}, TEST_URL);
			// After reset, backgroundColor should be empty or null.
			expect(bgColorAfterReset === '' || bgColorAfterReset === null).toBe(true);

			// Cleanup: unpin.
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.unpinTile',
						url: u,
					}, resolve);
				});
			}, TEST_URL);
		} catch (e) {
			await captureFailure(page, 'tile-bgcolor');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
