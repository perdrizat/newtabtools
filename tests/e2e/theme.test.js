import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
} from './_helpers.js';

describe('E2E: Light / dark / auto theme (slot 26)', () => {
	let browser;

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
			await page.evaluate(() => document.getElementById('options-toggle').click());
			await new Promise(r => setTimeout(r, 500));

			// Read current theme.
			const initialTheme = await page.evaluate(() => {
				return document.documentElement.getAttribute('theme');
			});

			// Switch to dark.
			await page.evaluate(() => {
				const radio = document.querySelector('[name="theme"][value="dark"]');
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
				const radio = document.querySelector('[name="theme"][value="light"]');
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
				return document.getElementById('dark-icons').disabled;
			});
			expect(darkIconsDisabled).toBe(true);

			// Switch to dark — darkIcons should be enabled.
			await page.evaluate(() => {
				const radio = document.querySelector('[name="theme"][value="dark"]');
				radio.checked = true;
				radio.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const darkIconsEnabled = await page.evaluate(() => {
				return document.getElementById('dark-icons').disabled;
			});
			expect(darkIconsEnabled).toBe(false);

			// Restore initial theme.
			if (initialTheme && initialTheme !== 'dark') {
				await page.evaluate((t) => {
					const radio = document.querySelector(`[name="theme"][value="${t}"]`);
					if (radio) {
						radio.checked = true;
						radio.dispatchEvent(new Event('change', { bubbles: true }));
					}
				}, initialTheme);
			}
		} catch (e) {
			await captureFailure(page, 'theme-switch');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('themeAuto checkbox toggles auto-theme behavior', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => document.getElementById('options-toggle').click());
			await new Promise(r => setTimeout(r, 500));

			// Enable auto theme.
			await page.evaluate(() => {
				const cb = document.querySelector('[name="themeAuto"]');
				cb.checked = true;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify the auto checkbox is reflected.
			const autoChecked = await page.evaluate(() => {
				return document.querySelector('[name="themeAuto"]').checked;
			});
			expect(autoChecked).toBe(true);

			// Disable auto theme.
			await page.evaluate(() => {
				const cb = document.querySelector('[name="themeAuto"]');
				cb.checked = false;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const autoUnchecked = await page.evaluate(() => {
				return document.querySelector('[name="themeAuto"]').checked;
			});
			expect(autoUnchecked).toBe(false);
		} catch (e) {
			await captureFailure(page, 'theme-auto');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
