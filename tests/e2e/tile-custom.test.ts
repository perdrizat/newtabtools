import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

/**
 * Select a pinned tile for editing via its own in-tile "edit" action button
 * (fx-newTab.js's `Site._onClick` 'edit' case: opens the drawer, switches to
 * the Tile tab, AND sets `selectedSiteIndex` — all from one real click, no
 * page-global writes).
 */
async function selectTileForEdit(page: import('puppeteer-core').Page, url: string): Promise<void> {
	await page.evaluate((u) => {
		const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
			.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
		const editBtn = site!.querySelector('.ntt-action-btn[data-action="edit"]') as HTMLElement;
		editBtn.click();
	}, url);
}

/** Fetch the persisted tile record via the frozen `Tiles.getTile` wire message. */
async function getStoredTile(page: import('puppeteer-core').Page, url: string): Promise<any> {
	return page.evaluate((u) => new Promise(resolve => {
		chrome.runtime.sendMessage({ name: 'Tiles.getTile', url: u }, resolve);
	}), url);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL_TITLE = 'https://title-test.example.com/';
const TEST_URL_THUMB = 'https://thumb-test.example.com/';

describe('E2E: Per-tile custom title and image (slot 28)', () => {
	let browser: Browser;
	let testImagePath: string;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);

		// Create a minimal 1x1 red PNG for thumbnail upload.
		const pngBuffer = Buffer.from(
			'89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de' +
			'0000000c4944415408d763f86f0000000200018d5f51b70000000049454e44ae426082',
			'hex'
		);
		testImagePath = path.join(__dirname, '_artifacts', 'test-thumb.png');
		fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
		fs.writeFileSync(testImagePath, pngBuffer);
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
		try { fs.unlinkSync(testImagePath); } catch { /* ignore */ }
	});

	it('setting a custom title on a pinned tile renders it', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Pin a tile.
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Original Title',
						url: u,
					}, resolve);
				});
			}, TEST_URL_TITLE);

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Wait for tile in grid.
			await waitForCondition(page, siteLinkExists, [TEST_URL_TITLE], { timeout: 10_000, message: 'Tile not in grid' });

			// Select our tile for editing.
			await selectTileForEdit(page, TEST_URL_TITLE);
			await new Promise(r => setTimeout(r, 500));

			// Set a custom title.
			await page.evaluate(() => {
				(document.getElementById('options-title-input') as HTMLInputElement).value = 'My Custom Title';
				document.getElementById('options-title-set')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify the title renders on the tile.
			const tileTitle = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				const titleSpan = site ? site.querySelector('.newtab-title') : null;
				return titleSpan ? titleSpan.textContent : null;
			}, TEST_URL_TITLE);
			expect(tileTitle).toBe('My Custom Title');

			// Verify persistence across reload.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const titleAfterReload = await waitForCondition(
				page,
				(u) => {
					const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
						.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
					const titleSpan = site ? site.querySelector('.newtab-title') : null;
					return titleSpan && titleSpan.textContent === 'My Custom Title' ? titleSpan.textContent : false;
				},
				[TEST_URL_TITLE],
				{ timeout: 10_000, message: 'Custom title not found after reload' }
			);
			expect(titleAfterReload).toBe('My Custom Title');

			// Cleanup. (`Tiles.unpinTile` is not a real wire name — see
			// removeTileByUrl's JSDoc in _helpers.ts.)
			await removeTileByUrl(page, TEST_URL_TITLE);
		} catch (e) {
			await captureFailure(page, 'tile-custom-title');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('uploading a custom thumbnail image displays it on the tile', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Pin a tile.
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Thumb Test',
						url: u,
					}, resolve);
				});
			}, TEST_URL_THUMB);

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			await waitForCondition(page, siteLinkExists, [TEST_URL_THUMB], { timeout: 10_000, message: 'Tile not in grid' });

			// Select our tile for editing.
			await selectTileForEdit(page, TEST_URL_THUMB);
			await new Promise(r => setTimeout(r, 500));

			// Upload a custom thumbnail.
			const fileInput = await page.$('#options-savedthumb-input') as import('puppeteer-core').ElementHandle<HTMLInputElement> | null;
			await fileInput!.uploadFile(testImagePath);
			await new Promise(r => setTimeout(r, 500));

			// Click set.
			await page.evaluate(() => {
				document.getElementById('options-savedthumb-set')!.click();
			});
			await new Promise(r => setTimeout(r, 1000));

			// Verify the tile thumbnail has a backgroundImage.
			const hasThumbnail = await waitForCondition(
				page,
				(u) => {
					const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
						.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
					if (!site) {return false;}
					const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
					const bg = thumb && thumb.style.backgroundImage;
					return !!(bg && bg.startsWith('url('));
				},
				[TEST_URL_THUMB],
				{ timeout: 10_000, message: 'Custom thumbnail not applied to tile' }
			);
			expect(hasThumbnail).toBeTruthy();

			// Remove the thumbnail.
			await page.evaluate(() => {
				document.getElementById('options-savedthumb-remove')!.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// Cleanup. (`Tiles.unpinTile` is not a real wire name — see
			// removeTileByUrl's JSDoc in _helpers.ts.)
			await removeTileByUrl(page, TEST_URL_THUMB);
		} catch (e) {
			await captureFailure(page, 'tile-custom-thumb');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('Title [Remove] clears the custom title (reverts toward the auto title)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();
		const TILE = 'https://title-revert.example.com/';

		try {
			await page.evaluate((u) => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'Auto', url: u }, resolve);
			}), TILE);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await waitForCondition(page, siteLinkExists, [TILE], { timeout: 10_000, message: 'tile not in grid' });

			// Select the tile + set a custom title.
			await selectTileForEdit(page, TILE);
			await new Promise(r => setTimeout(r, 400));
			await page.evaluate(() => {
				(document.getElementById('options-title-input') as HTMLInputElement).value = 'Custom Revert Title';
				document.getElementById('options-title-set')!.click();
			});
			await new Promise(r => setTimeout(r, 400));
			// Read the persisted tile record via the frozen `Tiles.getTile` wire
			// message — the authoritative source for `titleIsUserSet`/`title`,
			// which have no DOM reflection of their own (only the rendered
			// `.newtab-title` text does, which the earlier assertion covers).
			const before = await getStoredTile(page, TILE);
			expect(before && before.titleIsUserSet ? before.title : null).toBe('Custom Revert Title');

			// Remove → revert to auto (no history for this URL → no custom title).
			await page.evaluate(() => document.getElementById('options-title-remove')!.click());
			await new Promise(r => setTimeout(r, 600));
			const after = await getStoredTile(page, TILE);
			expect(!!(after && after.titleIsUserSet)).toBe(false);
			expect(after ? after.title : null).not.toBe('Custom Revert Title');

			await removeTileByUrl(page, TILE);
		} catch (e) {
			await captureFailure(page, 'tile-title-remove');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('URL [Remove] deletes/unpins the tile (same as the board ✕)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();
		const TILE = 'https://url-remove.example.com/';

		try {
			await page.evaluate((u) => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'Doomed', url: u }, resolve);
			}), TILE);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await waitForCondition(
				page,
				(u) => Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.some(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u && s.hasAttribute('pinned')),
				[TILE], { timeout: 10_000, message: 'tile not pinned' }
			);

			// Select the tile, then click the URL row's Remove.
			await selectTileForEdit(page, TILE);
			await new Promise(r => setTimeout(r, 400));
			await page.evaluate(() => document.getElementById('options-url-remove')!.click());

			// The tile is removed/unpinned from the grid.
			const gone = await waitForCondition(
				page,
				(u) => !Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.some(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u && s.hasAttribute('pinned')),
				[TILE], { timeout: 10_000, message: 'tile still pinned after url-remove' }
			);
			expect(gone).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-url-remove');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
