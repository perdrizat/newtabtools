import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState } from './_helpers.ts';

describe('E2E Smoke: Settings drawer opens and closes', () => {
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

	it('opens the drawer when the cogwheel is clicked', async () => {
		const openBefore = await page.evaluate(() =>
			document.documentElement.hasAttribute('drawer-open')
		);
		expect(openBefore).toBe(false);

		await page.evaluate(() => {
			document.getElementById('options-toggle')?.click();
		});
		await new Promise((r) => setTimeout(r, 400));

		const openAfter = await page.evaluate(() =>
			document.documentElement.hasAttribute('drawer-open')
		);
		expect(openAfter).toBe(true);

		const drawerVisible = await page.evaluate(() => {
			const d = document.getElementById('ntt-drawer') as HTMLElement;
			return d && d.getBoundingClientRect().width > 50;
		});
		expect(drawerVisible).toBe(true);
	});

	it('closes the drawer when Escape is pressed', async () => {
		const openBefore = await page.evaluate(() =>
			document.documentElement.hasAttribute('drawer-open')
		);
		expect(openBefore).toBe(true);

		await page.keyboard.press('Escape');
		await new Promise((r) => setTimeout(r, 400));

		const openAfter = await page.evaluate(() =>
			document.documentElement.hasAttribute('drawer-open')
		);
		expect(openAfter).toBe(false);
	});
});
