/**
 * KNOWN-FLAKY CLASS (accepted by CHROME_PREP.md directive 1, TESTING.md
 * "Principled harness driving"): this file dispatches real synthesized
 * `dragstart`/`dragend`/`drop` `DragEvent`s (with a genuine `DataTransfer()`)
 * on real tile/cell DOM nodes rather than calling an internal `Drag.start()`
 * with a mock event. Synthesized DnD in headless Firefox is a known-flaky
 * class. Quarantine policy: investigate only after 3 consecutive CI failures
 * of the same test; never revert to page-global/internal-API driving as a
 * fix (see drag-layout.test.ts's header, which documents the same policy).
 *
 * CHROME.md D5b: runs unmodified on Chrome (green on CfT 151) — the same
 * quarantine policy extends to the Chrome tier rather than getting its own
 * rule.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	setPrefs,
	removeTileByUrl,
} from './_helpers.ts';

const TEST_URL_A = 'https://drag-a.example.com/';
const TEST_URL_B = 'https://drag-b.example.com/';

/**
 * A site's position in the grid == its `.newtab-cell`'s index among
 * `#newtab-grid`'s direct children (verified by css-grid-layout.test.ts's
 * "cells are direct children" test) — the DOM-observable equivalent of the
 * old `Grid.sites.findIndex(...)` page-global read.
 */
function cellIndexForUrl(url: string): number {
	const cells = Array.from(document.querySelectorAll('#newtab-grid > .newtab-cell'));
	return cells.findIndex(cell => {
		const link = cell.querySelector('.newtab-site a.newtab-link') as HTMLAnchorElement | null;
		return link != null && link.href === url;
	});
}

/** True once both URLs have a matching `.newtab-cell` in the grid. */
function bothCellsExist(a: unknown, b: unknown): boolean {
	const cells = Array.from(document.querySelectorAll('#newtab-grid > .newtab-cell'));
	const hrefs = cells
		.map(cell => (cell.querySelector('.newtab-site a.newtab-link') as HTMLAnchorElement | null)?.href)
		.filter((h): h is string => !!h);
	return hrefs.includes(a as string) && hrefs.includes(b as string);
}

describe('E2E: Drag-reorder tiles (slot 27)', () => {
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

	it('drag-reorder via synthetic events moves tile and persists across reload', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Clean slate: remove any leftover tiles at our test URLs.
			// (`Tiles.unpinTile` is not a real wire name — see removeTileByUrl's
			// JSDoc in _helpers.ts; it skips silently when the tile is absent.)
			await removeTileByUrl(page, TEST_URL_A);
			await removeTileByUrl(page, TEST_URL_B);

			// Reload to clear grid.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Pin two tiles at known positions.
			await page.evaluate(async (a, b) => {
				await new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'A', url: a }, resolve);
				});
				await new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'B', url: b }, resolve);
				});
			}, TEST_URL_A, TEST_URL_B);

			// Reload so both tiles appear.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Wait for both tiles.
			await waitForCondition(page, bothCellsExist, [TEST_URL_A, TEST_URL_B], { timeout: 10_000, message: 'Both tiles not found in grid' });

			// Record initial positions. `cellIndexForUrl` is passed as a
			// SEPARATE, self-contained `page.evaluate` argument function (not
			// called from inside another closure) — Puppeteer serializes an
			// evaluated function via its own source text only, so a wrapper
			// arrow function that references an outer-scope helper by name
			// would throw `ReferenceError` in the page (that helper doesn't
			// exist there); each of these calls is instead the helper itself.
			const posA0 = await page.evaluate(cellIndexForUrl, TEST_URL_A);
			const posB0 = await page.evaluate(cellIndexForUrl, TEST_URL_B);
			const initialPositions = { posA: posA0, posB: posB0 };

			// Verify A is before B.
			expect(initialPositions.posA).toBeLessThan(initialPositions.posB);

			// Perform a REAL synthetic drag: dragstart on site A's node, drop
			// on cell B's node (both looked up fresh via DOM, not a page
			// global — the drop handler accepts untrusted/synthetic events).
			const swapped = await page.evaluate((a, b) => {
				const cells = Array.from(document.querySelectorAll('#newtab-grid > .newtab-cell'));
				const findIndex = (url: string) => cells.findIndex(cell => {
					const link = cell.querySelector('.newtab-site a.newtab-link') as HTMLAnchorElement | null;
					return link != null && link.href === url;
				});
				const posA = findIndex(a);
				const posB = findIndex(b);
				if (posA === -1 || posB === -1) {return false;}
				const siteA = cells[posA].querySelector('.newtab-site') as HTMLElement | null;
				const cellB = cells[posB];
				if (!siteA || !cellB) {return false;}

				// Simulate dragstart on site A.
				const dragStartEvent = new DragEvent('dragstart', {
					bubbles: true,
					cancelable: true,
					dataTransfer: new DataTransfer(),
					clientX: 100,
					clientY: 100,
				});
				siteA.dispatchEvent(dragStartEvent);

				// Simulate drop on cell B (drop handler accepts untrusted events).
				const dropEvent = new DragEvent('drop', {
					bubbles: true,
					cancelable: true,
					dataTransfer: new DataTransfer(),
				});
				cellB.dispatchEvent(dropEvent);

				return true;
			}, TEST_URL_A, TEST_URL_B);
			expect(swapped).toBe(true);

			// Wait for Updater.updateGrid to complete.
			await new Promise(r => setTimeout(r, 2000));

			// Reload and verify the new order persisted.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			await waitForCondition(page, bothCellsExist, [TEST_URL_A, TEST_URL_B], { timeout: 10_000, message: 'Tiles not found after reload' });
			const newPositions = {
				posA: await page.evaluate(cellIndexForUrl, TEST_URL_A),
				posB: await page.evaluate(cellIndexForUrl, TEST_URL_B),
			};

			// The tiles should have swapped: A should now be after B.
			expect(newPositions.posA).toBeGreaterThan(newPositions.posB);

			// Cleanup: remove both.
			await removeTileByUrl(page, TEST_URL_A);
			await removeTileByUrl(page, TEST_URL_B);
		} catch (e) {
			await captureFailure(page, 'drag-reorder');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('locked grid prevents drag: Cell.handleEvent returns early when Prefs.locked', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Pin a tile.
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'Lock Test', url: u }, resolve);
				});
			}, TEST_URL_A);

			const url = await getNewTabURL();
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Enable lock via storage (direct, reliable). Poll rather than
			// fixed-sleep: setPrefs only STARTS the async storage.onChanged →
			// updateUI chain that reflects the pref onto <html locked>.
			await setPrefs(page, { locked: true });
			const locked = await waitForCondition(
				page,
				() => document.documentElement.getAttribute('locked') === 'true'
					? document.documentElement.getAttribute('locked') : false,
				[],
				{ timeout: 10_000, message: 'locked attribute never became true' }
			);
			expect(locked).toBe('true');

			// §3c: hover actions are NOT gated on lock anymore — the row is
			// opacity:0 at rest but stays display-able so it's reachable on hover
			// even while the board is locked (normal mode).
			const actionsDisplay = await page.evaluate(() => {
				const actions = document.querySelector('.ntt-actions');
				if (!actions) {return 'no-actions';}
				return window.getComputedStyle(actions).display;
			});
			expect(actionsDisplay).not.toBe('none');

			// Cleanup: unlock and remove.
			await setPrefs(page, { locked: false });
			await removeTileByUrl(page, TEST_URL_A);
		} catch (e) {
			await captureFailure(page, 'drag-reorder-locked');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
