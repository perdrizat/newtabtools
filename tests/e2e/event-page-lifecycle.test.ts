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
	IS_CHROME,
	restartChromeServiceWorker,
} from './_helpers.ts';

// audit 2026-07-16 M2 (probed 2026-07-17): this suite is SKIPPED on Chrome.
// It was written to force the respawn precondition via a CDP kill
// (`restartChromeServiceWorker`), but under CfT headless CDP automation
// `Target.closeTarget` is TERMINAL — the worker does not respawn on any wake
// (navigation / extension-page load / runtime message), and Chrome exposes no
// controllable idle-suspension analogue to Firefox's idle-timeout pref. So a
// genuine kill+respawn round-trip can't be produced here; running these tests
// on Chrome would either hang on a dead worker or (before the fix) pass
// vacuously. They run for real on Firefox (which genuinely suspends/respawns
// via the pref below), and the background code is shared across both platforms
// through the `api` seam, so that IS the real respawn-hygiene coverage.
// Restoring a genuine Chrome respawn check is tracked in GH #23.
//
// MV3_MIGRATION.md Slice D: `run_esr_tests.sh` sets
// `extensions.background.idle.timeout=10000` for the whole suite, so the
// event page genuinely suspends after ~10s of no extension activity and
// respawns on the next event. This file deliberately lets that happen (a
// plain sleep, no extension interaction) and then confirms the background
// script's respawn hygiene actually works end-to-end in a real browser:
//   (a) IndexedDB reconnects (Slice B: onclose/onversionchange clear `db`;
//       initDB() re-runs at top level on every respawn) — proven by a
//       message round-trip (Tiles.getAllTiles) succeeding after the sleep.
//   (b) the capture pipeline (multi-stage async, permission guard, network
//       idle watcher) still runs correctly through a fresh respawn.
//   (c) `menus.create`'s duplicate-id error on respawn (Slice B:
//       createMenuTolerant) doesn't break anything — implicit in (a)/(b)
//       succeeding, since a thrown/unhandled menus error at top level would
//       abort the whole script and every message would fail.
//
// Use example.com — the same stable capture target auto-thumbnail.test.ts
// and never-capture.test.ts navigate to.
const TEST_URL = 'https://example.com/';

// Skipped on Chrome — see the block comment above (audit M2, GH #23). Runs for
// real on Firefox.
describe.skipIf(IS_CHROME)('E2E: event-page suspension recovery (MV3_MIGRATION.md Slice D)', () => {
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

	it('event page respawns after idle suspension — Tiles.getAllTiles succeeds (IDB reconnected)', async () => {
		if (IS_CHROME) {
			// Force the kill/respawn directly (see the CHROME.md D5b header note)
			// rather than waiting out a Firefox-only pref.
			await restartChromeServiceWorker(browser);
		} else {
			// No extension messages, no tab navigations — let the background
			// genuinely idle out and tear down before we touch it again.
			await new Promise(r => setTimeout(r, 13_000));
		}

		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Tiles.getAllTiles responds `{ tiles, list }` on success, `null` on
			// an IDB failure (background-messages.test.ts). Reaching the success
			// shape here means the just-respawned event page re-ran its startup
			// IIFE (Prefs.init + initDB) and reconnected to IndexedDB.
			const response = await page.evaluate(() => new Promise((resolve) => {
				chrome.runtime.sendMessage({ name: 'Tiles.getAllTiles' }, resolve);
			})) as { tiles?: unknown; list?: unknown } | null;

			expect(response).not.toBeNull();
			expect(response).toHaveProperty('tiles');
			expect(response).toHaveProperty('list');
		} catch (e) {
			await captureFailure(page, 'event-page-respawn-getalltiles');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('thumbnail capture pipeline still runs correctly through the just-respawned event page', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const url = await getNewTabURL();

		try {
			// Pin the test URL so it enters the tile cache (same precondition
			// auto-thumbnail.test.ts uses for the capture flow).
			await page.evaluate((u) => new Promise((resolve) => {
				chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'Example', url: u }, resolve);
			}), TEST_URL);

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await page.waitForSelector('.newtab-site[pinned]', { timeout: 15_000 });

			// Navigate to the pinned URL: webNavigation.onCompleted ->
			// startCaptureSession's <all_urls> permission check ->
			// multi-stage A/B/C capture -> pickAndStore. All of this runs
			// through the event page that respawned in the previous test —
			// its top-level listeners, capture-session Map, and network-idle
			// watchers were all rebuilt from scratch by that respawn.
			await navigateAndConfirm(page, TEST_URL, { timeout: 30_000 });

			// Give the multi-stage capture (A/B/C, ≤2s hard deadline) time to
			// finalize, then return to the extension page — `page` is a plain
			// content page right now and has no `chrome` global to poll with
			// (same navigate-back idiom as auto-thumbnail.test.ts).
			await new Promise(r => setTimeout(r, 3000));
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Poll for the thumbnail record via the same message newTab.js's
			// getThumbnails uses, checking existence only (not the display
			// layer, already covered by auto-thumbnail.test.ts).
			const hasThumbnail = await waitForCondition(
				page,
				(testUrl) => new Promise((resolve) => {
					chrome.runtime.sendMessage({ name: 'Thumbnails.get', urls: [testUrl] }, (map: Map<string, unknown> | null) => {
						resolve(!!(map && typeof map.get === 'function' && map.get(testUrl as string)));
					});
				}),
				[TEST_URL],
				{ timeout: 20_000, message: 'No thumbnail record found for the pinned URL after event-page respawn' }
			);

			expect(hasThumbnail).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'event-page-respawn-capture');
			throw e;
		} finally {
			// Best-effort cleanup so later test files don't inherit this pin —
			// the next file's resetTestState() clears it regardless.
			await page.evaluate(() => new Promise((resolve) => {
				chrome.runtime.sendMessage({ name: 'Tiles.clear' }, resolve);
			})).catch(() => { /* best-effort */ });
			await page.close();
		}
	}, 90_000);
});
