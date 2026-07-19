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
 *      execution of the D2 OffscreenCanvas path on genuine Chrome. Then
 *      (6b/6c, CHROME.md Decision 11) the wire-codec proofs — Thumbnails.get
 *      and Export:backup raw wires are tagged JSON, decodeFromWire yields the
 *      real Map/Blob — and (6d, D8 finding 4) the Theme.colorScheme relay is
 *      driven for both schemes so a failing action.setIcon lands in the SW
 *      console inventory.
 *   7. (CHROME.md D3 slice 4 / audit 2026-07-16 M2) storage.session durability
 *      across a SW kill attempt (the `pendingCaptures` guarantee). The SW
 *      kill/respawn itself is NOT reliably testable under CfT CDP automation —
 *      a debugger attach defeats the kill and a clean kill does not respawn —
 *      so it is reported as an informational note, never a vacuous pass/fail;
 *      real respawn coverage is the shared-code Firefox event-page-lifecycle
 *      suite (GH #23). See the block comment at the check for the full probe.
 *   8. (CHROME.md D8) SW console errors GATE the run — an error the service
 *      worker logs anywhere in the smoke fails it (the D4 setIcon 404 sat in
 *      this inventory ungated while every tier stayed green).
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
	// Branded stable Chrome WORKS here (D1 amendment, probe-proven 2026-07-18):
	// this smoke already uses the pipe transport + CDP installExtension +
	// --enable-unsafe-extension-debugging, the one automation route branded
	// Chrome still supports. Running the smoke on branded (CHROME_BIN=
	// /usr/bin/google-chrome) is the PRODUCTION-binary lane (Decision 12) —
	// CI runs it on the runner's preinstalled Chrome.
	console.log('[chrome-smoke] ~ branded Google Chrome: production-binary lane (pipe + CDP install — supported since the D1 amendment)');
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
		// page.title() can throw "execution context was destroyed" on a
		// transient navigation race — read it defensively so a flake can't crash
		// the whole smoke run instead of failing a single check (audit m9).
		let title = '(title unavailable)';
		try { title = await page.title(); } catch { /* navigation race — title is cosmetic here */ }
		check('newTab.html loads', true, title);

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
			// The wire itself is verified separately in the next check via the
			// JSON-safe wire codec (CHROME.md Decision 11 — structured-clone
			// messaging turned out canary-gated in branded Chrome and is no
			// longer load-bearing). The A/B/C session's hard deadline
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

			// 6b. The wire carries it: under the JSON-safe wire codec (CHROME.md
			// Decision 11) the RAW `Thumbnails.get` response is the tagged JSON
			// encoding (`{__ntt_map: [[url, {__ntt_blob: …}], …]}` — the only
			// shape that survives stable Chrome's JSON message serialization),
			// and the extension's own `decodeFromWire` (the page-side api.js
			// seam applies it transparently) reconstructs the real Map + Blob.
			// Assert BOTH halves — this raw-wire shape is exactly what broke
			// silently on branded stable while structured clone false-greened
			// on CfT (the canary-gate incident, D8 finding 1).
			if (found) {
				const wire = await page.evaluate(u => new Promise(resolve => {
					chrome.runtime.sendMessage({ name: 'Thumbnails.get', urls: [u] }, async resp => {
						try {
							if (!resp || !Array.isArray(resp.__ntt_map)) { resolve({ ok: false, why: `raw wire not tagged JSON: ${JSON.stringify(resp)?.slice(0, 120)}` }); return; }
							const { decodeFromWire } = await import('/wire-codec.js');
							const decoded = decodeFromWire(resp);
							if (!(decoded instanceof Map)) { resolve({ ok: false, why: `decode not a Map: ${typeof decoded}` }); return; }
							const blob = decoded.get(u);
							if (!(blob instanceof Blob)) { resolve({ ok: false, why: `no Blob for url (got ${typeof blob})` }); return; }
							resolve({ ok: true, size: blob.size });
						} catch (e) { resolve({ ok: false, why: String(e) }); }
					});
				}), CAPTURE_TEST_URL);
				check('wire codec: Thumbnails.get raw wire is tagged JSON; decodeFromWire yields Map + Blob', !!wire.ok,
					wire.ok ? `tagged JSON + decoded Map/Blob, ${wire.size} bytes over the wire` : wire.why);

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

	// 6c. (CHROME.md D5 / audit m3 / Decision 11) Backup export over the wire:
	// `Export:backup` returns `{data, filename}` where the RAW `data` is the
	// codec's tagged base64 Blob encoding (structured clone is canary-gated in
	// branded Chrome — a raw Blob would arrive as `{}` on stable), and
	// `decodeFromWire` reconstructs a real zip Blob (PK magic). The actual
	// downloads-API grant is a user gesture we can't automate headlessly, so
	// the wire payload is the testable seam.
	if (swTarget && loaded) {
		try {
			const backup = await page.evaluate(() => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Export:backup' }, async resp => {
					if (!resp || !resp.data || typeof resp.data.__ntt_blob !== 'string') { resolve({ ok: false, why: `raw wire not tagged JSON: ${JSON.stringify(resp)?.slice(0, 120)}` }); return; }
					try {
						const { decodeFromWire } = await import('/wire-codec.js');
						const decoded = decodeFromWire(resp);
						if (!(decoded.data instanceof Blob)) { resolve({ ok: false, why: `decode not a Blob: ${typeof decoded.data}` }); return; }
						const bytes = new Uint8Array(await decoded.data.arrayBuffer());
						// A zip starts with PK\x03\x04.
						const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
						resolve({ ok: isZip && !!decoded.filename, size: bytes.length, filename: decoded.filename });
					} catch (e) { resolve({ ok: false, why: `decode/read failed: ${e}` }); }
				});
			}));
			check('backup export: Export:backup zip Blob survives the wire via the codec', !!backup.ok,
				backup.ok ? `${backup.filename}, ${backup.size} bytes` : backup.why || 'no payload');
		} catch (e) {
			check('backup export: Export:backup zip Blob survives the wire via the codec', false, String(e?.message || e));
		}
	}

	// 6d. (CHROME.md D8 finding 4) Action-icon sync: drive the
	// `Theme.colorScheme` relay for BOTH schemes. The SW-side
	// `syncActionIconWithTheme` must resolve its `action.setIcon` call — a
	// relative icon path resolves against the SW's own `/lib/` URL, 404s, and
	// lands "Failed to set icon" in the SW console, which the SW-error gate
	// (final check) now FAILS on. This is the exact bug that shipped broken on
	// every Chrome since D4 because the smoke collected SW errors but never
	// gated on them.
	if (swTarget && loaded) {
		await page.evaluate(() => new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Theme.colorScheme', dark: true }, () => {
				void chrome.runtime.lastError; // fire-and-forget wire — no response by design
				chrome.runtime.sendMessage({ name: 'Theme.colorScheme', dark: false }, () => {
					void chrome.runtime.lastError;
					// Give the SW's setIcon promise a beat to reject (or not)
					// before the error gate reads the console inventory.
					setTimeout(resolve, 500);
				});
			});
		}));
		console.log('[chrome-smoke] ~ drove Theme.colorScheme relay (dark + light) — setIcon outcome gated by the SW-error check below');
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

			// SW kill/respawn is NOT reliably testable in this smoke and is
			// reported informationally, never as a pass/fail check (audit
			// 2026-07-16 M2, probed 2026-07-17):
			//   - This smoke attaches a CDP debugger to the worker (for console
			//     capture, above); an attached inspector keeps the SW alive, so
			//     `Target.closeTarget` is defeated and the target persists.
			//   - Even from a clean kill (no debugger attached), the worker does
			//     NOT respawn on any wake — navigation, extension-page load, or
			//     runtime message — and Chrome exposes no controllable
			//     idle-suspension analogue to Firefox's
			//     `extensions.background.idle.timeout`, so the natural
			//     suspend/respawn cycle can't be induced here either.
			// A "a service_worker target still exists after the kill" assertion
			// would therefore be a vacuous pass. Real respawn hygiene is covered
			// by the shared-code Firefox event-page-lifecycle suite + the
			// integration resilience tests; restoring a genuine Chrome check is
			// tracked in GH #23.
			const client = await browser.target().createCDPSession();
			const { targetInfos } = await client.send('Target.getTargets');
			const swInfo = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extensionId));
			if (swInfo) {
				await client.send('Target.closeTarget', { targetId: swInfo.targetId }).catch(() => {});
			}
			console.log('[chrome-smoke] ~ SW kill/respawn: not reliably testable under CfT CDP automation (debugger-attach defeats the kill; a clean kill does not respawn) — real coverage is the shared-code Firefox event-page-lifecycle suite (GH #23)');

			// What IS verifiable and meaningful: storage.session durability — a
			// value written before the kill attempt is still readable after it.
			// That is exactly the property `pendingCaptures` relies on.
			const survived = await page.evaluate(async m => {
				const result = await chrome.storage.session.get('__smokeRespawnMarker');
				return result.__smokeRespawnMarker === m;
			}, marker);
			check('storage.session value survives across a SW kill attempt (pendingCaptures durability)', !!survived,
				survived ? 'marker read back intact' : 'marker missing after the kill attempt');
		} catch (e) {
			check('storage.session value survives across a SW kill attempt (pendingCaptures durability)', false, String(e?.message || e));
		}
	}
	// 8. (CHROME.md D8 test-fidelity remediation, coverage class) SW console
	// errors GATE the smoke instead of being printed informationally: the D4
	// setIcon 404 sat visible-but-ungated in this inventory for a month while
	// every tier stayed green. `[worker-attach-failed]` is deliberately not an
	// error (attach is best-effort); everything the SW itself logged as an
	// error fails the run.
	{
		const swErrors = swMessages.filter(m => m.startsWith('[console.error]') || m.startsWith('[error]'));
		check('no service-worker console errors across the whole run', swErrors.length === 0,
			swErrors.length ? swErrors.slice(0, 3).join(' | ') : `${swMessages.length} SW console message(s), none errors`);
	}
} finally {
	if (browser) { await browser.close(); }
}

const failed = checks.filter(c => !c.passed);
console.log(`[chrome-smoke] ${failed.length === 0 ? 'GREEN' : 'RED'} — ${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
