import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
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

	it('switching theme via radio buttons updates the theme attribute on root', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings.
			await page.evaluate(() => (document.getElementById('options-toggle') as HTMLElement).click());
			await new Promise(r => setTimeout(r, 500));

			// Verify default system radio button is checked.
			const systemChecked = await page.evaluate(() => {
				return (document.querySelector('[name="theme"][value="system"]') as HTMLInputElement).checked;
			});
			expect(systemChecked).toBe(true);

			// Read current effective theme (should be light or dark based on test profile OS).
			const initialTheme = await page.evaluate(() => {
				return document.documentElement.getAttribute('theme');
			});
			expect(['light', 'dark']).toContain(initialTheme);

			// Switch to dark.
			await page.evaluate(() => {
				const radio = document.querySelector('[name="theme"][value="dark"]') as HTMLInputElement;
				radio.checked = true;
				radio.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 500));

			const darkTheme = await page.evaluate(() => {
				return document.documentElement.getAttribute('theme');
			});
			expect(darkTheme).toBe('dark');

			// Switch to light.
			await page.evaluate(() => {
				const radio = document.querySelector('[name="theme"][value="light"]') as HTMLInputElement;
				radio.checked = true;
				radio.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 500));

			const lightTheme = await page.evaluate(() => {
				return document.documentElement.getAttribute('theme');
			});
			expect(lightTheme).toBe('light');

			// Verify darkIcons stylesheet behavior: disabled when light.
			const darkIconsDisabled = await page.evaluate(() => {
				return (document.getElementById('dark-icons') as HTMLLinkElement).disabled;
			});
			expect(darkIconsDisabled).toBe(true);

			// Switch to dark — darkIcons should be enabled.
			await page.evaluate(() => {
				const radio = document.querySelector('[name="theme"][value="dark"]') as HTMLInputElement;
				radio.checked = true;
				radio.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const darkIconsEnabled = await page.evaluate(() => {
				return (document.getElementById('dark-icons') as HTMLLinkElement).disabled;
			});
			expect(darkIconsEnabled).toBe(false);

			// Restore initial theme (system).
			await page.evaluate(() => {
				const radio = document.querySelector('[name="theme"][value="system"]') as HTMLInputElement | null;
				if (radio) {
					radio.checked = true;
					radio.dispatchEvent(new Event('change', { bubbles: true }));
				}
			});
		} catch (e) {
			await captureFailure(page, 'theme-switch');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
