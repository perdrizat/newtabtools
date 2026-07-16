/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Layout-invariant E2E regression tests for the drag-and-drop pipeline.
 *
 * Tests 1-2 exercise the layout properties the drag pipeline assumes via
 * plain DOM attribute/style manipulation (no drag gesture, no page globals):
 *
 *   1. A `[frozen]` (position: absolute) tile uses #ntt-vertical-margin as
 *      its offsetParent, not its cell — verified by setting style.left and
 *      reading offsetLeft.
 *   2. Cell row heights survive when every tile is `[frozen]` — verified by
 *      setting `[frozen]` on every tile in the grid and re-measuring a row.
 *
 * Tests 3-4 cover the "no resize event on push-layout" regression
 * end-to-end, without reading `Grid`/`Drag` page globals (chrome-prep C3d,
 * CHROME_PREP.md maintainer directive 1):
 *
 *   3. DOM proof the grid narrows when the drawer opens (push-layout fires
 *      no `resize` event) — checked via the cell's live
 *      `getBoundingClientRect()`, not the internal position cache.
 *   4. DOM proof a REAL `dragstart` dispatched right after that transition
 *      picks up the CURRENT (narrow) cell geometry, not a stale cached one —
 *      drag-drop.js's `Drag.start` always measures `cellNode.offsetWidth`
 *      live, so this exercises the actual defensive freshness the pipeline
 *      relies on, via a genuine gesture rather than a mocked `Drag.start()`
 *      call.
 *
 * KNOWN-FLAKY CLASS (accepted by CHROME_PREP.md directive 1): synthesized
 * DnD in headless Firefox can occasionally misfire. Quarantine policy:
 * investigate on 3 consecutive CI failures; never revert to page-global
 * driving as the fix.
 *
 * CHROME.md D5b: runs unmodified on Chrome (green on CfT 151) — the
 * synthesized-DragEvent approach is equally standards-based there, so the
 * same known-flaky class and quarantine policy extends to the Chrome tier
 * rather than getting its own rule.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import {
	connectToFirefox, openNewTab, waitForGridReady, waitForCondition,
	resetTestState, getNewTabURL, siteLinkExists, openDrawerUI, closeDrawerUI,
	removeTileByUrl,
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
		await waitForCondition(page, siteLinkExists, [TEST_URL], { timeout: 10_000, message: 'pinned tile did not surface in grid' });
	}, 90_000);

	afterAll(async () => {
		if (page) {
			await removeTileByUrl(page, TEST_URL).catch(() => {});
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

	it('regression: the grid narrows when the drawer opens (push-layout has no resize event)', async () => {
		// DOM proof of the underlying layout fact (no page-global cache
		// read): opening the drawer narrows #newtab-grid via push-layout,
		// which fires no `resize` event — the very reason Grid.cells[]'s
		// position cache needs an explicit refresh in production. Test 4
		// proves a real drag right after this transition picks up the new
		// (narrow) geometry rather than a stale cached one.
		try {
			const before = await page.evaluate(() => {
				const cell = document.querySelector('#newtab-grid > .newtab-cell') as HTMLElement;
				return cell.getBoundingClientRect().width;
			});

			await openDrawerUI(page);
			// Wait past the drawer's CSS transition (~220ms) + the 240ms
			// defensive cache-refresh tick it schedules.
			await new Promise(r => setTimeout(r, 500));

			const after = await page.evaluate(() => {
				const cell = document.querySelector('#newtab-grid > .newtab-cell') as HTMLElement;
				return cell.getBoundingClientRect().width;
			});
			// Permissive bound: at least 20px narrower, more than enough to
			// prove the push-layout narrowed the grid.
			expect(after).toBeLessThan(before - 20);
		} finally {
			await closeDrawerUI(page);
			await new Promise(r => setTimeout(r, 400));
		}
	}, 60_000);

	it('a real dragstart right after the drawer opens freezes the tile to the CURRENT (narrow) cell width, not a stale one', async () => {
		// Real gesture (chrome-prep C3d — no `Drag.start()` mock-event call,
		// no page-global reads): dispatch a genuine `dragstart` DragEvent on
		// the tile node. site.js's `Site.handleEvent`/drag-drop.js's `Drag.start` only
		// run when the board is unlocked, so the drawer must be open first —
		// the exact scenario the "no resize event" regression concerns.
		try {
			await openDrawerUI(page);
			await new Promise(r => setTimeout(r, 500));

			const result = await page.evaluate(() => {
				const site = document.querySelector('.newtab-site') as HTMLElement;
				const cell = site.closest('.newtab-cell') as HTMLElement;
				const liveCellWidth = cell.getBoundingClientRect().width;
				const rect = site.getBoundingClientRect();

				const dt = new DataTransfer();
				const dragstart = new DragEvent('dragstart', {
					bubbles: true, cancelable: true,
					clientX: rect.left + 10, clientY: rect.top + 10,
					dataTransfer: dt,
				});
				site.dispatchEvent(dragstart);

				const frozen = site.getAttribute('frozen') === 'true';
				const frozenWidth = parseFloat(site.style.width || '0');

				// Real dragend to unfreeze + restore the tile, matching what
				// a user releasing the drag would do (no actual drop target
				// registered, so Drag.end slides it back to its cell).
				const dragend = new DragEvent('dragend', {
					bubbles: true, cancelable: true, dataTransfer: dt,
				});
				site.dispatchEvent(dragend);

				return { frozen, frozenWidth, liveCellWidth };
			});

			expect(result.frozen).toBe(true);
			// The frozen tile's width must match the CURRENT narrow cell
			// width (Drag.start measures `cellNode.offsetWidth` live) —
			// not some earlier, pre-drawer, wider value.
			expect(result.frozenWidth).toBeCloseTo(result.liveCellWidth, 0);

			// Cleanup settles asynchronously (Transformation.slideSiteTo).
			await new Promise(r => setTimeout(r, 400));
			const stillFrozen = await page.evaluate(() =>
				document.querySelector('.newtab-site')!.hasAttribute('frozen')
			);
			expect(stillFrozen).toBe(false);
		} finally {
			await closeDrawerUI(page);
			await new Promise(r => setTimeout(r, 400));
		}
	}, 60_000);
});
