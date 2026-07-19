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
	IS_CHROME,
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

	it('fetches and renders wallpapers with category headings (Chrome: hardcoded solid palette, CHROME.md D8 finding 2)', async () => {
		const page: Page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings then wallpaper picker.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => document.getElementById('options-wallpaper-btn')!.click());

			// Wait for wallpaper thumbnails to appear (fetched from Mozilla API on
			// Firefox; rendered instantly from the hardcoded palette on Chrome —
			// either way, .wallpaper-thumb populates the grid).
			const thumbCount = await waitForCondition(
				page,
				() => document.querySelectorAll('.wallpaper-thumb').length,
				[],
				{ timeout: 15_000, message: 'No wallpaper thumbnails rendered' }
			);

			// Verify the grid is not showing the error message.
			const gridText: string = await page.evaluate(() =>
				document.getElementById('wallpaper-grid')!.textContent ?? ''
			);
			expect(gridText).not.toContain('Unable to load');

			if (IS_CHROME) {
				// CHROME.md D8 finding 2: the attachment CDN 406s Chrome UAs, so
				// the picker shows the degrade — exactly the 15-record hardcoded
				// solid palette, rendered as DIV swatches, never <img> (there is
				// nothing to 406 on Chrome — zero outbound network).
				expect(thumbCount).toBe(15);
				const imgThumbCount: number = await page.evaluate(() =>
					document.querySelectorAll('img.wallpaper-thumb').length
				);
				expect(imgThumbCount).toBe(0);

				// Maintainer decision 2026-07-18: Chrome ships no photo catalog
				// of its own — instead, a curated-collections link (Unsplash
				// Wallpapers) points users at free photos to add via Upload
				// Image. Assert it renders with the exact target.
				const collectionsHref: string = await page.evaluate(() =>
					(document.querySelector('.wallpaper-collections-note a') as HTMLAnchorElement | null)?.href ?? ''
				);
				expect(collectionsHref).toBe('https://unsplash.com/t/wallpapers');
			} else {
				expect(thumbCount).toBeGreaterThan(0);

				// Verify category headings exist (wallpapers grouped by category).
				const categories: string[] = await page.evaluate(() => {
					return Array.from(document.querySelectorAll('.wallpaper-category'))
						.map(h => h.textContent ?? '');
				});
				expect(categories.length).toBeGreaterThan(1);

				// Assertion-depth remediation (CHROME.md D8 "test remediations"):
				// a 406'd image still satisfies an element-count/style-string
				// check (that's exactly how finding 2 escaped E2E on CfT). Prove
				// real LOAD success instead — sample the first 3 rendered <img>
				// thumbs and wait until each one genuinely decoded
				// (`img.complete && img.naturalWidth > 0`); a 406 response leaves
				// `naturalWidth` at 0 forever.
				for (let i = 0; i < 3; i++) {
					await waitForCondition(
						page,
						(idx: unknown) => {
							const img = document.querySelectorAll('img.wallpaper-thumb')[idx as number] as HTMLImageElement | undefined;
							return !!img && img.complete && img.naturalWidth > 0;
						},
						[i],
						{ timeout: 15_000, message: `wallpaper thumb #${i} never finished loading (naturalWidth stayed 0 — a 406 would look like this)` }
					);
				}

				// The curated-collections note is Chrome-only — Firefox's live
				// catalog needs no pointer elsewhere.
				const noteCount: number = await page.evaluate(() =>
					document.querySelectorAll('.wallpaper-collections-note').length
				);
				expect(noteCount).toBe(0);
			}
		} catch (e) {
			await captureFailure(page, 'wallpaper-picker-load');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('selecting a wallpaper applies it as the page background (Chrome: a solid-colour swatch)', async () => {
		const page: Page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings then wallpaper picker.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => document.getElementById('options-wallpaper-btn')!.click());

			// Wait for wallpaper thumbnails to render (real Firefox curated
			// wallpapers on Firefox — same network fetch test 1 already depends
			// on; the hardcoded solid palette on Chrome, CHROME.md D8 finding 2).
			await waitForCondition(
				page,
				() => document.querySelectorAll('.wallpaper-thumb').length > 0,
				[],
				{ timeout: 15_000, message: 'No wallpaper thumbnails rendered' }
			);

			if (IS_CHROME) {
				// Click the first solid-colour swatch (a DIV, not an <img> —
				// there is no CDN image to reference on Chrome).
				const testColor = await page.evaluate(() => {
					const thumb = document.querySelector('.wallpaper-thumb') as HTMLElement;
					thumb.click();
					return thumb.dataset.solidColor || '';
				});
				expect(testColor).not.toBe('');

				// Wait for the body's computed background colour to pick up the
				// swatch's colour (hex -> browser-computed rgb()).
				await waitForCondition(
					page,
					() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'
						&& getComputedStyle(document.body).backgroundColor !== '',
					[],
					{ timeout: 10_000, message: 'Solid-colour wallpaper not applied to body' }
				);
				const bodyBg: string = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
				expect(bodyBg).not.toBe('');

				// Verify the clicked swatch gains the selected marker — this
				// assertion found (and now guards the fix for) the latent
				// dataset.solidColor selection-marker bug: the post-click
				// refresh loop used to match `dataset.url` only, so solid
				// swatches never showed as selected (fixed in wallpaper.js as
				// part of the D8 wallpaper slice; also covered by
				// tests/integration/wallpaper-position.test.ts).
				const selectedSolidCount: number = await page.evaluate(() =>
					document.querySelectorAll('.wallpaper-thumb[selected]').length
				);
				expect(selectedSolidCount).toBe(1);
			} else {
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
			}
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
