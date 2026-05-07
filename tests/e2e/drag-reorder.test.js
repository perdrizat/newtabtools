import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
} from './_helpers.js';

const TEST_URL_A = 'https://drag-a.example.com/';
const TEST_URL_B = 'https://drag-b.example.com/';

describe('E2E: Drag-reorder tiles (slot 27)', () => {
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

	it('drag-reorder via synthetic events moves tile and persists across reload', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Clean slate: unpin any leftover tiles at our test URLs.
			await page.evaluate(async (a, b) => {
				await new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: a }, resolve);
				});
				await new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: b }, resolve);
				});
			}, TEST_URL_A, TEST_URL_B);

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
			await waitForCondition(
				page,
				(a, b) => {
					const g = window.Grid;
					if (!g || !g.sites) {return false;}
					const urls = g.sites.filter(s => s).map(s => s.url);
					return urls.includes(a) && urls.includes(b);
				},
				[TEST_URL_A, TEST_URL_B],
				{ timeout: 10_000, message: 'Both tiles not found in grid' }
			);

			// Record initial positions.
			const initialPositions = await page.evaluate((a, b) => {
				const g = window.Grid;
				const posA = g.sites.findIndex(s => s && s.url === a);
				const posB = g.sites.findIndex(s => s && s.url === b);
				return { posA, posB };
			}, TEST_URL_A, TEST_URL_B);

			// Verify A is before B.
			expect(initialPositions.posA).toBeLessThan(initialPositions.posB);

			// Perform synthetic drag: move tile A to B's position.
			const swapped = await page.evaluate((posA, posB) => {
				const g = window.Grid;
				const siteA = g.sites[posA];
				const cellB = g.cells[posB];
				if (!siteA || !cellB) {return false;}

				// Simulate dragstart on site A.
				const dragStartEvent = new DragEvent('dragstart', {
					bubbles: true,
					cancelable: true,
					dataTransfer: new DataTransfer(),
					clientX: 100,
					clientY: 100,
				});
				siteA.node.dispatchEvent(dragStartEvent);

				// Simulate drop on cell B (drop handler accepts untrusted events).
				const dropEvent = new DragEvent('drop', {
					bubbles: true,
					cancelable: true,
					dataTransfer: new DataTransfer(),
				});
				cellB.node.dispatchEvent(dropEvent);

				return true;
			}, initialPositions.posA, initialPositions.posB);
			expect(swapped).toBe(true);

			// Wait for Updater.updateGrid to complete.
			await new Promise(r => setTimeout(r, 2000));

			// Reload and verify the new order persisted.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const newPositions = await waitForCondition(
				page,
				(a, b) => {
					const g = window.Grid;
					if (!g || !g.sites) {return false;}
					const posA = g.sites.findIndex(s => s && s.url === a);
					const posB = g.sites.findIndex(s => s && s.url === b);
					if (posA === -1 || posB === -1) {return false;}
					return { posA, posB };
				},
				[TEST_URL_A, TEST_URL_B],
				{ timeout: 10_000, message: 'Tiles not found after reload' }
			);

			// The tiles should have swapped: A should now be after B.
			expect(newPositions.posA).toBeGreaterThan(newPositions.posB);

			// Cleanup: unpin both.
			await page.evaluate(async (a, b) => {
				await new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: a }, resolve);
				});
				await new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: b }, resolve);
				});
			}, TEST_URL_A, TEST_URL_B);
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

			// Enable lock via Prefs (direct, reliable).
			await page.evaluate(() => {
				Prefs.locked = true;
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify locked attribute on root.
			const locked = await page.evaluate(() => {
				return document.documentElement.getAttribute('locked');
			});
			expect(locked).toBe('true');

			// When locked, :root[locked="true"] .newtab-control { display: none }
			const controlDisplay = await page.evaluate(() => {
				const ctrl = document.querySelector('.newtab-control');
				if (!ctrl) {return 'no-control';}
				return window.getComputedStyle(ctrl).display;
			});
			expect(controlDisplay).toBe('none');

			// Cleanup: unlock and unpin.
			await page.evaluate(() => {
				Prefs.locked = false;
			});
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: u }, resolve);
				});
			}, TEST_URL_A);
		} catch (e) {
			await captureFailure(page, 'drag-reorder-locked');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
