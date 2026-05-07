import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo-relative paths derived from the location of this file. Anchoring on
// import.meta.url keeps the tests portable across machines and CI runners.
export const PROFILE_DIR = process.env.NTT_E2E_PROFILE_DIR || path.resolve(__dirname, 'test-profile');
export const ARTIFACTS_DIR = path.resolve(__dirname, '_artifacts');
export const BIDI_ENDPOINT = 'ws://127.0.0.1:9222/session';

// Single source of truth for the extension ID: read it from the manifest at
// test time. When the AMO publication path is decided (see ROADMAP.md) and the
// fork picks a new ID, no test code needs to change.
const MANIFEST_PATH = path.resolve(__dirname, '../../webextension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
export const EXTENSION_ID = manifest.applications.gecko.id;

const verboseEnabled = !!process.env.E2E_VERBOSE;
function verbose(...args) {
	if (verboseEnabled) {
		console.log(...args);
	}
}

/**
 * Connect to the running Firefox ESR instance via WebDriver BiDi.
 */
export async function connectToFirefox() {
	return puppeteer.connect({
		browserWSEndpoint: BIDI_ENDPOINT,
		protocol: 'webDriverBiDi',
	});
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
export async function getExtensionUUID() {
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
			const uuids = JSON.parse(jsonStr);
			const uuid = uuids[EXTENSION_ID];
			if (uuid) {
				return uuid;
			}
		} catch (e) {
			console.error(`[UUID Discovery] Failed to parse JSON: ${e.message}`);
		}
	}

	throw new Error(`Extension UUID for ${EXTENSION_ID} not found in prefs.js. Is the extension installed?`);
}

/**
 * Get the full URL to the extension's new tab page.
 */
export async function getNewTabURL() {
	const uuid = await getExtensionUUID();
	return `moz-extension://${uuid}/newTab.xhtml`;
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
export async function waitForCondition(page, predicate, args = [], opts = {}) {
	const { timeout = 10_000, interval = 200, message } = opts;
	const deadline = Date.now() + timeout;
	let lastValue;
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
 * Save a screenshot of `page` for debugging into the artifacts directory.
 * Filename is sanitised; directory is created on demand.
 */
export async function captureFailure(page, label) {
	const safeLabel = String(label).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
	fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
	const target = path.join(ARTIFACTS_DIR, `${safeLabel}.png`);
	try {
		await page.screenshot({ path: target });
		console.error(`[E2E] Failure screenshot saved to ${target}`);
	} catch (ssErr) {
		console.error(`[E2E] Could not save failure screenshot: ${ssErr.message}`);
	}
	return target;
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
export async function openNewTab(browser, opts = {}) {
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
		verbose(`[Navigation] Initial goto warning (ignoring): ${e.message}`);
	});

	return page;
}

/**
 * Clear all pinned tiles AND reset prefs to defaults in a single page
 * open/close cycle. This avoids the rapid open/close/open pattern that
 * destabilises the BiDi connection. Call in `beforeAll` after
 * `connectToFirefox()`.
 */
export async function clearPinnedTiles(browser) {
	const page = await openNewTab(browser);
	await waitForGridReady(page);
	try {
		await page.evaluate(async () => {
			const tiles = await Tiles.getAllTiles();
			for (const tile of tiles) {
				if (tile && tile.url) {
					await Tiles.removeTile(tile);
				}
			}
		});
	} finally {
		await page.close();
	}
}

/**
 * Reset extension prefs to defaults so no test inherits surprising state from
 * a prior test file. Call in `beforeAll` after `connectToFirefox()`.
 *
 * Prefer `resetTestState(browser)` instead — it combines tile clearing and
 * pref reset in a single page open/close cycle.
 */
export async function resetPrefs(browser) {
	const page = await openNewTab(browser);
	await waitForGridReady(page);
	try {
		await page.evaluate(() => {
			Prefs.rows = 3;
			Prefs.columns = 3;
			Prefs.locked = false;
			Prefs.theme = 'light';
			Prefs.themeAuto = false;
			Prefs.opacity = 80;
			Prefs.titleSize = 'small';
			Prefs.spacing = 'small';
			Prefs.margin = ['small', 'small', 'small', 'small'];
			Prefs.history = true;
			Prefs.recent = true;
		});
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
export async function resetTestState(browser) {
	const url = await getNewTabURL();
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 3_000 }).catch(() => {});

	// Wait for extension runtime (scripts loaded), not full Grid init.
	await waitForCondition(
		page,
		() => typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function',
		[],
		{ timeout: 15_000, message: 'Extension runtime not available' }
	);

	try {
		// Clear all tiles via single IDB objectStore.clear().
		await page.evaluate(() => new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.clear' }, resolve);
		}));

		// Reset all prefs in one write + read-back fence.
		await page.evaluate(() => new Promise(resolve => {
			chrome.storage.local.set({
				rows: 3, columns: 3, locked: false,
				theme: 'light', themeAuto: false, opacity: 80,
				titleSize: 'small', spacing: 'small',
				margin: ['small', 'small', 'small', 'small'],
				history: true, recent: true,
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
 * Polls `Grid.ready` (which checks `!!Grid._node`) instead of looking for
 * `#newtab-scrollbox`, which is in the static XHTML and exists before any
 * JavaScript executes. Uses `waitForCondition` because the extension's CSP
 * blocks `page.waitForFunction` (it relies on `Function()` constructor).
 */
export async function waitForGridReady(page, timeout = 15_000) {
	verbose('[Navigation] Waiting for Grid.ready...');
	try {
		await waitForCondition(
			page,
			() => typeof Grid !== 'undefined' && Grid.ready,
			[],
			{ timeout, message: 'Grid not ready (Grid.init has not run)' }
		);
		verbose('[Navigation] Grid ready!');
	} catch (e) {
		console.error(`[Navigation] Readiness check failed: ${e.message}`);
		await captureFailure(page, 'grid-not-ready');
		throw e;
	}
}
