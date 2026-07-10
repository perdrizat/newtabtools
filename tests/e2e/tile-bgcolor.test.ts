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
	siteLinkExists,
	removeTileByUrl,
} from './_helpers.ts';

const TEST_URL = 'https://bgcolor-test.example.com/';

describe('E2E: Per-tile background color (slot 22)', () => {
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
			await waitForCondition(page, siteLinkExists, [TEST_URL], { timeout: 10_000, message: 'Pinned tile not in grid' });

			// Select the pinned tile for editing via its in-tile "edit" action
			// button (site.js's Site._onClick 'edit' case: opens the
			// drawer, switches to the Tile tab, and sets selectedSiteIndex —
			// all in one real click, no page-global writes).
			await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				const editBtn = site!.querySelector('.ntt-action-btn[data-action="edit"]') as HTMLElement;
				editBtn.click();
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 500));

			// Set background color via the color input. The change event
			// enables the set button (initially disabled when no bgcolor).
			await page.evaluate(() => {
				const colorInput = document.getElementById('options-bgcolor-input') as HTMLInputElement;
				colorInput.value = '#ff0000';
				colorInput.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			// Click set button (now enabled after change event).
			await page.evaluate(() => {
				document.getElementById('options-bgcolor-set')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify the tile's thumbnail has the background color.
			const bgColor = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) {return null;}
				const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
				return thumb && thumb.style.backgroundColor;
			}, TEST_URL);
			expect(bgColor).toBe('rgb(255, 0, 0)');

			// Reset the color.
			await page.evaluate(() => {
				document.getElementById('options-bgcolor-reset')!.click();
			});
			await new Promise(r => setTimeout(r, 300));

			const bgColorAfterReset = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) {return 'still-set';}
				const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
				return thumb && thumb.style.backgroundColor;
			}, TEST_URL);
			// After reset, backgroundColor should be empty or null.
			expect(bgColorAfterReset === '' || bgColorAfterReset === null).toBe(true);

			// Cleanup: remove. (`Tiles.unpinTile` is not a real wire name —
			// see removeTileByUrl's JSDoc in _helpers.ts.)
			await removeTileByUrl(page, TEST_URL);
		} catch (e) {
			await captureFailure(page, 'tile-bgcolor');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
