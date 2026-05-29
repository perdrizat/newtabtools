/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: real favicons land in IDB for third-party HTTPS sites.
 *
 * The fix in Phase 4-5 stored `tab.favIconUrl` content as a Blob in the
 * `thumbnails` IDB row. The original implementation only handled the
 * fetch() failure mode for `data:` URLs (blocked by manifest CSP
 * `connect-src`). The same `connect-src 'self' https://firefox.settings…`
 * also blocks fetch to arbitrary third-party HTTPS hosts, so favicons from
 * sites like heise.de (`https://www.heise.de/favicon.ico`) and TechCrunch
 * never made it into IDB either — they hit the same CSP wall, just under a
 * different scheme.
 *
 * This test pins both URLs, navigates to each so the capture pipeline runs,
 * and asserts that the favicon Blob is stored and non-empty in IDB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	navigateAndConfirm,
} from './_helpers.ts';

const HEISE = 'https://www.heise.de/';
const TECHCRUNCH = 'https://techcrunch.com/';

describe('E2E: real favicons for third-party HTTPS sites', () => {
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

	it('stores a non-empty favicon Blob in IDB after visiting heise.de and techcrunch.com', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const newTabURL = await getNewTabURL();

		try {
			// Pin both sites so they enter the tile cache (which is what the
			// capture pipeline keys off).
			for (const url of [HEISE, TECHCRUNCH]) {
				await page.evaluate(async (u) => {
					return new Promise(resolve => {
						chrome.runtime.sendMessage({
							name: 'Tiles.pinTile',
							title: new URL(u).host,
							url: u,
						}, resolve);
					});
				}, url);
			}

			// Reload so the tiles render and the background cache is
			// definitely synced.
			await page.goto(newTabURL, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await page.waitForSelector('.newtab-site[pinned]', { timeout: 15_000 });

			// Visit each site so capture+favicon fetch fires. We close each
			// navigation page after the multi-stage session has had time to
			// finish (capture A immediate, B at 500 ms, C at ≤2 s network idle).
			for (const url of [HEISE, TECHCRUNCH]) {
				const visit = await browser.newPage();
				try {
					await navigateAndConfirm(visit, url, { timeout: 45_000 });
					// Allow capture session A/B/C to run.
					await new Promise(r => setTimeout(r, 4_500));
				} finally {
					await visit.close();
				}
			}

			// Now query the background's `Thumbnails.getFavicons` and assert
			// both URLs come back with a non-empty Blob.
			const result = await waitForCondition(
				page,
				(...args: unknown[]) => {
					const urls = args[0] as string[];
					return new Promise(resolve => {
						chrome.runtime.sendMessage({ name: 'Thumbnails.getFavicons', urls }, (response: Map<string, Blob>) => {
							if (!response || response.size < urls.length) { resolve(null); return; }
							const out: Record<string, { size: number; type: string } | null> = {};
							for (const u of urls) {
								const blob = response.get(u);
								out[u] = blob ? { size: blob.size, type: blob.type } : null;
							}
							resolve(out);
						});
					});
				},
				[[HEISE, TECHCRUNCH]],
				{ timeout: 20_000, message: 'No favicons stored in IDB for one or both sites' }
			) as Record<string, { size: number; type: string } | null>;

			expect(result[HEISE]).not.toBeNull();
			expect(result[HEISE]!.size).toBeGreaterThan(0);
			expect(result[HEISE]!.size).toBeLessThanOrEqual(64 * 1024);

			expect(result[TECHCRUNCH]).not.toBeNull();
			expect(result[TECHCRUNCH]!.size).toBeGreaterThan(0);
			expect(result[TECHCRUNCH]!.size).toBeLessThanOrEqual(64 * 1024);

			// Reload so the new tab page picks up the just-stored favicons via
			// `getThumbnails → getFavicons`. The visible smoke test is that
			// each tile's `.ntt-favicon` overlay badge ends up containing an
			// `<img>` instead of the letter glyph — the page-side path the
			// prior version of this test silently skipped.
			await page.goto(newTabURL, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			const visible = await waitForCondition(
				page,
				(...args: unknown[]) => {
					const urls = args[0] as string[];
					const g = (window as any).Grid;
					if (!g || !g.sites) { return null; }
					const seen: Record<string, boolean> = {};
					for (const s of g.sites) {
						if (!s || !s.link || !urls.includes(s.link.url)) { continue; }
						const badge = s._querySelector ? s._querySelector('.ntt-favicon') : null;
						if (badge && badge.querySelector('img')) {
							seen[s.link.url] = true;
						}
					}
					return urls.every((u: string) => seen[u]) ? seen : null;
				},
				[[HEISE, TECHCRUNCH]],
				{ timeout: 20_000, message: 'Favicon <img> not rendered into the overlay badge for one or both sites' },
			) as Record<string, boolean>;

			expect(visible[HEISE]).toBe(true);
			expect(visible[TECHCRUNCH]).toBe(true);
		} catch (e) {
			await captureFailure(page, 'favicon-real-sites');
			throw e;
		} finally {
			// Best-effort cleanup so this test doesn't poison the next file.
			try {
				const cleanup = await openNewTab(browser);
				await waitForGridReady(cleanup);
				for (const url of [HEISE, TECHCRUNCH]) {
					await cleanup.evaluate(async (u) => new Promise(resolve => {
						chrome.runtime.sendMessage({ name: 'Tiles.unpinTile', url: u }, resolve);
					}), url);
				}
				await cleanup.close();
			} catch { /* best-effort */ }
			await page.close();
		}
	}, 180_000);
});
