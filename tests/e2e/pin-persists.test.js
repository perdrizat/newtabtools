import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
} from './_helpers.js';

const TEST_URL = 'https://example.com/';

// NOTE on test shape:
//
// BOOTSTRAP step 8.2 originally specified pinning via the Add Tile UI flow
// (open settings → type URL → click Add). That path requires the optional
// `history` permission, which is not granted in a fresh CI profile —
// `chrome.history.search` is undefined and the click handler errors silently
// (it ends `.catch(console.error)` instead of throwing).
//
// We therefore split the end-to-end coverage across two `it` blocks:
//   1. "persists across reload" — uses the Tiles.pinTile message to set the
//      state, then asserts the UI renders the tile as pinned and that state
//      survives a reload. Storage + render + persistence covered.
//   2. "unpin via UI click" — clicks the in-grid pin button (a real DOM
//      event, not a message) to toggle off, asserts the UI updates, and
//      reloads to confirm the change persisted. UI click handler covered.
//
// Together these cover the user-visible behaviour without needing the
// optional history permission. A future test can add the Add-Tile UI flow
// once permission setup is solved (see E2E_REVIEW_TASKS.md item 2 followups).
describe('E2E Smoke: Pin/unpin via UI', () => {
	let browser;

	beforeAll(async () => {
		browser = await connectToFirefox();
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
	});

	it('pin set via background persists across reload and renders [pinned] in the UI', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			await page.evaluate(async (u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Example',
						url: u,
					}, resolve);
				});
			}, TEST_URL);

			// First reload — verify the pinned state was persisted to storage
			// and the UI renders [pinned].
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await page.waitForSelector('.newtab-control-pin[pinned]', { timeout: 20_000 });

			// Second reload — same expectation. Catches cases where the pin
			// state is cached in memory but not durably written.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await page.waitForSelector('.newtab-control-pin[pinned]', { timeout: 20_000 });

			const state = await page.evaluate((u) => {
				const g = window.Grid;
				if (!g || !g.sites) {
					return { hasGrid: false };
				}
				const match = g.sites.find(s => s && s.url === u);
				return {
					hasGrid: true,
					found: !!match,
					isPinned: match ? !!match.isPinned : false,
				};
			}, TEST_URL);

			expect(state).toEqual({ hasGrid: true, found: true, isPinned: true });
		} catch (e) {
			await captureFailure(page, 'pin-persists-step1');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('clicking the in-grid pin button unpins the tile and the change persists', async () => {
		// State from the previous test: TEST_URL is pinned. Use that as the
		// starting condition rather than re-pinning here — exercises the
		// natural cross-test flow.
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Confirm precondition: a pinned tile is rendered.
			await page.waitForSelector('.newtab-control-pin[pinned]', { timeout: 15_000 });

			// Click the pin button. Use a real DOM click so the extension's
			// click handler fires the way it would for a user.
			await page.click('.newtab-control-pin[pinned]');

			// The site object's pinned state should flip in-memory.
			await waitForCondition(
				page,
				(u) => {
					const g = window.Grid;
					if (!g || !g.sites) {
						return false;
					}
					const match = g.sites.find(s => s && s.url === u);
					// Either the site is no longer in the grid, or it's no longer pinned.
					return !match || !match.isPinned;
				},
				[TEST_URL],
				{ timeout: 10_000, message: 'tile did not unpin after UI click' }
			);

			// Reload — the unpin must have been persisted.
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			const stateAfterReload = await page.evaluate((u) => {
				const g = window.Grid;
				if (!g || !g.sites) {
					return { hasGrid: false };
				}
				const match = g.sites.find(s => s && s.url === u);
				return {
					hasGrid: true,
					found: !!match,
					isPinned: match ? !!match.isPinned : false,
				};
			}, TEST_URL);

			// The tile may either be gone entirely (history-fallback removed it)
			// or still present but not pinned. Either is correct unpinned state.
			expect(stateAfterReload.hasGrid).toBe(true);
			if (stateAfterReload.found) {
				expect(stateAfterReload.isPinned).toBe(false);
			}
		} catch (e) {
			await captureFailure(page, 'pin-persists-step2');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
