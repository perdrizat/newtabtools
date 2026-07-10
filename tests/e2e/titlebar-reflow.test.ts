import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	nudgeRecentRefresh,
	openDrawerUI,
	closeDrawerUI,
} from './_helpers.ts';

/**
 * Regression: the recently-closed card count in the titlebar must always match
 * what the LIVE width of the greedy card container (`#ntt-titlebar-recent`)
 * allows — the browser sizes that container to exactly the room left after the
 * fixed search box and the masthead — and it must re-flow on every layout-
 * changing event, in particular opening AND closing the config drawer (a push-
 * layout that narrows then restores the titlebar).
 *
 * The reported bug: opening the drawer collapsed the row to a single card, and
 * closing it did not restore the others (only the search box recentred); a page
 * reload was needed to recover. Root cause was a fragile hand-measurement of
 * the masthead via getBoundingClientRect mid drawer-transition; the fix reads
 * the settled `clientWidth` of the greedy container instead.
 *
 * The available-card supply is stubbed (20 distinct tabs) so the rendered count
 * is governed purely by the width calculation, never starved by how many tabs
 * happen to be in the session store.
 */

async function injectFakeRecent(page: Page, n = 20): Promise<void> {
	await page.evaluate((count) => {
		const fake: unknown[] = [];
		for (let i = 0; i < count; i++) {
			fake.push({
				tab: {
					url: `https://site${i}.example/`,
					title: `Site ${i}`,
					sessionId: 's' + i,
					favIconUrl: null,
					incognito: false,
					lastModified: Math.floor(Date.now() / 1000) - 60,
				},
			});
		}
		(chrome.sessions as any).getRecentlyClosed = (cb: (items: unknown[]) => void) => cb(fake);
	}, n);
}

// Returns the current titlebar state. `expected` mirrors production exactly:
// the card count derived purely from the greedy container's measured width
// (see _layoutTitlebar / computeTitlebarSlots), so the assertion is
// "rendered == correctly-calculated-for-the-live-width".
async function measure(
	page: Page
): Promise<{ rendered: number; expected: number; cardSpace: number; gap: number }> {
	return await page.evaluate(() => {
		const tb = document.getElementById('ntt-titlebar') as HTMLElement;
		const recent = document.getElementById('ntt-titlebar-recent') as HTMLElement | null;
		const cs = getComputedStyle(tb);
		const gap = parseFloat(cs.columnGap || cs.gap) || 10;
		const cardSpace = recent ? recent.clientWidth : 0;
		const full = 186;
		const expected = cardSpace > 0 ? Math.ceil((cardSpace + gap) / (full + gap)) : 0;
		const rendered = document.querySelectorAll('#ntt-titlebar-recent .ntt-recent-card').length;
		return { rendered, expected, cardSpace, gap };
	});
}

describe('E2E: titlebar recent-card reflow on drawer open/close', () => {
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

	it('renders the calculated card count and restores it after the drawer closes', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await injectFakeRecent(page, 20);
			// Wait until the titlebar has a real laid-out width and the masthead
			// exists before forcing the first re-flow.
			await waitForCondition(
				page,
				() => {
					const tb = document.getElementById('ntt-titlebar') as HTMLElement | null;
					return !!(tb && tb.clientWidth > 0 && document.getElementById('options-toggle'));
				},
				[],
				{ timeout: 10_000, message: 'Titlebar never gained a non-zero layout width' }
			);
			await nudgeRecentRefresh(page);

			// Poll until the rendered count converges to the value computed
			// from the live width — layout in the headless window can take a
			// frame or two. Returns the converged measurement; throws (with
			// the last mismatched values) when the deadline passes.
			const settle = async (label: string) => {
				let last = { rendered: -1, expected: -2, cardSpace: -1, gap: 10 };
				const deadline = Date.now() + 6000;
				while (Date.now() < deadline) {
					last = await measure(page);
					if (last.rendered === last.expected) { return last; }
					await new Promise(r => setTimeout(r, 150));
				}
				throw new Error(`${label}: card count never matched calc (rendered=${last.rendered}, expected=${last.expected}, cardSpace=${last.cardSpace}, gap=${last.gap})`);
			};

			// 1) Drawer closed (wide): rendered must equal the count calculated
			//    from the live container width, and the wide bar shows several.
			const closed = await settle('closed');
			expect(closed.expected).toBeGreaterThan(1);

			// 2) Open the drawer. It is a flex sibling of the scrollbox (0 →
			//    360px), so it narrows the titlebar. The recent row MUST re-flow
			//    so rendered keeps matching the calc for the new width — `settle`
			//    throws if it stays frozen, which is exactly the reported bug
			//    ("opening the drawer removes all but one card", the row stuck
			//    against a transient narrow width). It must not collapse to one.
			await openDrawerUI(page);
			const open = await settle('drawer-open');
			expect(open.rendered).toBeGreaterThan(1);

			// 3) Close the drawer — the row must re-flow back to the full width
			//    and recover every card (the reported bug left it collapsed,
			//    needing a reload to recover). `settle` proves rendered === calc;
			//    the count returns to the original closed value.
			await closeDrawerUI(page);
			const restored = await settle('drawer-closed');
			expect(restored.rendered).toBe(closed.rendered);
		} catch (e) {
			await captureFailure(page, 'titlebar-reflow');
			throw e;
		} finally {
			await page.close();
		}
	}, 120_000);
});
