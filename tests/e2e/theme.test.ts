import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
	setPrefs,
	openDrawerUI,
	closeDrawerUI,
	switchDrawerTabUI,
} from './_helpers.ts';

describe('E2E: Light / dark / auto theme (slot 26)', () => {
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

	it('switching theme via Appearance tab cards updates the theme attribute on root', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open the drawer and switch to the Appearance tab where the
			// theme cards live (Phase 3-2).
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'page');
			await new Promise(r => setTimeout(r, 400));

			const systemChecked = await page.evaluate(() => {
				const card = document.querySelector('.ntt-theme-card[data-value="system"]') as HTMLElement;
				return card.getAttribute('aria-checked');
			});
			expect(systemChecked).toBe('true');

			const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('theme'));
			expect(['light', 'dark']).toContain(initialTheme);

			// Switch to dark via theme card.
			await page.evaluate(() => {
				(document.querySelector('.ntt-theme-card[data-value="dark"]') as HTMLElement).click();
			});
			await new Promise(r => setTimeout(r, 500));
			expect(await page.evaluate(() => document.documentElement.getAttribute('theme'))).toBe('dark');

			// Switch to light.
			await page.evaluate(() => {
				(document.querySelector('.ntt-theme-card[data-value="light"]') as HTMLElement).click();
			});
			await new Promise(r => setTimeout(r, 500));
			expect(await page.evaluate(() => document.documentElement.getAttribute('theme'))).toBe('light');

			// darkIcons stylesheet disabled when light.
			expect(await page.evaluate(() => (document.getElementById('dark-icons') as HTMLLinkElement).disabled)).toBe(true);

			// Switch to dark — darkIcons enabled again.
			await page.evaluate(() => {
				(document.querySelector('.ntt-theme-card[data-value="dark"]') as HTMLElement).click();
			});
			await new Promise(r => setTimeout(r, 300));
			expect(await page.evaluate(() => (document.getElementById('dark-icons') as HTMLLinkElement).disabled)).toBe(false);
		} catch (e) {
			await captureFailure(page, 'theme-switch');
			throw e;
		} finally {
			// Restore default theme and close drawer.
			await setPrefs(page, { theme: 'system' });
			await closeDrawerUI(page);
			await page.close();
		}
	}, 90_000);
});
