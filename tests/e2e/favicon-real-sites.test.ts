/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: real favicons reach the tile for third-party HTTPS sites.
 *
 * Under the §1.1 model (audit/2026-05-31-csp-tightening.md) the capture
 * pipeline records a favicon per visited site: a `data:` favicon is decoded +
 * cached as a Blob, while a remote `http(s):` favicon is stored as its URL
 * string and rendered live via `<img>` (no fetch — the `connect-src https:`
 * wildcard was removed; `img-src https:` governs the paint). heise.de
 * (`https://www.heise.de/favicon.ico`) and TechCrunch serve remote favicons,
 * so they arrive as URL strings.
 *
 * This test pins both URLs, navigates to each so the capture pipeline runs,
 * asserts a favicon (Blob or URL string) is recorded, then reloads and asserts
 * the tile's overlay badge ends up with an `<img>`.
 *
 * NETWORK-GATED: this is the only E2E test that depends on the *public
 * internet* — it visits live third-party sites and waits for Firefox to fetch
 * their real favicons within the capture window. That makes it inherently
 * non-deterministic on CI runners (network latency / a site being slow can
 * leave `tab.favIconUrl` unpopulated before the ≤2 s capture deadline).
 *
 * So it runs **by default everywhere except GitHub Actions**: every contributor
 * exercises the live favicon path with no extra setup (`pnpm test:e2e`), but it
 * is skipped on GitHub CI. GitHub Actions always sets `GITHUB_ACTIONS=true` and
 * nothing else does, so that env var is a 100%-reliable "are we on GitHub CI?"
 * signal. The §1.1 favicon *logic* (data: → Blob, remote → stored URL string,
 * page-side <img> render) is additionally covered deterministically at the
 * Fast/integration tier, so GitHub never loses real coverage.
 */

// GitHub Actions sets GITHUB_ACTIONS=true on every runner; no local shell or
// other CI sets it. Skip there, run everywhere else.
const IN_GITHUB_CI = process.env.GITHUB_ACTIONS === 'true';

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
	removeTileByUrl,
} from './_helpers.ts';

const HEISE = 'https://www.heise.de/';
const TECHCRUNCH = 'https://techcrunch.com/';

describe.skipIf(IN_GITHUB_CI)('E2E: real favicons for third-party HTTPS sites', () => {
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

			// Query the background's `Thumbnails.getFavicons`. Under the §1.1
			// model (audit/2026-05-31-csp-tightening.md) a favicon comes back
			// EITHER as a Blob (a `data:` favicon, decoded + cached) OR as a
			// remote URL string (rendered live via <img>, no fetch). heise.de /
			// techcrunch.com serve `https://…/favicon.ico`, so they arrive as
			// URL strings. Accept either shape and require it to be present.
			const result = await waitForCondition(
				page,
				(...args: unknown[]) => {
					const urls = args[0] as string[];
					return new Promise(resolve => {
						chrome.runtime.sendMessage({ name: 'Thumbnails.getFavicons', urls }, (response: Map<string, unknown>) => {
							if (!response || response.size < urls.length) { resolve(null); return; }
							const out: Record<string, { kind: string; detail: string } | null> = {};
							for (const u of urls) {
								const v = response.get(u);
								if (v instanceof Blob) {
									out[u] = { kind: 'blob', detail: `${v.size}` };
								} else if (typeof v === 'string') {
									out[u] = { kind: 'url', detail: v };
								} else {
									out[u] = null;
								}
							}
							resolve(out);
						});
					});
				},
				[[HEISE, TECHCRUNCH]],
				{ timeout: 20_000, message: 'No favicons stored in IDB for one or both sites' }
			) as Record<string, { kind: string; detail: string } | null>;

			for (const site of [HEISE, TECHCRUNCH]) {
				expect(result[site]).not.toBeNull();
				if (result[site]!.kind === 'blob') {
					// data: favicon — cached Blob, capped at 64 KB.
					expect(Number(result[site]!.detail)).toBeGreaterThan(0);
					expect(Number(result[site]!.detail)).toBeLessThanOrEqual(64 * 1024);
				} else {
					// remote favicon — an https URL string for live <img>.
					expect(result[site]!.kind).toBe('url');
					expect(result[site]!.detail).toMatch(/^https?:\/\//);
				}
			}

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
					const sites = document.querySelectorAll('#newtab-grid .newtab-site');
					const seen: Record<string, boolean> = {};
					for (const s of Array.from(sites)) {
						const href = (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href;
						if (!href || !urls.includes(href)) { continue; }
						const badge = s.querySelector('.ntt-favicon');
						if (badge && badge.querySelector('img')) {
							seen[href] = true;
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
					// `Tiles.unpinTile` is not a real wire name — see
					// removeTileByUrl's JSDoc in _helpers.ts.
					await removeTileByUrl(cleanup, url);
				}
				await cleanup.close();
			} catch { /* best-effort */ }
			await page.close();
		}
	}, 180_000);
});
