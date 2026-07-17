import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import {
	ARTIFACTS_DIR,
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

describe('E2E: Wallpaper picker', () => {
	let browser: Browser;
	let testImagePath: string;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);

		// Create a tiny 1x1 PNG test image for custom upload.
		const pngBuffer = Buffer.from(
			'89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de' +
			'0000000c4944415408d763f86f0000000200018d5f51b70000000049454e44ae426082',
			'hex'
		);
		testImagePath = path.join(ARTIFACTS_DIR, 'test-wallpaper.png');
		fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
		fs.writeFileSync(testImagePath, pngBuffer);
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
		try { fs.unlinkSync(testImagePath); } catch { /* ignore */ }
	});

	it('fetches and renders Firefox curated wallpapers with category headings', async () => {
		const page: Page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings then wallpaper picker.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => document.getElementById('options-wallpaper-btn')!.click());

			// Wait for wallpaper thumbnails to appear (fetched from Mozilla API).
			const thumbCount = await waitForCondition(
				page,
				() => document.querySelectorAll('.wallpaper-thumb').length,
				[],
				{ timeout: 15_000, message: 'No wallpaper thumbnails loaded from Mozilla API' }
			);
			expect(thumbCount).toBeGreaterThan(0);

			// Verify category headings exist (wallpapers grouped by category).
			const categories: string[] = await page.evaluate(() => {
				return Array.from(document.querySelectorAll('.wallpaper-category'))
					.map(h => h.textContent ?? '');
			});
			expect(categories.length).toBeGreaterThan(1);

			// Verify the grid is not showing the error message.
			const gridText: string = await page.evaluate(() =>
				document.getElementById('wallpaper-grid')!.textContent ?? ''
			);
			expect(gridText).not.toContain('Unable to load');
		} catch (e) {
			await captureFailure(page, 'wallpaper-picker-load');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('selecting a wallpaper applies it as the page background', async () => {
		const page: Page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings then wallpaper picker.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => document.getElementById('options-wallpaper-btn')!.click());

			// Wait for the real Firefox curated wallpapers to load (same
			// network fetch test 1 already depends on -- no page-global
			// shortcut to synthesize fake entries anymore).
			await waitForCondition(
				page,
				() => document.querySelectorAll('.wallpaper-thumb').length > 0,
				[],
				{ timeout: 15_000, message: 'No wallpaper thumbnails loaded from Mozilla API' }
			);

			// Click the first wallpaper thumbnail (its data-url identifies the
			// image renderWallpaperGrid sets as its background).
			const testUrl = await page.evaluate(() => {
				const thumb = document.querySelector('.wallpaper-thumb') as HTMLElement;
				thumb.click();
				return thumb.dataset.url || '';
			});
			expect(testUrl).not.toBe('');

			// Wait for background to be applied.
			const bgImage = await waitForCondition(
				page,
				(expectedUrl: unknown) => {
					const bg = document.body.style.backgroundImage;
					return bg && bg.includes(expectedUrl as string) ? bg : null;
				},
				[testUrl],
				{ timeout: 10_000, message: 'Wallpaper not applied to body' }
			);
			expect(bgImage).toContain(testUrl);

			// Verify the clicked thumbnail has the selected attribute.
			const selectedCount: number = await page.evaluate(() =>
				document.querySelectorAll('.wallpaper-thumb[selected]').length
			);
			expect(selectedCount).toBe(1);
		} catch (e) {
			await captureFailure(page, 'wallpaper-picker-select');
			throw e;
		} finally {
			await page.evaluate(() => (document.getElementById('wallpaper-reset') as HTMLElement | null)?.click()).catch(() => {});
			await page.close();
		}
	}, 90_000);

	it('uploading a local image applies it as a custom wallpaper', async () => {
		const page: Page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings then wallpaper picker.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => document.getElementById('options-wallpaper-btn')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Upload the test image via the file input.
			const fileInput = await page.$('input#wallpaper-upload');
			await fileInput!.uploadFile(testImagePath);

			// Wait for the background to be applied (blob URL from custom upload).
			const hasBg = await waitForCondition(
				page,
				() => {
					const bg = document.body.style.backgroundImage;
					return bg && bg.startsWith('url(');
				},
				[],
				{ timeout: 10_000, message: 'Custom uploaded wallpaper not applied to body' }
			);
			expect(hasBg).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'wallpaper-picker-upload');
			throw e;
		} finally {
			await page.evaluate(() => (document.getElementById('wallpaper-reset') as HTMLElement | null)?.click()).catch(() => {});
			await page.close();
		}
	}, 90_000);
});
