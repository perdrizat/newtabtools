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

	it('titlebar has no bottom border (separator dropped — tile-gap spacing only)', async () => {
		// Phase 3 reshuffle: the underline between titlebar and the grid
		// was dropped; vertical separation comes from `margin-bottom:
		// var(--ntt-gap)` instead.
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const border = await page.evaluate(() => {
				const bar = document.getElementById('ntt-titlebar') as HTMLElement;
				return getComputedStyle(bar).borderBottomWidth;
			});
			expect(border).toBe('0px');
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

	// --- Regressions from the Phase 3 reshuffle ---

	it('regression: cogwheel + lock-toggle stay at the right edge when the clock is hidden', async () => {
		// `margin-left: auto` on #ntt-clock used to be the only way the
		// right cluster reached the right edge. Hiding the clock collapsed
		// the cogwheel + lock-toggle against the wordmark. The sibling
		// rule `#ntt-clock[hidden] + #ntt-titlebar-buttons` now picks up
		// the auto-margin in that case.
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		try {
			const result = await page.evaluate(() => {
				(window as any).Prefs.titleBarClock = false;
				return new Promise<{ buttonsRight: number; titlebarRight: number }>(resolve => {
					setTimeout(() => {
						const tb = document.getElementById('ntt-titlebar') as HTMLElement;
						const btns = document.getElementById('ntt-titlebar-buttons') as HTMLElement;
						resolve({
							buttonsRight: btns.getBoundingClientRect().right,
							titlebarRight: tb.getBoundingClientRect().right,
						});
					}, 300);
				});
			});
			// Buttons cluster's right edge sits close to the titlebar's
			// right edge (allowing for ~30-60px of titlebar padding).
			expect(result.titlebarRight - result.buttonsRight).toBeLessThan(70);
		} catch (e) {
			await captureFailure(page, 'titlebar-buttons-right');
			throw e;
		} finally {
			await page.evaluate(() => { (window as any).Prefs.titleBarClock = true; });
			await page.close();
		}
	}, 30_000);

	it('regression: clock stays at the right edge with search hidden (default state)', async () => {
		// Default profile: titleBarSearch=false. Clock has its own
		// `margin-left: auto` and must reach the right edge with no
		// search bar in between to soak up the space.
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		try {
			const result = await page.evaluate(() => {
				const tb = document.getElementById('ntt-titlebar') as HTMLElement;
				const clock = document.getElementById('ntt-clock') as HTMLElement;
				return {
					clockRight: clock.getBoundingClientRect().right,
					titlebarRight: tb.getBoundingClientRect().right,
					searchHidden: (document.getElementById('ntt-search') as HTMLElement).hidden,
				};
			});
			expect(result.searchHidden).toBe(true);
			// Clock right edge within ~150px of titlebar right edge — the
			// three 32px buttons + 2px gaps + 30px padding sit between.
			expect(result.titlebarRight - result.clockRight).toBeLessThan(150);
		} catch (e) {
			await captureFailure(page, 'titlebar-clock-right-search-hidden');
			throw e;
		} finally {
			await page.close();
		}
	}, 30_000);
});
