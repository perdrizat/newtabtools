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

// Use example.com — a simple, static page where drawWindow reliably works.
const TEST_URL = 'https://example.com/';

describe('E2E: Auto-thumbnail capture and display (slot 17)', () => {
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

	it('captures a thumbnail after navigating to a pinned URL and displays it on the new tab page', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Step 1: Pin the test URL so it enters the tile cache.
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Example',
						url: u,
					}, resolve);
				});
			}, TEST_URL);

			// Reload so the tile appears in the grid and the background's
			// Tiles._cache includes the URL.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Confirm precondition: tile is rendered and pinned.
			await page.waitForSelector('.newtab-control-pin[pinned]', { timeout: 15_000 });

			// Step 2: Navigate to the test URL. This triggers
			// webNavigation.onCompleted → thumbnail.js injection → drawWindow
			// capture → Thumbnails.save message back to background.
			await page.goto(TEST_URL, { waitUntil: 'load', timeout: 30_000 });

			// Give the content script time to capture and send the thumbnail.
			// thumbnail.js runs on document idle, draws the window, converts
			// to blob, and sends a message — a few seconds should suffice.
			await new Promise(r => setTimeout(r, 3000));

			// Step 3: Navigate back to the new tab page and check for thumbnail.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Wait for getThumbnails to fetch and apply the backgroundImage.
			const hasThumbnail = await waitForCondition(
				page,
				(testUrl) => {
					const g = window.Grid;
					if (!g || !g.sites) {return false;}
					const site = g.sites.find((s: any) => s && s.link && s.link.url === testUrl);
					if (!site) {return false;}
					const bg = site.thumbnail.style.backgroundImage;
					// Must be a blob: URL set by getThumbnails
					return bg && bg.startsWith('url(');
				},
				[TEST_URL],
				{ timeout: 15_000, message: 'Thumbnail backgroundImage not set on tile after navigation' }
			);

			expect(hasThumbnail).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'auto-thumbnail-capture');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('thumbnail persists across reload', async () => {
		// Relies on the thumbnail saved by the previous test.
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Wait for getThumbnails to apply the stored thumbnail.
			const hasThumbnail = await waitForCondition(
				page,
				(testUrl) => {
					const g = window.Grid;
					if (!g || !g.sites) {return false;}
					const site = g.sites.find((s: any) => s && s.link && s.link.url === testUrl);
					if (!site) {return false;}
					const bg = site.thumbnail.style.backgroundImage;
					return bg && bg.startsWith('url(');
				},
				[TEST_URL],
				{ timeout: 15_000, message: 'Thumbnail not found after reload — persistence failed' }
			);

			expect(hasThumbnail).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'auto-thumbnail-persist');
			throw e;
		} finally {
			// Clean up: unpin the tile so other tests start clean.
			const cleanPage = await openNewTab(browser);
			await waitForGridReady(cleanPage);
			try {
				await cleanPage.evaluate(async (u) => {
					return new Promise(resolve => {
						chrome.runtime.sendMessage({
							name: 'Tiles.unpinTile',
							url: u,
						}, resolve);
					});
				}, TEST_URL);
			} catch { /* best-effort cleanup */ }
			await cleanPage.close();
			await page.close();
		}
	}, 90_000);
});
