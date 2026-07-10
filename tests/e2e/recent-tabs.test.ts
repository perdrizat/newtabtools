import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	setPrefs,
	nudgeRecentRefresh,
} from './_helpers.ts';

/**
 * E2E for the recently-closed-tabs row in the titlebar.
 *
 * Both cases stub `chrome.sessions.getRecentlyClosed` so the rendered cards are
 * deterministic. In the full suite the REAL recently-closed list is dominated
 * by the many `moz-extension://` new-tab pages prior test files open (which
 * `refreshRecent` skips) plus other entries competing against the width-derived
 * card cap, so a specific seeded URL is not reliably among the rendered cards —
 * and actually closing a real tab adds network/contention flakiness without
 * adding assurance (we never assert against the real entry). Firefox's session
 * plumbing is platform behaviour we trust; here we assert NTT's render / link /
 * toggle behaviour against a known stubbed entry. Every predicate nudges
 * `refreshRecent` so the assertion never races the container's layout settle or
 * a pending requestAnimationFrame re-flow.
 */

const STUB_ITEMS = `[
	{ tab: { url: 'https://recent-a.example/', title: 'Recent A', sessionId: 'ra', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) } },
	{ tab: { url: 'https://recent-b.example/', title: 'Recent B', sessionId: 'rb', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) } }
]`;

describe('E2E: Recently-closed-tabs row (slot 24)', () => {
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

	it('renders a recently-closed tab as a card linking to it', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(`(() => {
				const items = ${STUB_ITEMS};
				chrome.sessions.getRecentlyClosed = (cb) => cb(items);
			})()`);

			await setPrefs(page, { recent: true });
			await nudgeRecentRefresh(page);

			await waitForCondition(
				page,
				() => {
					const list = document.getElementById('ntt-titlebar-recent');
					return !!list && list.querySelectorAll('a.ntt-recent-card').length > 0;
				},
				[],
				{ timeout: 10_000, message: 'Recently-closed list did not show any items' }
			);

			// The rendered card links to the closed tab.
			const recentUrls = await page.evaluate(() => {
				const list = document.getElementById('ntt-titlebar-recent');
				return [...list!.querySelectorAll('a.ntt-recent-card')].map(a => (a as HTMLAnchorElement).href);
			});
			expect(recentUrls.some(u => u.includes('recent-a.example'))).toBe(true);
		} catch (e) {
			await captureFailure(page, 'recent-tabs');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('Prefs.recent toggle empties / repopulates the row (container stays laid out)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate(`(() => {
				const items = ${STUB_ITEMS};
				chrome.sessions.getRecentlyClosed = (cb) => cb(items);
			})()`);

			// Recent ON → at least one card renders.
			await setPrefs(page, { recent: true });
			await nudgeRecentRefresh(page);
			await waitForCondition(
				page,
				() => document.querySelectorAll('#ntt-titlebar-recent .ntt-recent-card').length > 0,
				[],
				{ timeout: 10_000, message: 'cards did not render with recent ON' }
			);

			// Recent OFF → no cards, but the container stays laid out: it is the
			// greedy spacer that pins the masthead to the right edge, so it must
			// NOT be display:none'd (the reflow redesign deliberately dropped the
			// old `[hidden]` behaviour).
			await setPrefs(page, { recent: false });
			await nudgeRecentRefresh(page);
			await waitForCondition(
				page,
				() => document.querySelectorAll('#ntt-titlebar-recent .ntt-recent-card').length === 0,
				[],
				{ timeout: 10_000, message: 'cards did not clear with recent OFF' }
			);
			const offDisplay = await page.evaluate(
				() => getComputedStyle(document.getElementById('ntt-titlebar-recent')!).display
			);
			expect(offDisplay).not.toBe('none');

			// Re-enable → cards come back.
			await setPrefs(page, { recent: true });
			await nudgeRecentRefresh(page);
			await waitForCondition(
				page,
				() => document.querySelectorAll('#ntt-titlebar-recent .ntt-recent-card').length > 0,
				[],
				{ timeout: 10_000, message: 'cards did not return when recent re-enabled' }
			);
			const reonCards = await page.evaluate(
				() => document.querySelectorAll('#ntt-titlebar-recent .ntt-recent-card').length
			);
			expect(reonCards).toBeGreaterThan(0);
		} catch (e) {
			await captureFailure(page, 'recent-tabs-toggle');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('uses the extension-stored favicon when the session record carries none', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// A closed tab with NO session favIconUrl, plus a stubbed background
			// favicon store that HAS a (Blob) favicon for that URL — the card should
			// render the stored favicon image rather than the letter glyph.
			await page.evaluate(() => {
				const w = window as any;
				// A deep article URL (host stored-fav.example) with NO session favicon —
				// the host-keyed stored-favicon lookup should still find the site favicon.
				w.chrome.sessions.getRecentlyClosed = (cb: any) => cb([
					{ tab: { url: 'https://stored-fav.example/2024/06/some-article', title: 'Stored Fav', sessionId: 'sf', favIconUrl: null, incognito: false, lastModified: 0 } },
				]);
				const orig = w.chrome.runtime.sendMessage;
				w.chrome.runtime.sendMessage = function(msg: any, cb: any) {
					if (msg && msg.name === 'Thumbnails.getFaviconsByHost') {
						const m = new Map();
						for (const h of msg.hosts) {
							m.set(h, new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>'], { type: 'image/svg+xml' }));
						}
						if (cb) { cb(m); }
						return;
					}
					return orig.apply(this, arguments as any);
				};
			});
			await setPrefs(page, { recent: true });
			await nudgeRecentRefresh(page);
			// Poll rather than fixed-sleep: the stored-favicon <img> lands
			// only after refreshRecent's async Thumbnails.getFaviconsByHost
			// round-trip resolves, which under full-suite load can outlast
			// any fixed budget.
			const hasImg = await waitForCondition(
				page,
				() => {
					const card = document.querySelector('#ntt-titlebar-recent .ntt-recent-card[data-session-id="sf"]')
						|| document.querySelector('#ntt-titlebar-recent .ntt-recent-card');
					const fav = card && card.querySelector('.ntt-recent-favicon');
					return !!(fav && fav.querySelector('img'));
				},
				[],
				{ timeout: 10_000, message: 'stored favicon <img> never rendered into the recent card' }
			);
			expect(hasImg).toBe(true);
		} catch (e) {
			await captureFailure(page, 'recent-stored-favicon');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
