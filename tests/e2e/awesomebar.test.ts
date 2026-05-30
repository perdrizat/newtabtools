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

/**
 * Phase 4-3 — Awesome bar, end-to-end in Firefox ESR. Verifies the search box
 * is wired: pressing "/" focuses it (preempting Quick Find), typing renders the
 * dropdown with a "search the web" entry, the grid dims while open, and Escape
 * closes it. Bookmarks/history results depend on optional permissions + profile
 * state, so the deterministic assertions ride on the always-present web entry.
 */

describe('E2E: Awesome bar (Phase 4-3)', () => {
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

	it('"/" focuses the search input', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Make sure focus is not already in an input.
			await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
			await page.keyboard.press('/');
			const focused = await waitForCondition(
				page,
				() => document.activeElement === document.getElementById('ntt-search-input'),
				[],
				{ timeout: 10_000, message: '"/" did not focus the search input' }
			);
			expect(focused).toBe(true);

			// And Quick Find must not have hijacked it: the input should be empty
			// (no stray "/" character inserted).
			const value = await page.evaluate(() => (document.getElementById('ntt-search-input') as HTMLInputElement).value);
			expect(value).toBe('');
		} catch (e) {
			await captureFailure(page, 'awesomebar-slash-focus');
			throw e;
		} finally {
			await page.close();
		}
	}, 30_000);

	it('typing renders the dropdown with a web-search entry and dims the grid', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => {
				const input = document.getElementById('ntt-search-input') as HTMLInputElement;
				input.focus();
				input.value = 'example query';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});

			const ok = await waitForCondition(
				page,
				() => {
					const dd = document.getElementById('ntt-awesomebar');
					if (!dd || dd.hidden) { return false; }
					const open = document.documentElement.hasAttribute('awesomebar-open');
					const rows = dd.querySelectorAll('.ntt-awesomebar-row').length;
					const hasWeb = [...dd.querySelectorAll('.ntt-awesomebar-title')]
						.some(t => /Search the web/i.test(t.textContent || ''));
					return open && rows > 0 && hasWeb;
				},
				[],
				{ timeout: 10_000, message: 'Awesome bar dropdown did not render a web entry' }
			);
			expect(ok).toBe(true);
		} catch (e) {
			await captureFailure(page, 'awesomebar-render');
			throw e;
		} finally {
			await page.close();
		}
	}, 30_000);

	it('Escape closes the dropdown and clears the query', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(() => {
				const input = document.getElementById('ntt-search-input') as HTMLInputElement;
				input.focus();
				input.value = 'something';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await waitForCondition(
				page,
				() => !document.getElementById('ntt-awesomebar')!.hidden,
				[],
				{ timeout: 10_000, message: 'dropdown did not open before Escape' }
			);

			await page.keyboard.press('Escape');

			const closed = await waitForCondition(
				page,
				() => {
					const dd = document.getElementById('ntt-awesomebar');
					const input = document.getElementById('ntt-search-input') as HTMLInputElement;
					return !!dd && dd.hidden && input.value === '' && !document.documentElement.hasAttribute('awesomebar-open');
				},
				[],
				{ timeout: 10_000, message: 'Escape did not close/clear the awesome bar' }
			);
			expect(closed).toBe(true);
		} catch (e) {
			await captureFailure(page, 'awesomebar-escape');
			throw e;
		} finally {
			await page.close();
		}
	}, 30_000);
});
