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
 * Phase 4-0 retired the bottom status bar (it has no analogue in the current
 * Firefox new tab page). The markup is kept but ships `hidden`, the drawer
 * toggle is gone, and the `titleBarStatus` pref no longer exists. This suite
 * is the live-browser guard for that removal. (The removed-tile undo toast,
 * which used to live inside the bar, is exercised by tile-redesign.test.ts.)
 */

describe('E2E: Status bar retired (Phase 4-0)', () => {
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

	it('#ntt-statusbar never renders (hidden, zero layout box)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const state = await page.evaluate(() => {
				const el = document.getElementById('ntt-statusbar') as HTMLElement | null;
				if (!el) { return { present: false, hidden: true, width: 0 }; }
				return { present: true, hidden: el.hidden, width: el.offsetWidth };
			});
			// The element may stay in the DOM (full markup removal is deferred to
			// the Phase 5 cleanup), but it must not be laid out.
			expect(state.width).toBe(0);
			if (state.present) {
				expect(state.hidden).toBe(true);
			}
		} catch (e) {
			await captureFailure(page, 'statusbar-retired');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('the drawer Title Bar group offers no status-bar toggle', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasToggle = await waitForCondition(
				page,
				() => {
					// Drawer markup is present from load; assert the toggle is absent.
					return document.querySelector('[data-pref="titleBarStatus"]') === null;
				},
				[],
				{ timeout: 10_000, message: 'titleBarStatus control still present in the drawer' }
			);
			expect(hasToggle).toBe(true);
		} catch (e) {
			await captureFailure(page, 'statusbar-toggle-gone');
			throw e;
		} finally {
			await page.close();
		}
	});
});
