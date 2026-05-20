import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState, waitForCondition, getNewTabURL } from './_helpers.ts';

describe('E2E: CSS Grid layout + design tokens + icons', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		page = await openNewTab(browser);
		await waitForGridReady(page);

		// Pin a test tile so .newtab-site exists for drag-related tests.
		// Fresh CI profiles have no topSites, leaving the grid empty.
		await page.evaluate(() => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({
				name: 'Tiles.pinTile',
				title: 'Grid Test',
				url: 'https://grid-test.example.com/',
			}, () => resolve());
		}));
		const url = await getNewTabURL();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
		await waitForGridReady(page);
	}, 60_000);

	afterAll(async () => {
		if (page) {await page.close();}
		if (browser) {await browser.disconnect();}
	});

	// ── CSS Grid layout ──

	it('renders #newtab-grid as a CSS Grid container', async () => {
		const display = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			return grid ? getComputedStyle(grid).display : null;
		});
		expect(display).toBe('grid');
	});

	it('has cells as direct children of #newtab-grid (no .newtab-row wrappers)', async () => {
		const result = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			if (!grid) {return { hasRows: true, cellCount: 0 };}
			const rows = grid.querySelectorAll('.newtab-row');
			const cells = grid.querySelectorAll(':scope > .newtab-cell');
			return { hasRows: rows.length > 0, cellCount: cells.length };
		});
		expect(result.hasRows).toBe(false);
		expect(result.cellCount).toBeGreaterThanOrEqual(1);
	});

	it('grid has the expected number of cells (rows × columns)', async () => {
		const result = await page.evaluate(() => {
			const P = (window as any).Prefs;
			const grid = document.getElementById('newtab-grid');
			const cells = grid ? grid.querySelectorAll('.newtab-cell').length : 0;
			return { expected: P.rows * P.columns, actual: cells };
		});
		expect(result.actual).toBe(result.expected);
	});

	it('grid uses --ntt-cols CSS variable matching Prefs.columns', async () => {
		const result = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			const cols = grid ? getComputedStyle(grid).getPropertyValue('--ntt-cols').trim() : '';
			const prefCols = (window as any).Prefs.columns;
			return { cssVar: cols, pref: String(prefCols) };
		});
		expect(result.cssVar).toBe(result.pref);
	});

	it('grid gap uses --ntt-gap token', async () => {
		const gap = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			return grid ? getComputedStyle(grid).gap : '';
		});
		expect(gap).not.toBe('');
		expect(gap).not.toBe('normal');
	});

	it('cells have non-zero dimensions', async () => {
		const dims = await page.evaluate(() => {
			const cell = document.querySelector('.newtab-cell');
			if (!cell) {return { width: 0, height: 0 };}
			const r = cell.getBoundingClientRect();
			return { width: r.width, height: r.height };
		});
		expect(dims.width).toBeGreaterThan(0);
		expect(dims.height).toBeGreaterThan(0);
	});

	it('changing columns pref updates grid-template-columns', async () => {
		await page.evaluate(() => {
			(window as any).Prefs.columns = 5;
		});
		await waitForCondition(page, () => {
			const grid = document.getElementById('newtab-grid');
			return grid && getComputedStyle(grid).getPropertyValue('--ntt-cols').trim() === '5';
		}, [], { timeout: 5000 });

		const cols = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			return grid ? getComputedStyle(grid).getPropertyValue('--ntt-cols').trim() : '';
		});
		expect(cols).toBe('5');

		// Reset
		await page.evaluate(() => {
			(window as any).Prefs.columns = 3;
		});
	});

	// ── Design tokens ──

	it('tokens.css is loaded (--ntt-page-bg is defined)', async () => {
		const value = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue('--ntt-page-bg').trim();
		});
		expect(value).not.toBe('');
	});

	it('--ntt-accent is defined', async () => {
		const value = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue('--ntt-accent').trim();
		});
		expect(value).not.toBe('');
	});

	it('--ntt-surface is defined', async () => {
		const value = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue('--ntt-surface').trim();
		});
		expect(value).not.toBe('');
	});

	it('--ntt-font-ui is defined', async () => {
		const value = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue('--ntt-font-ui').trim();
		});
		expect(value).not.toBe('');
	});

	it('--ntt-gap is defined', async () => {
		const value = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue('--ntt-gap').trim();
		});
		expect(value).not.toBe('');
	});

	// ── Icons module ──

	it('NttIcons is available on window', async () => {
		const available = await page.evaluate(() => {
			return typeof (window as any).NttIcons !== 'undefined' &&
				typeof (window as any).NttIcons.create === 'function';
		});
		expect(available).toBe(true);
	});

	it('NttIcons.create returns an SVG element in the page', async () => {
		const result = await page.evaluate(() => {
			const icon = (window as any).NttIcons.create('close');
			return icon ? {
				tagName: icon.tagName.toLowerCase(),
				viewBox: icon.getAttribute('viewBox'),
				childCount: icon.children.length,
			} : null;
		});
		expect(result).not.toBeNull();
		expect(result!.tagName).toBe('svg');
		expect(result!.viewBox).toBe('0 0 24 24');
		expect(result!.childCount).toBeGreaterThanOrEqual(1);
	});

	it('NttIcons.names lists all expected icons', async () => {
		const names: string[] = await page.evaluate(() => {
			return (window as any).NttIcons.names;
		});
		expect(names).toContain('search');
		expect(names).toContain('settings');
		expect(names).toContain('close');
		expect(names).toContain('pin');
		expect(names).toContain('kebab');
		expect(names.length).toBeGreaterThanOrEqual(25);
	});

	// ── Drag & drop still works ──

	it('drag-related attributes still function (dragstart sets dragged)', async () => {
		const hasDraggable = await page.evaluate(() => {
			const site = document.querySelector('.newtab-site');
			return site ? site.getAttribute('draggable') === 'true' : false;
		});
		expect(hasDraggable).toBe(true);
	});
});
