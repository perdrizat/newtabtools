#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Chrome first-boot smoke (CHROME.md D1) — `pnpm chrome:smoke`.
 *
 * Launches headless Chrome (Puppeteer/CDP) with the staged unpacked dev
 * build and reports, check by check, how far the extension gets on Chrome:
 *
 *   1. Chrome launches (binary + version)
 *   2. the MV3 service worker starts (target appears)
 *   3. chrome-extension://<id>/newTab.html loads
 *   4. the grid renders cells
 *   5. page console/pageerror inventory (informational)
 *   6. (CHROME.md D3 slice 3) capture round-trip: pin a tile, navigate a real
 *      tab to it, poll for the thumbnail to land in IDB — the first real
 *      execution of the D2 OffscreenCanvas path on genuine Chrome.
 *   7. (CHROME.md D3 slice 4) SW kill/respawn proof: terminate the service
 *      worker via CDP, wake it back up, confirm it respawns and that a
 *      storage.session value survives — the Chrome analogue of Firefox's
 *      `extensions.background.idle.timeout` respawn regime.
 *
 * A red result here is DATA, not a harness failure — D1 established this
 * smoke precisely to give the D2/D3 arcs a red/green target on real Chrome.
 * Exit code: 0 if checks 1-4 pass, 1 otherwise (checks 6-7 are best-effort:
 * they only run when the preceding boot checks succeeded, but a failure
 * there still flips the process exit code — see the `failed` computation at
 * the bottom).
 */

import puppeteer from 'puppeteer-core';
import { resolveChromeBinary, stageDevBuild, NEWTAB_PATH } from './chrome-env.mjs';

// example.com — a simple, static, always-up page (same choice as the
// Firefox E2E auto-thumbnail suite, tests/e2e/auto-thumbnail.test.ts).
const CAPTURE_TEST_URL = 'https://example.com/';
const CAPTURE_TEST_TITLE = 'Example (chrome-smoke)';

/**
 * Poll `fn` (a zero-arg function returning a value or Promise) until it
 * returns truthy or `timeoutMs` elapses. Plain Node-side polling — no
 * `page.waitForFunction` involved, so it works against extension pages
 * whose CSP blocks the `Function()` constructor that relies on (same
 * constraint documented in tests/e2e/_helpers.ts's `waitForCondition`).
 * @param {() => unknown|Promise<unknown>} fn
 * @param {{timeoutMs?: number, intervalMs?: number}} [opts]
 * @returns {Promise<unknown>} the truthy value, or `undefined` on timeout.
 */
async function pollUntil(fn, { timeoutMs = 20000, intervalMs = 500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await fn();
		if (value) { return value; }
		await new Promise(r => setTimeout(r, intervalMs));
	}
	return undefined;
}

const found = resolveChromeBinary();
if (!found) {
	console.error('[chrome-smoke] x no Chrome binary found ($CHROME_BIN or the Puppeteer cache).');
	console.error('[chrome-smoke]   Run `pnpm chrome:provision` (Chrome for Testing) or set CHROME_BIN.');
	process.exit(1);
}
if (found.branded) {
	console.error('[chrome-smoke] ~ WARNING: branded Google Chrome cannot run extension automation (>=137');
	console.error('[chrome-smoke]   removed it) — expect failure. Run `pnpm chrome:provision` for Chrome for Testing.');
}

const { dir, extensionId } = stageDevBuild();
console.log(`[chrome-smoke] chrome: ${found.version} (${found.bin})`);
console.log(`[chrome-smoke] staged: ${dir}`);
console.log(`[chrome-smoke] extension id: ${extensionId}`);

/** @type {{name: string, passed: boolean, note: string}[]} */
const checks = [];
const check = (name, passed, note = '') => {
	checks.push({ name, passed, note });
	console.log(`[chrome-smoke] ${passed ? '✓' : 'x'} ${name}${note ? ` — ${note}` : ''}`);
};

let browser = null;
try {
	// Branded Google Chrome >= 137 silently IGNORES --load-extension; the
	// supported automation route is CDP extension install (Puppeteer
	// installExtension), which requires the pipe transport +
	// --enable-unsafe-extension-debugging. The legacy
	// --load-extension/--disable-extensions-except flags are deliberately NOT
	// passed here — on branded Chrome the except-list does not recognize the
	// CDP-installed copy and blocks it.
	browser = await puppeteer.launch({
		executablePath: found.bin,
		headless: true,
		pipe: true,
		// Puppeteer injects --disable-extensions by default (only auto-dropped
		// when the legacy --disable-extensions-except flag is present) — it
		// silently inerts the CDP-installed extension: install returns an id,
		// but no SW ever starts and extension URLs answer ERR_BLOCKED_BY_CLIENT.
		ignoreDefaultArgs: ['--disable-extensions'],
		args: [
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-dev-shm-usage',
			'--enable-unsafe-extension-debugging',
		],
	});
	check('chrome launches', true, await browser.version());

	let installedId = null;
	try {
		installedId = await browser.installExtension(dir);
	} catch (e) {
		check('extension installs (CDP)', false, String(e?.message || e));
	}
	if (installedId) {
		check('extension installs (CDP)', installedId === extensionId,
			installedId === extensionId ? installedId : `id mismatch: got ${installedId}, dev-key says ${extensionId}`);
	}

	// 2. The MV3 service worker target. Give a slow cold start some room.
	let swTarget = null;
	try {
		swTarget = await browser.waitForTarget(
			t => t.type() === 'service_worker' && t.url().includes(extensionId),
			{ timeout: 20000 },
		);
	} catch { /* reported below */ }
	check('service worker starts', !!swTarget, swTarget ? swTarget.url() : 'no service_worker target within 20s');

	// SW-side console/error inventory, attached as early as possible so
	// checks 6-7 below have something to report on failure — a genuine
	// failure in the capture round-trip is exactly what D3 wants surfaced,
	// per the arc's "DEBUG IT" instruction.
	/** @type {string[]} */
	const swMessages = [];
	if (swTarget) {
		try {
			const worker = await swTarget.worker();
			if (worker) {
				worker.on('console', msg => swMessages.push(`[console.${msg.type()}] ${msg.text()}`));
				worker.on('error', err => swMessages.push(`[error] ${String(err?.message || err)}`));
			}
		} catch (e) {
			swMessages.push(`[worker-attach-failed] ${String(e?.message || e)}`);
		}
	}

	// 3 + 4. The new-tab page itself.
	const page = await browser.newPage();
	/** @type {string[]} */
	const pageErrors = [];
	page.on('pageerror', err => pageErrors.push(String(err?.message || err)));
	page.on('console', msg => {
		if (msg.type() === 'error') { pageErrors.push(msg.text()); }
	});

	let loaded = false;
	try {
		const resp = await page.goto(`chrome-extension://${extensionId}/${NEWTAB_PATH}`, { waitUntil: 'load', timeout: 20000 });
		loaded = !!resp || true; // extension-page navigations may return a null response object; reaching here without throwing is the signal
	} catch (e) {
		check('newTab.html loads', false, String(e?.message || e));
	}
	if (loaded) {
		check('newTab.html loads', true, await page.title());

		let cells = -1;
		try {
			await page.waitForFunction(
				() => document.querySelectorAll('#newtab-grid .newtab-cell').length > 0,
				{ timeout: 15000 },
			);
			cells = await page.evaluate(() => document.querySelectorAll('#newtab-grid .newtab-cell').length);
		} catch { /* reported below */ }
		check('grid renders cells', cells > 0, cells > 0 ? `${cells} cells` : 'no .newtab-cell within 15s');
	}

	// 5. Informational: what the page complained about.
	if (pageErrors.length) {
		console.log(`[chrome-smoke] ~ page errors (${pageErrors.length}):`);
		for (const e of [...new Set(pageErrors)]) { console.log(`[chrome-smoke]   - ${e}`); }
	} else {
		console.log('[chrome-smoke] ~ no page console errors');
	}

	// 6. (CHROME.md D3 slice 3) Capture round-trip: pin a tile for a real
	// URL, navigate a real (active) tab to it, and poll for the thumbnail to
	// land in IDB via the real `Thumbnails.get` wire message. This is the
	// first real execution of the D2 OffscreenCanvas path on genuine Chrome —
	// only attempted when boot got far enough to have a live SW + page.
	if (swTarget && loaded) {
		let captureTile = null;
		let capturePage = null;
		try {
			captureTile = await page.evaluate(({ title, url }) => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title, url }, resolve);
			}), { title: CAPTURE_TEST_TITLE, url: CAPTURE_TEST_URL });

			// Reload the extension page so its own `Tiles.getAllTiles` wire call
			// (unconditional — unlike lib/background-main.js's webNavigation
			// listener, which reads `Tiles.ensureReady()`'s memoized `_cache`)
			// refreshes `Tiles._cache` to include the just-pinned URL. Without
			// this, `_cache` stays whatever it was at the FIRST `ensureReady()`
			// call (empty, on a fresh profile) and the capture session below
			// never starts — same reason the Firefox E2E auto-thumbnail suite
			// (tests/e2e/auto-thumbnail.test.ts) reloads after pinning.
			await page.goto(`chrome-extension://${extensionId}/${NEWTAB_PATH}`, { waitUntil: 'load', timeout: 15000 });

			// A real, ACTIVE tab: lib/background-main.js's webNavigation.onCompleted
			// listener only starts a capture session when (a) the URL is in the
			// pinned-tile cache (just arranged above) and (b) the tab is the
			// active tab at navigation-complete time — captureTab() re-checks
			// tab.active on every A/B/C stage, so this tab must stay foregrounded
			// for the ~2s the session runs.
			capturePage = await browser.newPage();
			await capturePage.bringToFront();
			await capturePage.goto(CAPTURE_TEST_URL, { waitUntil: 'load', timeout: 15000 });

			// Poll IDB DIRECTLY from the extension page (same origin as the SW's
			// database) for the stored record — the storage-side proof,
			// independent of messaging (this is what caught the original wire
			// blindness: a 16 KB image stored while JSON messaging returned `{}`).
			// The wire itself is verified separately in the next check, now that
			// `message_serialization: structured_clone` (Chrome 148+, CHROME.md
			// Decision 10) carries Maps/Blobs. The A/B/C session's hard deadline
			// is 2s; give it real margin on a cold CI-ish runner.
			const found = await pollUntil(async () => {
				return page.evaluate(u => new Promise(resolve => {
					const req = indexedDB.open('newTabTools');
					req.onsuccess = () => {
						try {
							const get = req.result.transaction('thumbnails', 'readonly').objectStore('thumbnails').get(u);
							get.onsuccess = () => resolve(get.result && get.result.image ? get.result.image.size : 0);
							get.onerror = () => resolve(0);
						} catch { resolve(0); }
					};
					req.onerror = () => resolve(0);
				}), CAPTURE_TEST_URL);
			}, { timeoutMs: 20000, intervalMs: 1000 });

			check('capture round-trip: thumbnail lands in IDB after navigation', !!found,
				found ? `stored image blob: ${found} bytes (direct IDB read)` : 'no thumbnail within 20s');

			// 6b. The wire carries it: with structured-clone messaging
			// (manifest `message_serialization`, CHROME.md Decision 10) the
			// `Thumbnails.get` response arrives as a REAL Map with a REAL Blob —
			// the exact shapes Chrome's JSON serialization used to erase.
			if (found) {
				const wire = await page.evaluate(u => new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Thumbnails.get', urls: [u] }, resp => {
						if (!(resp instanceof Map)) { resolve({ ok: false, why: `not a Map: ${typeof resp}` }); return; }
						const blob = resp.get(u);
						if (!(blob instanceof Blob)) { resolve({ ok: false, why: `no Blob for url (got ${typeof blob})` }); return; }
						resolve({ ok: true, size: blob.size });
					});
				}), CAPTURE_TEST_URL);
				check('structured clone: Thumbnails.get returns a real Map with a Blob', !!wire.ok,
					wire.ok ? `Map + Blob, ${wire.size} bytes over the wire` : wire.why);

				// 6c. The tile RENDERS it: reload the extension page and require
				// the pinned tile's thumbnail node to pick up a background image —
				// the full user-visible path (D5's "tile renders it").
				await page.goto(`chrome-extension://${extensionId}/${NEWTAB_PATH}`, { waitUntil: 'load', timeout: 15000 });
				const rendered = await pollUntil(async () => {
					return page.evaluate(u => {
						const sites = document.querySelectorAll('#newtab-grid .newtab-site');
						for (const s of sites) {
							const link = s.querySelector('a.newtab-link');
							if (link && link.href === u) {
								const thumb = s.querySelector('.newtab-thumbnail');
								if (thumb && getComputedStyle(thumb).backgroundImage.includes('url')) { return true; }
							}
						}
						return false;
					}, CAPTURE_TEST_URL);
				}, { timeoutMs: 15000, intervalMs: 500 });
				check('tile renders the stored thumbnail', !!rendered,
					rendered ? 'background-image set on the pinned tile' : 'no background-image within 15s');
			}
			if (!found) {
				console.log(`[chrome-smoke] ~ pinTile response: ${JSON.stringify(captureTile)}`);
				if (swMessages.length) {
					console.log(`[chrome-smoke] ~ SW messages (${swMessages.length}):`);
					for (const m of swMessages) { console.log(`[chrome-smoke]   - ${m}`); }
				} else {
					console.log('[chrome-smoke] ~ no SW console/error messages captured');
				}
			}
		} catch (e) {
			check('capture round-trip: thumbnail lands in IDB after navigation', false, String(e?.message || e));
			if (swMessages.length) {
				console.log(`[chrome-smoke] ~ SW messages (${swMessages.length}):`);
				for (const m of swMessages) { console.log(`[chrome-smoke]   - ${m}`); }
			}
		} finally {
			if (capturePage) { await capturePage.close().catch(() => {}); }
		}
	}

	// 6b. (CHROME.md D5) Backup export over the wire: `Export:backup` must
	// return a decodable base64 zip payload (the D2 page-side download design;
	// the actual downloads-API grant is a user gesture we can't automate
	// headlessly, so the wire payload IS the testable seam).
	if (swTarget && loaded) {
		try {
			const backup = await page.evaluate(() => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Export:backup' }, resp => {
					if (!resp || typeof resp.data !== 'string') { resolve({ ok: false, why: `bad payload: ${JSON.stringify(resp)?.slice(0, 120)}` }); return; }
					try {
						const bytes = atob(resp.data);
						// A zip starts with PK\x03\x04.
						const isZip = bytes.charCodeAt(0) === 0x50 && bytes.charCodeAt(1) === 0x4b;
						resolve({ ok: isZip && !!resp.filename, size: bytes.length, filename: resp.filename });
					} catch (e) { resolve({ ok: false, why: `base64 decode failed: ${e}` }); }
				});
			}));
			check('backup export: Export:backup returns a decodable zip payload', !!backup.ok,
				backup.ok ? `${backup.filename}, ${backup.size} bytes` : backup.why || 'no payload');
		} catch (e) {
			check('backup export: Export:backup returns a decodable zip payload', false, String(e?.message || e));
		}
	}

	// 7. (CHROME.md D3 slice 4) SW kill/respawn proof: terminate the service
	// worker via CDP mid-idle, wake it back up with a real wire message, and
	// confirm (a) the SW target reappears and (b) a storage.session value
	// written before the kill survives — the Chrome analogue of Firefox's
	// `extensions.background.idle.timeout=10000` respawn regime.
	if (swTarget && loaded) {
		const marker = `chrome-smoke-${Date.now()}`;
		try {
			await page.evaluate(m => chrome.storage.session.set({ __smokeRespawnMarker: m }), marker);

			// Terminate the SW via Target.closeTarget on its targetId — the
			// experimentally-confirmed route on CfT 151 (probed 2026-07-16, D3):
			// `ServiceWorker.enable` isn't available on the browser-level CDP
			// session at all, and a page-session `ServiceWorker.stopAllWorkers`
			// accepts the call but leaves the worker running. Target.closeTarget
			// actually kills it (SW target disappears from browser.targets()).
			const client = await browser.target().createCDPSession();
			const { targetInfos } = await client.send('Target.getTargets');
			const swInfo = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extensionId));
			if (!swInfo) { throw new Error('SW target not found for kill'); }
			await client.send('Target.closeTarget', { targetId: swInfo.targetId });
			// Wait until the SW target is really GONE before waking it — a wake
			// message sent while the worker is still tearing down gets dropped,
			// not buffered (observed as a wake timeout with a fixed 500ms sleep).
			await pollUntil(
				() => !browser.targets().some(t => t.type() === 'service_worker' && t.url().includes(extensionId)),
				{ timeoutMs: 5000, intervalMs: 250 },
			);

			// Wake it with a BROWSER EVENT, not a page message: after a
			// Target.closeTarget kill, a page-side runtime.sendMessage never
			// woke the worker (timed out on 3 attempts, twice — even though the
			// same call works from idle). A real navigation fires
			// webNavigation.onCompleted, a listener the SW registered at top
			// level, so Chrome must resurrect the worker to deliver it — the
			// same wake class Firefox's event-page E2E regime relies on.
			const wakePage = await browser.newPage();
			try {
				await wakePage.goto('https://example.com/', { waitUntil: 'load', timeout: 15000 });
			} finally {
				await wakePage.close().catch(() => {});
			}

			const respawned = await browser.waitForTarget(
				t => t.type() === 'service_worker' && t.url().includes(extensionId),
				{ timeout: 15000 },
			).catch(() => null);
			check('SW respawn: service worker target reappears after CDP kill', !!respawned,
				respawned ? respawned.url() : 'no service_worker target within 15s of the wake message');

			const survived = await page.evaluate(async m => {
				const result = await chrome.storage.session.get('__smokeRespawnMarker');
				return result.__smokeRespawnMarker === m;
			}, marker);
			check('SW respawn: storage.session value survives the kill', !!survived,
				survived ? 'marker read back intact' : 'marker missing or mismatched after respawn');
		} catch (e) {
			check('SW respawn: service worker target reappears after CDP kill', false, String(e?.message || e));
		}
	}
} finally {
	if (browser) { await browser.close(); }
}

const failed = checks.filter(c => !c.passed);
console.log(`[chrome-smoke] ${failed.length === 0 ? 'GREEN' : 'RED'} — ${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
