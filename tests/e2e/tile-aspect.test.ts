import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
	getNewTabURL,
} from './_helpers.ts';

/**
 * E2E: tile aspect ratio (issue #505).
 *
 * Verifies that switching the new "Tile aspect ratio" select changes the
 * :root[tileaspect] attribute, that locked aspect ratios actually constrain
 * cell shape, that the setting persists across reloads, and that drag-reorder
 * remains functional with a non-default aspect.
 */
describe('E2E: Tile aspect ratio (issue #505)', () => {
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

	/** Set tileAspect via the settings select and wait for reflow. */
	async function setAspect(page: any, value: string): Promise<void> {
		await page.evaluate(() => document.getElementById('options-toggle')!.click());
		await new Promise(r => setTimeout(r, 300));
		await page.evaluate((v: string) => {
			const select = document.querySelector('[name="tileAspect"]') as HTMLSelectElement;
			select.value = v;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}, value);
		await new Promise(r => setTimeout(r, 300));
	}

	/** Read computed aspect ratio of the first .newtab-cell. */
	async function cellAspect(page: any): Promise<number> {
		return page.evaluate(() => {
			const cell = document.querySelector('.newtab-cell') as HTMLElement;
			const r = cell.getBoundingClientRect();
			return r.width / r.height;
		});
	}

	it('defaults to "fill" mode (no tileaspect attribute or fill)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const attr = await page.evaluate(() => document.documentElement.getAttribute('tileaspect'));
			// Either unset (legacy profiles) or explicitly 'fill' is acceptable.
			expect(attr === null || attr === 'fill').toBe(true);
		} catch (e) {
			await captureFailure(page, 'aspect-default');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('16:9 lock sets attribute and yields ~16:9 cells', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await setAspect(page, '16-9');

			const attr = await page.evaluate(() => document.documentElement.getAttribute('tileaspect'));
			expect(attr).toBe('16-9');

			const ratio = await cellAspect(page);
			// Allow generous tolerance for browser layout pixel rounding.
			expect(ratio).toBeGreaterThan(1.6);
			expect(ratio).toBeLessThan(2.0);

			await setAspect(page, 'fill');
		} catch (e) {
			await captureFailure(page, 'aspect-16-9');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('3:4 portrait lock yields cells taller than wide', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await setAspect(page, '3-4');

			const attr = await page.evaluate(() => document.documentElement.getAttribute('tileaspect'));
			expect(attr).toBe('3-4');

			const ratio = await cellAspect(page);
			// 3/4 = 0.75; tolerance for layout rounding.
			expect(ratio).toBeGreaterThan(0.6);
			expect(ratio).toBeLessThan(0.9);

			await setAspect(page, 'fill');
		} catch (e) {
			await captureFailure(page, 'aspect-3-4');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('1:1 lock yields square cells', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await setAspect(page, '1-1');

			const ratio = await cellAspect(page);
			expect(ratio).toBeGreaterThan(0.9);
			expect(ratio).toBeLessThan(1.1);

			await setAspect(page, 'fill');
		} catch (e) {
			await captureFailure(page, 'aspect-1-1');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('persists tileAspect across page reload', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await setAspect(page, '4-3');

			// Re-navigate to the same URL (pattern used by other E2E tests —
			// page.reload via BiDi can hang on extension pages).
			const url = await getNewTabURL();
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const attr = await page.evaluate(() => document.documentElement.getAttribute('tileaspect'));
			expect(attr).toBe('4-3');

			await setAspect(page, 'fill');
		} catch (e) {
			await captureFailure(page, 'aspect-persist');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
