/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Layout-invariant E2E regression tests for the drag-and-drop pipeline.
 *
 * These tests do NOT simulate HTML5 drag (Puppeteer can't trigger native
 * drag events reliably and synthetic dispatchEvent doesn't fire the
 * browser's drag-image / drop-target machinery). Instead they exercise the
 * layout properties the drag pipeline assumes:
 *
 *   1. A `[frozen]` (position: absolute) tile uses #ntt-vertical-margin as
 *      its offsetParent, not its cell — verified by setting style.left and
 *      reading offsetLeft.
 *   2. Cell row heights survive when every tile is `[frozen]` — verified by
 *      setting `[frozen]` on every tile in the grid and re-measuring a row.
 *   3. The cell position cache refreshes after `openDrawer` triggers the
 *      push-layout (which doesn't fire a window resize).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import {
	connectToFirefox, openNewTab, waitForGridReady, waitForCondition,
	resetTestState, getNewTabURL,
} from './_helpers.ts';

describe('E2E: Drag layout invariants', () => {
	let browser: Browser;
	let page: Page;
	const TEST_URL = 'https://drag-layout.example/';

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		// Pin a known tile and reload so the grid has something concrete to
		// measure. The Tiles.pinTile + reload pattern matches the Phase 3-1
		// regression tests in drawer.test.ts.
		page = await openNewTab(browser);
		await waitForGridReady(page);
		await page.evaluate(u => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.pinTile', url: u, title: 'Drag layout' }, () => resolve());
		}), TEST_URL);
		const url = await getNewTabURL();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
		await waitForGridReady(page);
		await waitForCondition(
			page,
			u => {
				const g = (window as any).Grid;
				return g && g.sites && g.sites.some((s: any) => s && s.url === u);
			},
			[TEST_URL],
			{ timeout: 10_000, message: 'pinned tile did not surface in grid' }
		);
	}, 90_000);

	afterAll(async () => {
		if (page) {
			await page.evaluate(u => new Promise<void>(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.removeTile', url: u }, () => resolve());
			}), TEST_URL).catch(() => {});
			await page.close();
		}
		if (browser) {
			await browser.disconnect();
		}
	});

	it('regression: frozen tile positions relative to the page wrapper, not its cell', async () => {
		// When `.newtab-cell` was `position: relative`, the frozen tile's
		// offsetParent became the cell, so `style.left = 200px` resolved to
		// (cellLeft + 200) — far to the right of the cursor.
		const result = await page.evaluate(() => {
			const site = document.querySelector('.newtab-site') as HTMLElement;
			if (!site) {
				return { error: 'no site' };
			}
			site.setAttribute('frozen', 'true');
			site.style.left = '200px';
			site.style.top = '0';
			const offsetLeft = site.offsetLeft;
			const offsetParent = site.offsetParent ? (site.offsetParent as HTMLElement).id : null;
			// Cleanup.
			site.removeAttribute('frozen');
			site.style.left = '';
			site.style.top = '';
			return { offsetLeft, offsetParent };
		});
		expect(result.error).toBeUndefined();
		// `offsetLeft` should equal style.left (200) — meaning style.left
		// is interpreted against the same coordinate system the drag math
		// computes against. If the cell were position:relative, the tile
		// would be at the cell's left edge + 200.
		expect(result.offsetLeft).toBe(200);
		// And the offsetParent should be the page-wrapper, not a cell.
		expect(result.offsetParent).toBe('newtab-vertical-margin');
	}, 30_000);

	it('regression: row heights do not collapse when every tile is [frozen]', async () => {
		// CSS Grid auto-rows would collapse to 0 when every cell's site is
		// removed from flow via `position: absolute` (the rearrange path).
		// `grid-template-rows: repeat(var(--ntt-rows), 1fr)` keeps the
		// rows at their fair share regardless of content.
		const result = await page.evaluate(() => {
			const cell = document.querySelector('#newtab-grid > .newtab-cell') as HTMLElement | null;
			if (!cell) {
				return { error: 'no cell' };
			}
			const initialHeight = cell.getBoundingClientRect().height;
			const sites = Array.from(document.querySelectorAll<HTMLElement>('.newtab-site'));
			for (const s of sites) {
				s.setAttribute('frozen', 'true');
			}
			// Allow layout to flush.
			void cell.offsetHeight;
			const afterHeight = cell.getBoundingClientRect().height;
			// Cleanup.
			for (const s of sites) {
				s.removeAttribute('frozen');
			}
			return { initialHeight, afterHeight };
		});
		expect(result.error).toBeUndefined();
		expect(result.initialHeight).toBeGreaterThan(50);
		// Row should keep at least the bulk of its height — a small drop is
		// tolerable (paddings inside the cell vanish with content) but it
		// must NOT collapse to ~0.
		expect(result.afterHeight).toBeGreaterThan(result.initialHeight! * 0.7);
	}, 30_000);

	it('regression: openDrawer refreshes Grid.cells[].position cache (push-layout has no resize event)', async () => {
		// Without this refresh, Drag.start would freeze the tile to the
		// pre-drawer cell width — too big when the drawer is open. We
		// now schedule a refresh via setTimeout(240) after the drawer
		// transition (220ms).
		try {
			// Capture baseline before opening the drawer.
			const before = await page.evaluate(() => {
				(window as any).Grid.cacheCellPositions();
				return (window as any).Grid.cells[0].position.width;
			});

			await page.evaluate(() => (window as any).newTabTools.openDrawer());
			// Wait past the 240ms refresh tick that openDrawer scheduled.
			await new Promise(r => setTimeout(r, 400));

			const after = await page.evaluate(() => (window as any).Grid.cells[0].position.width);
			// The grid is narrower with the drawer open, so the cached
			// position width must reflect that. Permissive bound: at
			// least 20px less, more than enough to prove the cache
			// updated.
			expect(after).toBeLessThan(before - 20);
		} finally {
			await page.evaluate(() => (window as any).newTabTools.closeDrawer());
			await new Promise(r => setTimeout(r, 400));
		}
	}, 60_000);

	it('Drag.start refreshes the cache defensively (works even if openDrawer never fired)', async () => {
		// Belt-and-braces: even if the drawer-transition timeout was
		// missed for any reason (browser tab backgrounded, throttled), a
		// drag must always start from a fresh cache.
		const cachedBefore = await page.evaluate(() => {
			(window as any).Grid.cacheCellPositions();
			return (window as any).Grid.cells[0].position.width;
		});

		// Mutate the cache to simulate staleness.
		await page.evaluate(() => {
			(window as any).Grid.cells[0].position.width = 9999;
		});

		// Build a minimal mock event and call Drag.start. This bypasses
		// HTML5 drag (which Puppeteer can't reliably trigger) but
		// exercises the cache-refresh side-effect.
		await page.evaluate(() => {
			const site = (window as any).Grid.sites.find((s: any) => s);
			const rect = site.node.getBoundingClientRect();
			(window as any).Drag.start(site, {
				clientX: rect.left + 10,
				clientY: rect.top + 10,
				dataTransfer: {
					mozCursor: '', effectAllowed: '',
					setData() {}, setDragImage() {},
				},
			});
			// Reset the dragged state — we only care about the cache effect.
			(window as any).Drag._draggedSite = null;
			site.node.removeAttribute('frozen');
			site.node.removeAttribute('dragged');
		});

		const cachedAfter = await page.evaluate(() => (window as any).Grid.cells[0].position.width);
		// The cache should have been overwritten back to the real width.
		expect(cachedAfter).not.toBe(9999);
		expect(cachedAfter).toBeCloseTo(cachedBefore, -1);
	}, 30_000);
});
