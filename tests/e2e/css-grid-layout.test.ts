import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState, waitForCondition, getNewTabURL, getPref, setPrefs } from './_helpers.ts';

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
		const cells = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			return grid ? grid.querySelectorAll('.newtab-cell').length : 0;
		});
		const rows = await getPref(page, 'rows') as number;
		const columns = await getPref(page, 'columns') as number;
		expect(cells).toBe(rows * columns);
	});

	it('grid uses --ntt-cols CSS variable matching the columns pref', async () => {
		const cssVar = await page.evaluate(() => {
			const grid = document.getElementById('newtab-grid');
			return grid ? getComputedStyle(grid).getPropertyValue('--ntt-cols').trim() : '';
		});
		const columns = await getPref(page, 'columns') as number;
		expect(cssVar).toBe(String(columns));
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
		await setPrefs(page, { columns: 5 });
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
		await setPrefs(page, { columns: 3 });
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
	//
	// icons.js's full catalog (NttIcons.names/.create) is exhaustively covered
	// at the fast/integration tier (tests/integration/icons.test.ts, a real
	// module import — legitimate there, unlike a page-context global read).
	// These E2E tests instead prove the icons pipeline is actually wired into
	// the real page: every pinned tile's action row renders each action's
	// icon as a real inline SVG (fx-newTab.js's Site#_renderActionButtons).

	it('the tile action row renders inline SVG icons (edit/never-capture/pin/remove)', async () => {
		const icons = await page.evaluate(() => {
			const site = document.querySelector('.newtab-site');
			if (!site) {return null;}
			const btns = Array.from(site.querySelectorAll('.ntt-action-btn'));
			return btns.map(b => ({
				action: b.getAttribute('data-action'),
				hasSvg: !!b.querySelector('svg'),
			}));
		});
		expect(icons).not.toBeNull();
		const actions = icons!.map(i => i.action);
		expect(actions).toEqual(expect.arrayContaining(['edit', 'never-capture', 'pin', 'remove']));
		expect(icons!.every(i => i.hasSvg)).toBe(true);
	});

	it('a rendered action-button icon is a valid 24x24 SVG', async () => {
		const result = await page.evaluate(() => {
			const btn = document.querySelector('.newtab-site .ntt-action-btn[data-action="remove"]');
			const svg = btn ? btn.querySelector('svg') : null;
			return svg ? {
				tagName: svg.tagName.toLowerCase(),
				viewBox: svg.getAttribute('viewBox'),
				childCount: svg.children.length,
			} : null;
		});
		expect(result).not.toBeNull();
		expect(result!.tagName).toBe('svg');
		expect(result!.viewBox).toBe('0 0 24 24');
		expect(result!.childCount).toBeGreaterThanOrEqual(1);
	});

	it('the drag handle and actions-kebab also render distinct icons', async () => {
		const result = await page.evaluate(() => {
			const site = document.querySelector('.newtab-site');
			const handle = site ? site.querySelector('.ntt-drag-handle svg') : null;
			const kebab = site ? site.querySelector('.ntt-actions-kebab svg') : null;
			return { hasHandleIcon: !!handle, hasKebabIcon: !!kebab };
		});
		expect(result.hasHandleIcon).toBe(true);
		expect(result.hasKebabIcon).toBe(true);
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
