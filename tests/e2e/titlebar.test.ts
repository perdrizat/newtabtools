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

describe('E2E: Titlebar (inline-recent slot layout)', () => {
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

	it('renders #ntt-titlebar with wordmark, search, recent container, and buttons', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const result = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-titlebar');
					if (!bar) { return false; }
					const mast = document.getElementById('ntt-masthead');
					const wordmark = !!(mast && mast.querySelector('#ntt-wordmark'));
					const search = !!document.getElementById('ntt-search');
					const recent = !!document.getElementById('ntt-titlebar-recent');
					const buttons = !!(mast && mast.querySelector('#ntt-titlebar-buttons'));
					// Clock + theme toggle were removed in the inline-recent redesign.
					const noClock = !document.getElementById('ntt-clock');
					const noTheme = !document.getElementById('ntt-theme-toggle');
					if (wordmark && search && recent && buttons && noClock && noTheme) { return true; }
					return JSON.stringify({ wordmark, search, recent, buttons, noClock, noTheme });
				},
				[],
				{ timeout: 10_000, message: 'Titlebar elements not as expected' }
			);
			expect(result).toBe(true);
		} catch (e) {
			await captureFailure(page, 'titlebar-renders');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('titlebar has no bottom border (tile-gap spacing only)', async () => {
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

	it('_layoutTitlebar sets the slot-width custom property', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// The redesign shrinks the recent cards to fill the greedy container
			// via `--ntt-slot-w`; the search box is a fixed-width box (no
			// `--ntt-search-w` var any more).
			const slot = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-titlebar') as HTMLElement;
					if (!bar) { return false; }
					const s = bar.style.getPropertyValue('--ntt-slot-w');
					return s ? s : false;
				},
				[],
				{ timeout: 10_000, message: 'Slot-width custom property not set' }
			) as string;
			expect(slot).toMatch(/^\d+px$/);
			// Cards never exceed the 186px default width.
			expect(parseInt(slot)).toBeLessThanOrEqual(186);
		} catch (e) {
			await captureFailure(page, 'titlebar-slot-vars');
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
					// Two-line wordmark: "New Tab" / "Powertools".
					return (t.includes('New Tab') && t.includes('Powertools')) ? t : false;
				},
				[],
				{ timeout: 10_000, message: 'Wordmark text not found' }
			);
			expect(text).toContain('New Tab');
			expect(text).toContain('Powertools');
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

	it('buttons cell (lock + cogwheel) sits at the right edge of the titlebar', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		try {
			const result = await page.evaluate(() => {
				const tb = document.getElementById('ntt-titlebar') as HTMLElement;
				const mast = document.getElementById('ntt-masthead') as HTMLElement;
				const recent = document.getElementById('ntt-titlebar-recent') as HTMLElement;
				const cs = getComputedStyle(tb);
				const padR = parseFloat(cs.paddingRight) || 0;
				const rcs = recent ? getComputedStyle(recent) : null;
				return {
					gap: tb.getBoundingClientRect().right - mast.getBoundingClientRect().right - padR,
					hasWordmark: !!mast.querySelector('#ntt-wordmark'),
					buttonCount: mast.querySelectorAll('#ntt-titlebar-buttons input, #ntt-titlebar-buttons button').length,
					tbWidth: Math.round(tb.getBoundingClientRect().width),
					recentWidth: recent ? Math.round(recent.getBoundingClientRect().width) : -1,
					mastWidth: Math.round(mast.getBoundingClientRect().width),
					recentFlex: rcs ? rcs.flexGrow + '/' + rcs.flexShrink + '/' + rcs.flexBasis : 'n/a',
					tbDisplay: cs.display,
				};
			});
			// The masthead's right edge hugs the titlebar content edge.
			expect(
				Math.abs(result.gap),
				`masthead not flush right — ${JSON.stringify(result)}`
			).toBeLessThan(4);
			// Combined box holds the wordmark + lock + cogwheel (theme removed).
			expect(result.hasWordmark).toBe(true);
			expect(result.buttonCount).toBe(2);
		} catch (e) {
			await captureFailure(page, 'titlebar-buttons-right');
			throw e;
		} finally {
			await page.close();
		}
	}, 30_000);
});
