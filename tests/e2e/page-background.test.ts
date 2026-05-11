import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('E2E: Page background image (slot 25)', () => {
	let browser: Browser;
	let testImagePath: string;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);

		// Create a tiny 1x1 PNG test image for upload.
		// Minimal valid PNG: 8-byte header + IHDR + IDAT + IEND.
		const pngBuffer = Buffer.from(
			'89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de' +
			'0000000c4944415408d763f86f0000000200018d5f51b70000000049454e44ae426082',
			'hex'
		);
		testImagePath = path.join(__dirname, '_artifacts', 'test-bg.png');
		fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
		fs.writeFileSync(testImagePath, pngBuffer);
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
		// Clean up test image.
		try { fs.unlinkSync(testImagePath); } catch { /* ignore */ }
	});

	it('uploading a background image sets body backgroundImage; removing clears it', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Open the wallpaper picker.
			await page.evaluate(() => document.getElementById('options-wallpaper-btn')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Upload the test image via the wallpaper picker's file input.
			const fileInput = await page.$('#wallpaper-upload') as import('puppeteer-core').ElementHandle<HTMLInputElement> | null;
			await fileInput!.uploadFile(testImagePath);

			// Wait for the background to be applied.
			const hasBg = await waitForCondition(
				page,
				() => {
					const bg = document.body.style.backgroundImage;
					return bg && bg.startsWith('url(');
				},
				[],
				{ timeout: 10_000, message: 'Background image not applied to body' }
			);
			expect(hasBg).toBeTruthy();

			// Now remove via the options panel remove button.
			await page.evaluate(() => {
				document.getElementById('options-bg-remove')!.click();
			});
			await new Promise(r => setTimeout(r, 1000));

			const bgAfterRemove = await page.evaluate(() => {
				return document.body.style.backgroundImage;
			});
			// Should be empty or 'none' after removal.
			expect(bgAfterRemove === '' || bgAfterRemove === 'none' || bgAfterRemove === null).toBe(true);
		} catch (e) {
			await captureFailure(page, 'page-background');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
