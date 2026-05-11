import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState } from './_helpers.ts';

describe('E2E Smoke: Extension loads cleanly', () => {
	let browser: Browser;
	let page: Page;
	const consoleErrors: string[] = [];

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		// Hook the console listener BEFORE goto() so we observe errors that
		// fire during the page's initial load. Attaching after openNewTab
		// returns would race the navigation and miss early errors; attaching
		// to a separately-created page would orphan the listener entirely.
		page = await openNewTab(browser, {
			beforeNavigate: (p: Page) => {
				p.on('console', (msg: any) => {
					if (msg.type() === 'error') {
						consoleErrors.push(msg.text());
					}
				});
			},
		});
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

	it('opens the new tab page with zero console errors', () => {
		expect(consoleErrors).toEqual([]);
	});

	it('renders the XHTML page (not a blank page or XML parse error)', async () => {
		const bodyLength = await page.evaluate(
			() => document.body?.innerHTML?.length ?? 0
		);
		expect(bodyLength).toBeGreaterThan(0);

		const hasScrollbox = await page.evaluate(
			() => document.getElementById('newtab-scrollbox') !== null
		);
		expect(hasScrollbox).toBe(true);
	});

	it('renders the tile grid with cells', async () => {
		const gridExists = await page.evaluate(
			() => document.getElementById('newtab-grid') !== null
		);
		expect(gridExists).toBe(true);

		const cellCount = await page.evaluate(
			() => document.querySelectorAll('.newtab-cell').length
		);
		expect(cellCount).toBeGreaterThanOrEqual(1);
	});
});
