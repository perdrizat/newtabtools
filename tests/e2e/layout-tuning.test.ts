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
			// Set titleSize to large via storage (drawer is the dedicated UI, but
			// the assertion here is about the resulting <html titlesize> attr).
			// Poll rather than fixed-sleep: setPrefs only STARTS the async
			// storage.onChanged -> updateUI chain, which under full-suite load
			// can outlast any fixed budget.
			await setPrefs(page, { titleSize: 'large' });
			const titlesize = await waitForCondition(
				page,
				() => document.documentElement.getAttribute('titlesize') === 'large'
					? document.documentElement.getAttribute('titlesize') : false,
				[],
				{ timeout: 10_000, message: 'titlesize attribute never became large' }
			);
			expect(titlesize).toBe('large');

			await setPrefs(page, { titleSize: 'hidden' });
			const hidden = await waitForCondition(
				page,
				() => document.documentElement.getAttribute('titlesize') === 'hidden'
					? document.documentElement.getAttribute('titlesize') : false,
				[],
				{ timeout: 10_000, message: 'titlesize attribute never became hidden' }
			);
			expect(hidden).toBe('hidden');

			// Restore default (small).
			await setPrefs(page, { titleSize: 'small' });
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
			await setPrefs(page, { spacing: 'large' });
			const spacing = await waitForCondition(
				page,
				() => document.documentElement.getAttribute('spacing') === 'large'
					? document.documentElement.getAttribute('spacing') : false,
				[],
				{ timeout: 10_000, message: 'spacing attribute never became large' }
			);
			expect(spacing).toBe('large');

			// Restore default (small).
			await setPrefs(page, { spacing: 'small' });
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
			await setPrefs(page, { margin: ['large', 'large', 'large', 'large'] });
			await waitForCondition(
				page,
				() => {
					const top = document.getElementById('newtab-margin-top');
					return !!top && top.classList.contains('large');
				},
				[],
				{ timeout: 10_000, message: 'margin classes never updated to large' }
			);

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
			await setPrefs(page, { margin: ['small', 'small', 'small', 'small'] });
		} catch (e) {
			await captureFailure(page, 'layout-margin');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
