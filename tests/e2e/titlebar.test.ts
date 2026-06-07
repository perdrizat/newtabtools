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

	it('renders #ntt-titlebar with search, recent container, and a single Edit button (Board A)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const result = await waitForCondition(
				page,
				() => {
					const bar = document.getElementById('ntt-titlebar');
					if (!bar) { return false; }
					const search = !!document.getElementById('ntt-search');
					const recent = !!document.getElementById('ntt-titlebar-recent');
					const edit = !!document.getElementById('options-toggle');
					// Board A drops the wordmark, masthead, lock/cogwheel cluster,
					// clock, and theme toggle.
					const noWordmark = !document.getElementById('ntt-wordmark');
					const noMasthead = !document.getElementById('ntt-masthead');
					const noButtons = !document.getElementById('ntt-titlebar-buttons');
					const noLock = !document.getElementById('locked-toggle');
					const noClock = !document.getElementById('ntt-clock');
					if (search && recent && edit && noWordmark && noMasthead && noButtons && noLock && noClock) { return true; }
					return JSON.stringify({ search, recent, edit, noWordmark, noMasthead, noButtons, noLock, noClock });
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

	it('the single titlebar action button reads "Edit"', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const text = await waitForCondition(
				page,
				() => {
					const el = document.getElementById('options-toggle');
					if (!el) { return false; }
					const t = (el.textContent || '').trim();
					return t === 'Edit' ? t : false;
				},
				[],
				{ timeout: 10_000, message: 'Edit button text not found' }
			);
			expect(text).toBe('Edit');
		} catch (e) {
			await captureFailure(page, 'titlebar-edit-label');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('search is shown by default (titleBarSearch defaults on for the awesome bar)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const shown = await waitForCondition(
				page,
				() => {
					const el = document.getElementById('ntt-search');
					if (!el) { return false; }
					return el.hidden === false ? true : false;
				},
				[],
				{ timeout: 10_000, message: 'Search box not visible by default' }
			);
			expect(shown).toBe(true);
		} catch (e) {
			await captureFailure(page, 'titlebar-search-shown');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('the Edit button sits flush at the right edge of the titlebar', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		try {
			const result = await page.evaluate(() => {
				const tb = document.getElementById('ntt-titlebar') as HTMLElement;
				const edit = document.getElementById('options-toggle') as HTMLElement;
				const recent = document.getElementById('ntt-titlebar-recent') as HTMLElement;
				const cs = getComputedStyle(tb);
				const padR = parseFloat(cs.paddingRight) || 0;
				const rcs = recent ? getComputedStyle(recent) : null;
				return {
					gap: tb.getBoundingClientRect().right - edit.getBoundingClientRect().right - padR,
					editText: (edit.textContent || '').trim(),
					tbWidth: Math.round(tb.getBoundingClientRect().width),
					recentWidth: recent ? Math.round(recent.getBoundingClientRect().width) : -1,
					recentFlex: rcs ? rcs.flexGrow + '/' + rcs.flexShrink + '/' + rcs.flexBasis : 'n/a',
					tbDisplay: cs.display,
				};
			});
			// The Edit button's right edge hugs the titlebar content edge.
			expect(
				Math.abs(result.gap),
				`Edit button not flush right — ${JSON.stringify(result)}`
			).toBeLessThan(4);
			expect(result.editText).toBe('Edit');
		} catch (e) {
			await captureFailure(page, 'titlebar-edit-right');
			throw e;
		} finally {
			await page.close();
		}
	}, 30_000);
});
