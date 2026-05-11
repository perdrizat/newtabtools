import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState } from './_helpers.ts';

describe('E2E Smoke: Settings panel opens and closes', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		page = await openNewTab(browser);
		await waitForGridReady(page);
	}, 60_000);

	afterAll(async () => {
		if (page) {
			await page.close();
		}
		if (browser) {
			await browser.disconnect();
		}
	});

	it('opens the settings panel when the toggle is clicked', async () => {
		// The extension page starts with options-hidden="true" on <html>
		const hiddenBefore = await page.evaluate(() =>
			document.documentElement.hasAttribute('options-hidden')
		);
		expect(hiddenBefore).toBe(true);

		// Click the settings toggle button
		await page.evaluate(() => {
			document.getElementById('options-toggle')?.click();
		});
		await new Promise((r) => setTimeout(r, 500));

		// The options-hidden attribute should now be removed
		const hiddenAfterClick = await page.evaluate(() =>
			document.documentElement.hasAttribute('options-hidden')
		);
		expect(hiddenAfterClick).toBe(false);

		// The #options panel should be visible
		const optionsVisible = await page.evaluate(() => {
			const options = document.getElementById('options');
			if (!options) {return false;}
			const style = window.getComputedStyle(options);
			return style.display !== 'none';
		});
		expect(optionsVisible).toBe(true);
	});

	it('closes the settings panel when Escape is pressed', async () => {
		// Panel should be open from the previous test
		const openBefore = await page.evaluate(() =>
			!document.documentElement.hasAttribute('options-hidden')
		);
		expect(openBefore).toBe(true);

		// Press Escape
		await page.keyboard.press('Escape');
		await new Promise((r) => setTimeout(r, 500));

		// The options-hidden attribute should be restored
		const hiddenAfterEscape = await page.evaluate(() =>
			document.documentElement.hasAttribute('options-hidden')
		);
		expect(hiddenAfterEscape).toBe(true);
	});
});
