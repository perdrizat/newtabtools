import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import {
	ENGINE,
	connectToFirefox,
	openNewTab,
	waitForGridReady,
	resetTestState,
	browserLogSize,
	firefoxConsoleErrorsSince,
} from './_helpers.ts';

describe('E2E Smoke: Extension loads cleanly', () => {
	let browser: Browser;
	let page: Page;
	const consoleErrors: string[] = [];
	let logOffset = 0;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		// Firefox: BiDi delivers no console events for extension pages, so
		// errors are read from the browser's stdout log instead (the hook sets
		// devtools.console.stdout.content). Only lines written from here on count.
		logOffset = browserLogSize();
		// Chrome: hook the console listener BEFORE goto() so we observe errors
		// that fire during the page's initial load. Attaching after openNewTab
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
		// Let late boot work (tiles, thumbnails, background replies) report.
		await new Promise(r => setTimeout(r, 1_000));
	}, 60_000);

	afterAll(async () => {
		if (page) {
			await page.close();
		}
		if (browser) {
			await browser.disconnect();
		}
	});

	// On Firefox this also covers the background page: its errors land in the
	// same log (tests/compat/experiments/2026-10-26-console-stdout).
	it('opens the new tab page with zero console errors', () => {
		const errors = ENGINE === 'gecko' ? firefoxConsoleErrorsSince(logOffset) : consoleErrors;
		expect(errors).toEqual([]);
	});

	it('renders the HTML5 page (not a blank page or parse error)', async () => {
		const bodyLength = await page.evaluate(
			() => document.body?.innerHTML?.length ?? 0
		);
		expect(bodyLength).toBeGreaterThan(0);

		const hasScrollbox = await page.evaluate(
			() => document.getElementById('newtab-scrollbox') !== null
		);
		expect(hasScrollbox).toBe(true);

		// HTML5-parse regression guard (MODERNIZATION.md Stage H, slice H2):
		// newTab.html has a `<!DOCTYPE html>` and is served/parsed as HTML,
		// not XML. A parse failure serving a broken/blank document, or a
		// silent fallback to quirks mode, would fail these.
		const doctypeName = await page.evaluate(
			() => document.doctype?.name ?? null
		);
		expect(doctypeName).toBe('html');

		const compatMode = await page.evaluate(() => document.compatMode);
		expect(compatMode).toBe('CSS1Compat');
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
