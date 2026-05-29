import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

describe('E2E: Statusbar', () => {
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

	it('renders #ntt-statusbar with hint pills and summary', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const result = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-statusbar');
					if (!bar) { return false; }
					const hints = document.getElementById('ntt-statusbar-hints');
					const summary = document.getElementById('ntt-statusbar-summary');
					const tilecount = document.getElementById('ntt-statusbar-tilecount');
					if (hints && summary && tilecount) { return true; }
					return JSON.stringify({ hints: !!hints, summary: !!summary, tilecount: !!tilecount });
				},
				[],
				{ timeout: 10_000, message: 'Statusbar elements not found' }
			);
			expect(result).toBe(true);
		} catch (e) {
			await captureFailure(page, 'statusbar-renders');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('statusbar has top border', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const border = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-statusbar');
					if (!bar) { return false; }
					const bt = getComputedStyle(bar).borderTopWidth;
					return bt && bt !== '0px' ? bt : false;
				},
				[],
				{ timeout: 10_000, message: 'Statusbar top border not found' }
			);
			expect(border).toBe('1px');
		} catch (e) {
			await captureFailure(page, 'statusbar-border');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('tile count text matches "N tiles · RxC" format', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const text = await waitForCondition(
				page,
				() => {
					const el = document.getElementById('ntt-statusbar-tilecount');
					if (!el) { return false; }
					const t = el.textContent || '';
					return /\d+\s+tiles?\s*·\s*\d+×\d+/.test(t) ? t : false;
				},
				[],
				{ timeout: 10_000, message: 'Tile count text wrong format' }
			);
			expect(text).toMatch(/\d+\s+tiles?\s*·\s*\d+×\d+/);
		} catch (e) {
			await captureFailure(page, 'statusbar-tilecount');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('hint pills contain keyboard shortcuts', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasKbd = await waitForCondition(
				page,
				() => {
					const hints = document.getElementById('ntt-statusbar-hints');
					if (!hints) { return false; }
					return hints.querySelectorAll('.ntt-statusbar-kbd').length > 0;
				},
				[],
				{ timeout: 10_000, message: 'No kbd pills found' }
			);
			expect(hasKbd).toBe(true);
		} catch (e) {
			await captureFailure(page, 'statusbar-hints');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('hides when titleBarStatus pref is false', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => {
				(window as any).Prefs.titleBarStatus = false;
			});
			const hidden = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-statusbar');
					if (!bar) { return false; }
					return bar.hidden;
				},
				[],
				{ timeout: 10_000, message: 'Statusbar did not hide when pref turned off' }
			);
			expect(hidden).toBe(true);
		} catch (e) {
			await captureFailure(page, 'statusbar-hide-pref');
			throw e;
		} finally {
			// Restore for subsequent tests
			try {
				await page.evaluate(() => {
					(window as any).Prefs.titleBarStatus = true;
				});
			} catch { /* page may already be closed */ }
			await page.close();
		}
	});
});
