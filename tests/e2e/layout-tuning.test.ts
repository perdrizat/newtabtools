import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

describe('E2E: Layout micro-tuning — opacity, titleSize, margin, spacing (slot 20)', () => {
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

	it('opacity slider updates --opacity CSS variable', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Set opacity to 50.
			await page.evaluate(() => {
				const input = document.querySelector('[name="opacity"]') as HTMLInputElement;
				input.value = '50';
				input.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const opacity = await page.evaluate(() => {
				return document.documentElement.style.getPropertyValue('--opacity');
			});
			expect(opacity).toBe('0.5');

			// Restore default (80).
			await page.evaluate(() => {
				const input = document.querySelector('[name="opacity"]') as HTMLInputElement;
				input.value = '80';
				input.dispatchEvent(new Event('change', { bubbles: true }));
			});
		} catch (e) {
			await captureFailure(page, 'layout-opacity');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('titleSize pref updates titlesize attribute', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Set titleSize to large via Prefs (drawer is the dedicated UI, but
			// the assertion here is about the resulting <html titlesize> attr).
			await page.evaluate(() => { (window as any).Prefs.titleSize = 'large'; });
			await new Promise(r => setTimeout(r, 300));

			const titlesize = await page.evaluate(() => {
				return document.documentElement.getAttribute('titlesize');
			});
			expect(titlesize).toBe('large');

			await page.evaluate(() => { (window as any).Prefs.titleSize = 'hidden'; });
			await new Promise(r => setTimeout(r, 300));

			const hidden = await page.evaluate(() => {
				return document.documentElement.getAttribute('titlesize');
			});
			expect(hidden).toBe('hidden');

			// Restore default (small).
			await page.evaluate(() => { (window as any).Prefs.titleSize = 'small'; });
		} catch (e) {
			await captureFailure(page, 'layout-titlesize');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('spacing pref updates spacing attribute', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => { (window as any).Prefs.spacing = 'large'; });
			await new Promise(r => setTimeout(r, 300));

			const spacing = await page.evaluate(() => {
				return document.documentElement.getAttribute('spacing');
			});
			expect(spacing).toBe('large');

			// Restore default (small).
			await page.evaluate(() => { (window as any).Prefs.spacing = 'small'; });
		} catch (e) {
			await captureFailure(page, 'layout-spacing');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('margin pref updates margin element classes', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => { (window as any).Prefs.margin = ['large', 'large', 'large', 'large']; });
			await new Promise(r => setTimeout(r, 300));

			const marginClasses = await page.evaluate(() => {
				const top = document.getElementById('newtab-margin-top') as HTMLElement;
				const left = document.querySelector('.newtab-margin-left') as HTMLElement;
				return {
					topHasLarge: top.classList.contains('large'),
					leftHasLarge: left.classList.contains('large'),
				};
			});
			expect(marginClasses.topHasLarge).toBe(true);
			expect(marginClasses.leftHasLarge).toBe(true);

			// Restore default (small).
			await page.evaluate(() => { (window as any).Prefs.margin = ['small', 'small', 'small', 'small']; });
		} catch (e) {
			await captureFailure(page, 'layout-margin');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
