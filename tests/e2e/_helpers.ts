import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CHROME_DEV_EXTENSION_ID } from '../e2e-chrome/_tools/chrome-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo-relative paths derived from the location of this file. Anchoring on
// import.meta.url keeps the tests portable across machines and CI runners.
export const PROFILE_DIR = process.env.NTT_E2E_PROFILE_DIR || path.resolve(__dirname, 'test-profile');

/**
 * Browser seam (CHROME.md D5b): `NTT_E2E_BROWSER=chrome` (set by
 * `tests/e2e-chrome/run_chrome_tests.sh`) switches the SAME 32 test files
 * from Firefox/BiDi to Chrome/CDP. Firefox stays the default so every
 * existing invocation (`pnpm test:e2e`, a bare `vitest --project e2e`) is
 * byte-identical to before this seam existed.
 */
export const IS_CHROME = process.env.NTT_E2E_BROWSER === 'chrome';

// Per-browser artifacts dir so the Firefox and Chrome E2E suites (the same
// test files under different browsers) can run concurrently without racing on
// shared fixtures/screenshots: `_artifacts-ff` (Firefox) vs `_artifacts-cft`
// (Chrome for Testing). Each run script wipes only its own dir — see
// run_esr_tests.sh / run_chrome_tests.sh.
export const ARTIFACTS_DIR = path.resolve(__dirname, IS_CHROME ? '_artifacts-cft' : '_artifacts-ff');
export const BIDI_ENDPOINT = 'ws://127.0.0.1:9222/session';

// Chrome for Testing's CDP debugging port (tests/e2e-chrome/README.md's port
// table — 9223 is the reserved fixed-port slot for this tier, distinct from
// Firefox E2E's 9222 and both UAT daemons' 9876/9877 so all tiers can run
// concurrently per CONTRIBUTING.md's parallel-tier practice).
export const CDP_ENDPOINT = 'http://127.0.0.1:9223';

// Single source of truth for the extension ID: read it from the manifest at
// test time. When the AMO publication path is decided (see ROADMAP.md) and the
// fork picks a new ID, no test code needs to change.
const MANIFEST_PATH = path.resolve(__dirname, '../../webextension/manifest.json');
// eslint-disable-next-line ntt/no-source-grep -- loading manifest for extension ID
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
export const EXTENSION_ID: string = manifest.browser_specific_settings.gecko.id;

const verboseEnabled = !!process.env.E2E_VERBOSE;
function verbose(...args: unknown[]) {
	if (verboseEnabled) {
		console.log(...args);
	}
}

/**
 * Connect to the running browser instance — Firefox via WebDriver BiDi
 * (default), or Chrome for Testing via CDP when `NTT_E2E_BROWSER=chrome`
 * (CHROME.md D5b). The name stays `connectToFirefox` even though it's now
 * browser-generic: all 32 E2E test files already import it, and keeping the
 * name means zero call-site churn (and zero risk of a paste-o) across a suite
 * this program's own gate proves must stay byte-identical on Firefox.
 *
 * Retries a bounded number of times: the session handshake can lose a race
 * with the launching browser's startup on slow/loaded CI runners even after
 * the port is reachable (see audit/2026-05-11 §4.3, observed on the BiDi
 * path; the same race is possible on CDP so the retry applies uniformly).
 * Each E2E file's `beforeAll` calls this, so a transient first-attempt
 * failure would otherwise fail a whole file. Retrying the connect is safe —
 * it does not retry test assertions.
 */
export async function connectToFirefox(attempts = 5, delayMs = 1000): Promise<Browser> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return IS_CHROME
				? await puppeteer.connect({
					browserURL: CDP_ENDPOINT,
					defaultViewport: null,
				})
				: await puppeteer.connect({
					browserWSEndpoint: BIDI_ENDPOINT,
					protocol: 'webDriverBiDi',
				});
		} catch (err) {
			lastErr = err;
			verbose(`[connect] attempt ${attempt}/${attempts} failed: ${(err as Error).message}`);
			if (attempt < attempts) {
				await new Promise(r => setTimeout(r, delayMs));
			}
		}
	}
	throw new Error(`connectToFirefox: failed after ${attempts} attempts — ${(lastErr as Error)?.message}`);
}

/**
 * Discover the extension's internal UUID by reading the Firefox profile's prefs.js.
 *
 * NOTE: This is brittle by design. WebExtensions have no public API for an
 * extension to learn its own moz-extension://<uuid>/ origin from outside.
 * We work around that by reading the profile's prefs.js, which Firefox writes
 * but does not commit to as a stable interface. The pref-file escape format,
 * the JSON encoding inside the value, and the timing of when the pref is
 * written all depend on Firefox internals.
 *
 * Symptoms of breakage on a Firefox upgrade:
 *   - "prefs.js not found or does not contain UUIDs" — the pref name changed,
 *     or extensions.webextensions.uuids is no longer present.
 *   - JSON.parse failure on the inner string — the escape format changed.
 *   - UUID lookup miss for EXTENSION_ID — the UUID key shape changed.
 *
 * Recovery: launch web-ext run interactively (drop -headless), inspect the
 * prefs.js file under PROFILE_DIR for the new format, and update the regex.
 */
export async function getExtensionUUID(): Promise<string> {
	const prefsPath = path.join(PROFILE_DIR, 'prefs.js');
	verbose(`[UUID Discovery] Searching for prefs.js in ${PROFILE_DIR}`);

	let content = '';
	for (let i = 0; i < 30; i++) {
		if (fs.existsSync(prefsPath)) {
			content = fs.readFileSync(prefsPath, 'utf8');
			if (content.includes('extensions.webextensions.uuids')) {
				break;
			}
		}
		await new Promise((r) => setTimeout(r, 1000));
	}

	if (!content) {
		throw new Error(`prefs.js not found or does not contain UUIDs at ${prefsPath}`);
	}

	const match = content.match(/user_pref\("extensions\.webextensions\.uuids",\s*"({.*?})"\)/);
	if (match) {
		const jsonStr = match[1].replace(/\\"/g, '"');
		try {
			const uuids: Record<string, string> = JSON.parse(jsonStr);
			const uuid = uuids[EXTENSION_ID];
			if (uuid) {
				return uuid;
			}
		} catch (e) {
			console.error(`[UUID Discovery] Failed to parse JSON: ${(e as Error).message}`);
		}
	}

	throw new Error(`Extension UUID for ${EXTENSION_ID} not found in prefs.js. Is the extension installed?`);
}

/**
 * Build the full extension-origin URL to the new tab page for a given id
 * (audit 2026-07-09-modernization-h-code-review.md #7b — the sibling of
 * tests/uat/_tools/urls.mjs's `newTabURL`, kept local here since this file
 * already anchors the E2E harness's own path constants). `browser` selects
 * the origin scheme: Firefox's per-profile `moz-extension://<uuid>/`, or
 * Chrome's deterministic `chrome-extension://<id>/` (CHROME.md D5b) — same
 * two-scheme shape as the UAT tooling's `newTabURL`.
 */
export function newTabURL(id: string, browser: 'firefox' | 'chrome' = 'firefox'): string {
	return browser === 'chrome' ? `chrome-extension://${id}/newTab.html` : `moz-extension://${id}/newTab.html`;
}

/**
 * Get the full URL to the extension's new tab page for whichever browser
 * this run targets. Chrome's id is the committed dev-key id (deterministic,
 * no profile scrape needed — `stageDevBuild()` injects the same key on every
 * run); Firefox's UUID is per-profile and must be discovered via
 * `getExtensionUUID()`'s prefs.js scrape.
 */
export async function getNewTabURL(): Promise<string> {
	if (IS_CHROME) {
		return newTabURL(CHROME_DEV_EXTENSION_ID, 'chrome');
	}
	const uuid = await getExtensionUUID();
	return newTabURL(uuid, 'firefox');
}

export interface WaitForConditionOpts {
	timeout?: number;
	interval?: number;
	message?: string;
}

/**
 * Poll a predicate against the page until it returns truthy or the timeout
 * elapses. Use this instead of `page.waitForFunction` on `moz-extension://`
 * pages — Puppeteer's `waitForFunction` builds a polling routine via the
 * `Function()` constructor, which the extension's strict CSP blocks.
 *
 * `predicate` runs in the page; `args` are passed to it (must be JSON-
 * serialisable). Returns the predicate's resolved value.
 */
export async function waitForCondition(
	page: Page,
	predicate: (...args: unknown[]) => unknown,
	args: unknown[] = [],
	opts: WaitForConditionOpts = {},
): Promise<unknown> {
	const { timeout = 10_000, interval = 200, message } = opts;
	const deadline = Date.now() + timeout;
	let lastValue: unknown;
	while (Date.now() < deadline) {
		lastValue = await page.evaluate(predicate, ...args);
		if (lastValue) {
			return lastValue;
		}
		await new Promise(r => setTimeout(r, interval));
	}
	throw new Error(message || `waitForCondition timed out after ${timeout}ms`);
}

/**
 * Navigate to `url` and confirm the navigation committed — without trusting
 * Puppeteer's goto event-wait.
 *
 * Puppeteer-BiDi subscribes to the navigation `load`/`domcontentloaded`
 * event *at goto time*. A fast page (e.g. example.com) can fire that event
 * before the subscription lands, so `goto({ waitUntil: 'load' })` hangs
 * until timeout even though Firefox loaded the page fine. This manifested as
 * an intermittent `Navigation timeout` that hit a different seed-page
 * navigation each full-suite run.
 *
 * The fix: fire the navigation, ignore the (racy) event-wait outcome, then
 * confirm via `page.url()` — frame-URL tracking is subscribed at page
 * creation, so it doesn't race the navigation. Same catch-and-verify shape
 * `openNewTab` already uses for `moz-extension://` pages.
 */
export async function navigateAndConfirm(
	page: Page,
	url: string,
	opts: WaitForConditionOpts = {},
): Promise<void> {
	const { timeout = 30_000, interval = 200 } = opts;
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => { /* race tolerated; verified below */ });
	const target = url.replace(/\/+$/, '');
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		let current = '';
		try { current = page.url(); } catch { /* transient during navigation */ }
		if (current.replace(/\/+$/, '') === target) {
			return;
		}
		await new Promise(r => setTimeout(r, interval));
	}
	throw new Error(`navigateAndConfirm: page never committed to ${url} (last: ${page.url()})`);
}

/**
 * Save a screenshot of `page` for debugging into the artifacts directory.
 * Filename is sanitised; directory is created on demand.
 */
export async function captureFailure(page: Page, label: string): Promise<string> {
	const safeLabel = String(label).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
	fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
	const target = path.join(ARTIFACTS_DIR, `${safeLabel}.png`);
	try {
		await page.screenshot({ path: target });
		console.error(`[E2E] Failure screenshot saved to ${target}`);
	} catch (ssErr) {
		console.error(`[E2E] Could not save failure screenshot: ${(ssErr as Error).message}`);
	}
	return target;
}

export interface OpenNewTabOpts {
	beforeNavigate?: (page: Page) => void | Promise<void>;
}

/**
 * Open the extension's new tab page in a new browser page.
 *
 * Options:
 *   beforeNavigate(page) — invoked AFTER browser.newPage() but BEFORE goto().
 *     Use this to attach console listeners or other hooks that must observe
 *     events from the page's first load.
 *
 * Returns the Puppeteer Page object. Use waitForGridReady(page) afterwards
 * to ensure the UI has finished initialising.
 */
export async function openNewTab(browser: Browser, opts: OpenNewTabOpts = {}): Promise<Page> {
	const url = await getNewTabURL();
	const page = await browser.newPage();

	if (opts.beforeNavigate) {
		await opts.beforeNavigate(page);
	}

	verbose(`[Navigation] Navigating to ${url}`);

	// The initial goto can race with the extension's own startup; ignore
	// the early reject and rely on a subsequent readiness check (like
	// waitForGridReady) to confirm the page is usable.
	await page.goto(url, {
		waitUntil: 'domcontentloaded',
		timeout: 3_000, // Always times out on moz-extension:// (BiDi issue); caught below.
	}).catch(e => {
		verbose(`[Navigation] Initial goto warning (ignoring): ${(e as Error).message}`);
	});

	return page;
}

/**
 * Wait until the extension runtime is available in `page` (scripts loaded),
 * without waiting for the full Grid DOM to render. Shared by the state-reset
 * helpers below, which only need `chrome.runtime`/`chrome.storage`.
 */
async function waitForExtensionRuntime(page: Page): Promise<void> {
	await waitForCondition(
		page,
		() => typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function',
		[],
		{ timeout: 15_000, message: 'Extension runtime not available' }
	);
}

/**
 * Set one or more prefs via `browser.storage.local` from page context, with a
 * read-back fence (chrome.storage serialises operations, so the `get`
 * callback fires only once the `set` has fully applied). The principled way
 * to seed/mutate pref state from E2E test code (chrome-prep C3d,
 * CHROME_PREP.md maintainer directive 1) — never write a page global. Storage
 * keys match the `Prefs` accessor names 1:1 (verified against prefs.js's
 * `parsePrefs`), so this is a drop-in replacement for the old
 * `(window as any).Prefs.<name> = value` pattern.
 */
export async function setPrefs(page: Page, prefs: Record<string, unknown>): Promise<void> {
	await page.evaluate(p => new Promise<void>(resolve => {
		chrome.storage.local.set(p, () => {
			chrome.storage.local.get(() => resolve());
		});
	}), prefs);
}

/** Read one pref's current stored value via `browser.storage.local`. */
export async function getPref(page: Page, name: string): Promise<unknown> {
	return page.evaluate(n => new Promise(resolve => {
		chrome.storage.local.get([n], (result: Record<string, unknown>) => resolve(result[n]));
	}), name);
}

/**
 * Read the per-domain filter map (`Filters.getList()`'s equivalent) directly
 * from the `filters` storage key — `Filters` (prefs.js) is a real, storage-
 * backed dual-scope singleton (`_saveList` writes this same key; `parsePrefs`
 * re-syncs `_list` from it on every storage change), so reading/writing the
 * key IS the principled equivalent of calling the page-global accessor.
 */
export async function getFilters(page: Page): Promise<Record<string, number>> {
	return page.evaluate(() => new Promise<Record<string, number>>(resolve => {
		chrome.storage.local.get(['filters'], (result: Record<string, unknown>) => resolve((result.filters as Record<string, number>) || {}));
	}));
}

/**
 * Set (or, with `limit === -1`, clear) one host's filter count — the storage
 * equivalent of `Filters.setFilter(host, limit)` (prefs.js: `-1` deletes the
 * key, otherwise it's assigned) — with a read-back fence.
 */
export async function setFilter(page: Page, host: string, limit: number): Promise<void> {
	await page.evaluate(({ host, limit }) => new Promise<void>(resolve => {
		chrome.storage.local.get(['filters'], (result: Record<string, unknown>) => {
			const filters: Record<string, number> = { ...((result.filters as Record<string, number>) || {}) };
			if (limit === -1) {
				delete filters[host];
			} else {
				filters[host] = limit;
			}
			chrome.storage.local.set({ filters }, () => {
				chrome.storage.local.get(() => resolve());
			});
		});
	}), { host, limit });
}

/**
 * Open the drawer via the real cogwheel/Edit button (`#options-toggle`),
 * clicking only if it's currently closed — `toggleDrawer` (newTab.js) would
 * otherwise close an already-open drawer.
 */
export async function openDrawerUI(page: Page): Promise<void> {
	await page.evaluate(() => {
		if (!document.documentElement.hasAttribute('drawer-open')) {
			(document.getElementById('options-toggle') as HTMLElement).click();
		}
	});
}

/** Close the drawer via the same toggle button, clicking only if it's open. */
export async function closeDrawerUI(page: Page): Promise<void> {
	await page.evaluate(() => {
		if (document.documentElement.hasAttribute('drawer-open')) {
			(document.getElementById('options-toggle') as HTMLElement).click();
		}
	});
}

/** Click the drawer tab button for `name` (`[data-drawer-tab="name"]`). */
export async function switchDrawerTabUI(page: Page, name: string): Promise<void> {
	await page.evaluate(n => {
		const tab = document.querySelector(`[data-drawer-tab="${n}"]`) as HTMLElement | null;
		if (tab) { tab.click(); }
	}, name);
}

/**
 * Predicate for `waitForCondition`: true once a `.newtab-site` whose
 * `a.newtab-link` href equals `url` exists under `#newtab-grid` — the
 * DOM-observable proof that a pinned tile has rendered, replacing the old
 * `Grid.sites.some(s => s.url === url)` page-global read. Self-contained (no
 * closures over outer scope) since Puppeteer serializes it into the page.
 */
export function siteLinkExists(url: unknown): boolean {
	return Array.from(document.querySelectorAll('#newtab-grid a.newtab-link'))
		.some(a => (a as HTMLAnchorElement).href === url);
}

/**
 * Force newTab.js's `refreshRecent` (the recently-closed-tabs titlebar row)
 * to run without ever calling the page method directly. `refreshRecent` has
 * no wire/storage trigger of its own — production reaches it via a
 * `ResizeObserver` on `#ntt-titlebar-recent`, `Prefs.onChange` for a handful
 * of keys, a `document.fonts.ready` settle, and — reliably, on every call —
 * `openDrawer`/`closeDrawer`'s own `_refreshGridPositionsAfterDrawerTransition`
 * (fires ~240ms after either transition, per newTab.js). Toggling the drawer
 * open then closed via the real cogwheel button is therefore a fully
 * DOM-driven way to force a refresh.
 */
export async function nudgeRecentRefresh(page: Page): Promise<void> {
	await openDrawerUI(page);
	await new Promise(r => setTimeout(r, 400));
	await closeDrawerUI(page);
	await new Promise(r => setTimeout(r, 400));
}

/**
 * Clear all pinned tiles via the `Tiles.clear` runtime message (single IDB
 * `objectStore.clear()` — same wire call `resetTestState` uses). Call in
 * `beforeAll` after `connectToFirefox()`.
 *
 * Prefer `resetTestState(browser)` instead — it combines this with a pref
 * reset in a single page open/close cycle.
 */
export async function clearPinnedTiles(browser: Browser): Promise<void> {
	const page = await openNewTab(browser);
	await waitForExtensionRuntime(page);
	try {
		await page.evaluate(() => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.clear' }, () => resolve());
		}));
	} finally {
		await page.close();
	}
}

/**
 * Remove one tile, identified by URL, via the wire.
 *
 * WIRE-SHAPE GOTCHA (the reason this helper exists): `Tiles.removeTile` on
 * the wire takes a tile OBJECT (`{ name: 'Tiles.removeTile', tile }` —
 * lib/messages.js dispatches `Tiles.removeTile(message.tile)`, and the store
 * deletes by `tile.id`), NOT a url. A `{ name: 'Tiles.removeTile', url }`
 * payload silently no-ops. boot-timing.test.ts's afterAll comment documents
 * the same gotcha ("`Tiles.removeTile` on the wire takes a tile *object*,
 * not a url").
 *
 * So: fetch the stored record first via the frozen `Tiles.getTile` wire name
 * (reads `message.url`, responds with the full id-bearing tile or null),
 * then send `Tiles.removeTile` with that object. Skips silently when the
 * tile doesn't exist — this helper runs in cleanup context, where "already
 * gone" is success.
 */
export async function removeTileByUrl(page: Page, url: string): Promise<void> {
	await page.evaluate(u => new Promise<void>(resolve => {
		chrome.runtime.sendMessage({ name: 'Tiles.getTile', url: u }, (tile: unknown) => {
			if (!tile) {
				resolve();
				return;
			}
			chrome.runtime.sendMessage({ name: 'Tiles.removeTile', tile }, () => resolve());
		});
	}), url);
}

/**
 * Reset extension prefs to defaults so no test inherits surprising state from
 * a prior test file. Call in `beforeAll` after `connectToFirefox()`.
 *
 * Prefer `resetTestState(browser)` instead — it combines tile clearing and
 * pref reset in a single page open/close cycle.
 */
export async function resetPrefs(browser: Browser): Promise<void> {
	const page = await openNewTab(browser);
	await waitForExtensionRuntime(page);
	try {
		// Storage keys match the Prefs accessor names 1:1 for this subset
		// (verified against prefs.js's parsePrefs) — a plain storage.local.set
		// reproduces the old per-property assignment dance. Read-back fence
		// (get after set) matches resetTestState's pattern: chrome.storage
		// serialises operations, so the get callback fires only after the set
		// has fully applied.
		await page.evaluate(() => new Promise<void>(resolve => {
			chrome.storage.local.set({
				rows: 3, columns: 3, locked: false,
				theme: 'system', opacity: 80,
				titleSize: 'small', tileAspect: 'fill', spacing: 'small',
				margin: ['small', 'small', 'small', 'small'],
				history: true, recent: true,
			}, () => {
				chrome.storage.local.get(() => resolve());
			});
		}));
	} finally {
		await page.close();
	}
}

/**
 * Combined hermetic state reset: clear all tiles AND reset prefs to defaults
 * using a single temporary page. This is the recommended helper for E2E test
 * `beforeAll` blocks.
 *
 * Performance: uses `Tiles.clear` (single IDB clear) instead of
 * `getAllTiles()` + per-tile `removeTile()`, writes all prefs in one
 * `chrome.storage.local.set` call with a read-back fence, and skips
 * `waitForGridReady` (only needs the extension runtime, not the full Grid).
 */
export async function resetTestState(browser: Browser): Promise<void> {
	const url = await getNewTabURL();
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 3_000 }).catch(() => {});

	// Wait for extension runtime (scripts loaded), not full Grid init.
	await waitForExtensionRuntime(page);

	try {
		// Clear all tiles via single IDB objectStore.clear().
		await page.evaluate(() => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.clear' }, () => resolve());
		}));

		// Reset all prefs in one write + read-back fence.
		// Also clears neverCaptureHosts so tests that exercise the never-capture
		// feature start from a known-empty list.
		await page.evaluate(() => new Promise<void>(resolve => {
			chrome.storage.local.set({
				rows: 3, columns: 3, locked: false,
				theme: 'system', opacity: 80,
				titleSize: 'small', tileAspect: 'fill', spacing: 'small',
				margin: ['small', 'small', 'small', 'small'],
				history: true, recent: true, titleBarSearch: true,
				neverCaptureHosts: [],
			}, () => {
				// Fence: chrome.storage serialises operations, so this
				// get callback fires after all pending sets complete.
				chrome.storage.local.get(() => resolve());
			});
		}));
	} finally {
		await page.close();
	}
}

/**
 * Wait for the grid UI to be ready (Grid.init() has run).
 *
 * DOM-readiness check (chrome-prep C3d — no page-global reads): polls for
 * `#newtab-grid` having at least one `.newtab-cell` child. `Grid.init()`
 * synchronously sets `#newtab-grid`'s node reference and then calls
 * `_render()`, which — when the cell count doesn't already match
 * `rows*columns` — calls `_renderGrid()` FIRST (appending all `.newtab-cell`
 * nodes synchronously) before the async `_renderSites()` populates tiles
 * (verified against grid.js's `Grid.init`/`_render`/`_renderGrid`). This
 * is the same readiness point the old `Grid.ready` (`!!Grid._node`) getter
 * captured — neither guarantees tiles have finished loading, only that the
 * grid DOM exists. `#newtab-scrollbox` isn't used instead because it's in the
 * static markup and exists before any JavaScript executes. Uses
 * `waitForCondition` because the extension's CSP blocks `page.waitForFunction`
 * (it relies on the `Function()` constructor).
 */
export async function waitForGridReady(page: Page, timeout = 15_000): Promise<void> {
	verbose('[Navigation] Waiting for grid DOM readiness...');
	try {
		await waitForCondition(
			page,
			() => {
				const grid = document.getElementById('newtab-grid');
				return !!grid && grid.querySelectorAll('.newtab-cell').length > 0;
			},
			[],
			{ timeout, message: 'Grid not ready (#newtab-grid has no .newtab-cell children)' }
		);
		verbose('[Navigation] Grid ready!');
	} catch (e) {
		console.error(`[Navigation] Readiness check failed: ${(e as Error).message}`);
		await captureFailure(page, 'grid-not-ready');
		throw e;
	}
}

/**
 * Chrome analogue of Firefox's `extensions.background.idle.timeout` respawn
 * regime (CHROME.md D5b, event-page-lifecycle.test.ts): there is no pref that
 * ages out an MV3 service worker on a bounded schedule, so the test forces
 * the same "the background just came back from nothing" condition with a
 * real CDP-level kill — the exact technique `tests/e2e-chrome/_tools/smoke.mjs`
 * proved out for D3's SW kill/respawn check.
 *
 * Two empirically-required steps beyond the kill itself (both findings from
 * that smoke work, reproduced here):
 *   1. Poll until the service_worker TARGET is actually gone before doing
 *      anything else — a wake attempt sent while it's still tearing down is
 *      dropped, not buffered.
 *   2. Wake it with a REAL navigation (a content page load), not a page-side
 *      `runtime.sendMessage` — the latter did not reliably wake a worker
 *      killed this way, even though the identical call works from idle.
 *      `webNavigation.onCompleted` is a listener the worker registers at
 *      top level, so Chrome must resurrect it to deliver that event.
 *
 * Chrome-only: puppeteer's Target API needs a real CDP `service_worker`
 * target type, which Firefox's BiDi-connected `Browser` never produces (its
 * event page isn't modeled as a Target at all) — callers must gate this
 * behind `IS_CHROME`.
 */
export async function restartChromeServiceWorker(browser: Browser, opts: { timeout?: number } = {}): Promise<void> {
	const { timeout = 20_000 } = opts;

	const client = await browser.target().createCDPSession();
	const { targetInfos } = await client.send('Target.getTargets');
	const sw = targetInfos.find((t: { type: string }) => t.type === 'service_worker');
	if (!sw) {
		throw new Error('restartChromeServiceWorker: no service_worker target found to kill');
	}
	await client.send('Target.closeTarget', { targetId: sw.targetId });

	const goneDeadline = Date.now() + timeout;
	while (Date.now() < goneDeadline) {
		if (!browser.targets().some(t => t.type() === 'service_worker')) {
			break;
		}
		await new Promise(r => setTimeout(r, 250));
	}

	const wakePage = await browser.newPage();
	try {
		await wakePage.goto('https://example.com/', { waitUntil: 'load', timeout: 15_000 });
	} finally {
		await wakePage.close().catch(() => {});
	}

	const respawned = await browser.waitForTarget(
		t => t.type() === 'service_worker',
		{ timeout },
	).catch(() => null);
	if (!respawned) {
		throw new Error(`restartChromeServiceWorker: no service_worker target reappeared within ${timeout}ms of the wake navigation`);
	}
}
