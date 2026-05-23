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

describe('E2E: Titlebar', () => {
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

	it('renders #ntt-titlebar with all child elements', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const result = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-titlebar');
					if (!bar) { return false; }
					const wordmark = !!document.getElementById('ntt-wordmark');
					const search = !!document.getElementById('ntt-search');
					const clock = !!document.getElementById('ntt-clock');
					const buttons = !!document.getElementById('ntt-titlebar-buttons');
					if (wordmark && search && clock && buttons) { return true; }
					return JSON.stringify({ wordmark, search, clock, buttons });
				},
				[],
				{ timeout: 10_000, message: 'Titlebar elements not found' }
			);
			expect(result).toBe(true);
		} catch (e) {
			await captureFailure(page, 'titlebar-renders');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('titlebar has bottom border', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const border = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-titlebar');
					if (!bar) { return false; }
					const bb = getComputedStyle(bar).borderBottomWidth;
					return bb && bb !== '0px' ? bb : false;
				},
				[],
				{ timeout: 10_000, message: 'Titlebar border not found' }
			);
			expect(border).toBe('1px');
		} catch (e) {
			await captureFailure(page, 'titlebar-border');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('clock shows current time in HH:MM format', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const time = await waitForCondition(
				page,
				() => {
					const el = document.getElementById('ntt-clock-time');
					if (!el) { return false; }
					const text = el.textContent || '';
					return /^\d{2}:\d{2}$/.test(text) ? text : false;
				},
				[],
				{ timeout: 10_000, message: 'Clock time not in HH:MM format' }
			);
			expect(time).toMatch(/^\d{2}:\d{2}$/);
		} catch (e) {
			await captureFailure(page, 'titlebar-clock');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('wordmark displays extension name', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const text = await waitForCondition(
				page,
				() => {
					const el = document.getElementById('ntt-wordmark');
					if (!el) { return false; }
					const t = el.textContent || '';
					return t.includes('New Tab Tools') ? t : false;
				},
				[],
				{ timeout: 10_000, message: 'Wordmark text not found' }
			);
			expect(text).toContain('New Tab Tools');
		} catch (e) {
			await captureFailure(page, 'titlebar-wordmark');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('search is hidden by default', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hidden = await waitForCondition(
				page,
				() => {
					const el = document.getElementById('ntt-search');
					if (!el) { return false; }
					return el.hidden;
				},
				[],
				{ timeout: 10_000, message: 'Search element not found' }
			);
			expect(hidden).toBe(true);
		} catch (e) {
			await captureFailure(page, 'titlebar-search-hidden');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('theme toggle button exists with sun or moon icon', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasSvg = await waitForCondition(
				page,
				() => {
					const btn = document.getElementById('ntt-theme-toggle');
					if (!btn) { return false; }
					return !!btn.querySelector('svg');
				},
				[],
				{ timeout: 10_000, message: 'Theme toggle SVG not found' }
			);
			expect(hasSvg).toBe(true);
		} catch (e) {
			await captureFailure(page, 'titlebar-theme-toggle');
			throw e;
		} finally {
			await page.close();
		}
	});
});
