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

describe('E2E: Lock-grid toggle (slot 21)', () => {
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

	it('enabling lock adds locked attribute to root and hides tile controls', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Pin a tile so .newtab-control elements exist in the grid.
			await page.evaluate(async () => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Lock Test',
						url: 'https://lock-test.example.com/',
					}, resolve);
				});
			});
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			await waitForCondition(
				page,
				() => {
					const g = window.Grid;
					return g && g.sites && g.sites.some(s => s && s.url === 'https://lock-test.example.com/');
				},
				[],
				{ timeout: 10_000, message: 'Pinned tile not in grid' }
			);

			// Verify initially unlocked.
			const initialLocked = await page.evaluate(() => {
				return document.documentElement.hasAttribute('locked');
			});
			expect(initialLocked).toBe(false);

			// Open settings.
			await page.evaluate(() => document.getElementById('options-toggle').click());
			await new Promise(r => setTimeout(r, 500));

			// Enable lock.
			await page.evaluate(() => {
				const cb = document.querySelector('[name="locked"]');
				cb.checked = true;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 500));

			const lockedAfter = await page.evaluate(() => {
				return document.documentElement.getAttribute('locked');
			});
			expect(lockedAfter).toBe('true');

			// When locked, .newtab-control elements are display: none (CSS rule).
			const controlDisplay = await page.evaluate(() => {
				const ctrl = document.querySelector('.newtab-control');
				if (!ctrl) {return 'no-control-found';}
				return window.getComputedStyle(ctrl).display;
			});
			expect(controlDisplay).toBe('none');

			// Disable lock.
			await page.evaluate(() => {
				const cb = document.querySelector('[name="locked"]');
				cb.checked = false;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const unlockedAfter = await page.evaluate(() => {
				return document.documentElement.hasAttribute('locked');
			});
			expect(unlockedAfter).toBe(false);

			// Cleanup: unpin.
			await page.evaluate(async () => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: 'https://lock-test.example.com/' }, resolve);
				});
			});
		} catch (e) {
			await captureFailure(page, 'lock-grid');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('lock-toggle button at bottom-right reflects locked state', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Ensure clean unlocked state.
			await page.evaluate(() => {
				Prefs.locked = false;
			});
			await new Promise(r => setTimeout(r, 300));

			// The locked-toggle button should exist.
			const hasButton = await page.evaluate(() => {
				return !!document.getElementById('locked-toggle');
			});
			expect(hasButton).toBe(true);

			// Enable lock via settings.
			await page.evaluate(() => document.getElementById('options-toggle').click());
			await new Promise(r => setTimeout(r, 500));
			await page.evaluate(() => {
				const cb = document.querySelector('[name="locked"]');
				cb.checked = true;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 500));

			// Verify locked attribute on root (button icon depends on themed images).
			const locked = await page.evaluate(() => {
				return document.documentElement.getAttribute('locked');
			});
			expect(locked).toBe('true');

			// Cleanup: unlock.
			await page.evaluate(() => {
				const cb = document.querySelector('[name="locked"]');
				cb.checked = false;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			});
		} catch (e) {
			await captureFailure(page, 'lock-grid-button');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
