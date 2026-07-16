#!/usr/bin/env node
// Standalone smoke for browser-daemon.mjs — the long-lived browser host that
// holds ONE Selenium session (Firefox or Chrome, per $UAT_BROWSER) for a whole
// UAT run and exposes it over a localhost HTTP API (port 9876 Firefox / 9877
// Chrome by default; $UAT_DAEMON_PORT overrides either).
//
// This is the daemon's behavioural contract test: spawn it, wait for /health,
// drive each endpoint once, then SIGTERM it. It is independent of the MCP and
// agent layers (mcp-smoke.mjs covers those, daemon-backed).
//
//   pnpm build
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/daemon-smoke.mjs
//   UAT_BROWSER=chrome node tests/uat/_tools/daemon-smoke.mjs
//
// Slow internet note: the daemon seeds a merged URL set into history (two
// navigation passes) + a recently-closed row, all BEFORE installing the
// extension (Firefox) / before pinning anything (Chrome — the extension is
// already loaded via --load-extension, see browser-daemon.mjs's module header),
// so /health only goes green after that — a while on a cold link.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newTabURL } from './urls.mjs';
import { CHROME_DEV_EXTENSION_ID } from '../../e2e-chrome/_tools/chrome-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, 'browser-daemon.mjs');
const UAT_BROWSER = process.env.UAT_BROWSER === 'chrome' ? 'chrome' : 'firefox';
const DEFAULT_PORT = UAT_BROWSER === 'chrome' ? 9877 : 9876;
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || DEFAULT_PORT;
const BASE = `http://127.0.0.1:${PORT}`;
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const NEWTAB_URL = UAT_BROWSER === 'chrome' ? newTabURL(CHROME_DEV_EXTENSION_ID, 'chrome') : newTabURL(UUID, 'firefox');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const size = o => Buffer.byteLength(JSON.stringify(o));

async function call(endpoint, body) {
	const res = await fetch(`${BASE}${endpoint}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json();
	if (!res.ok) { throw new Error(`${endpoint} -> ${res.status}: ${JSON.stringify(json)}`); }
	return json;
}

async function waitHealthy(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const h = await call('/health');
			if (h.ready) { return h; }
		} catch { /* not up yet */ }
		await sleep(1000);
	}
	throw new Error(`daemon did not become healthy within ${timeoutMs}ms`);
}

console.log(`[daemon-smoke] spawning ${UAT_BROWSER} daemon on port ${PORT} (newtab: ${NEWTAB_URL})`);
const daemon = spawn('node', [DAEMON], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, UAT_BROWSER, UAT_DAEMON_PORT: String(PORT) } });

// Chrome's `--headless=new` renders pages much closer to real Chrome (full JS/ads/
// trackers) than Firefox's classic `-headless`, so the same 19-site x2-pass +
// 5-news-site environment seed measurably takes longer per site under Chrome
// (mainly the per-site cross-origin-iframe consent-dismissal walk) — a real
// timing difference, not a hang (verified: a 2-site seed reaches /health in well
// under a minute on Chrome). Give Chrome double the budget.
const HEALTH_TIMEOUT_MS = UAT_BROWSER === 'chrome' ? 600000 : 300000;

let exitCode = 0;
try {
	const health = await waitHealthy(HEALTH_TIMEOUT_MS);
	console.log(`[daemon-smoke] /health ready (port ${health.port})`);

	const nav = await call('/navigate', { url: NEWTAB_URL });
	console.log(`[daemon-smoke] /navigate -> ${JSON.stringify(nav)}`);

	// Verify the seeded environment: the default 3×3 grid (9 cells) filled from the
	// seeded history (topSites), the recently-closed row populated from the article
	// seed, and no thumbnails on NON-PINNED tiles (the new-user state; the five
	// default pins legitimately carry startup-captured imagery — captureDefaultPins —
	// so the check scopes to `.newtab-site:not([pinned])`, the same convention
	// scenario 00-uat-init documents).
	// The grid fills ASYNCHRONOUSLY after page load (Tiles.getAllTiles wire
	// round-trip -> render), so poll bounded instead of sampling once — a
	// single instant sample races the fill and read `tiles: 0` on a page that
	// renders 9 tiles a moment later (regression-diagnosed 2026-07-16: the
	// steady-state DOM was fine while this check sampled too early).
	const envScript = 'return JSON.stringify({'
		+ 'cells: document.querySelectorAll(".newtab-cell").length,'
		+ 'tiles: document.querySelectorAll(".newtab-site").length,'
		+ 'recent: document.querySelectorAll(".ntt-recent-card").length,'
		+ 'thumbs: [...document.querySelectorAll(".newtab-site:not([pinned]) .newtab-thumbnail")].filter(t => getComputedStyle(t).backgroundImage.includes("url")).length'
		+ '})';
	let env, e;
	const envDeadline = Date.now() + 20000;
	for (;;) {
		env = await call('/evaluate', { script: envScript });
		e = JSON.parse(env.value);
		if (e.tiles >= 5 || Date.now() > envDeadline) { break; }
		await sleep(1000);
	}
	console.log(`[daemon-smoke] seeded env -> ${env.value} (${size(env)} bytes)`);
	if (e.cells !== 9) { throw new Error(`expected default 9-cell grid, got ${e.cells}`); }
	if (e.tiles < 5) { throw new Error(`expected >=5 history-filled tiles, got ${e.tiles}`); }
	if (e.recent < 1) { throw new Error(`expected >=1 recently-closed card, got ${e.recent}`); }
	if (e.thumbs !== 0) { throw new Error(`expected 0 thumbnails on non-pinned tiles (new-user state), got ${e.thumbs}`); }

	const shot = await call('/screenshot', { name: 'daemon-smoke' });
	console.log(`[daemon-smoke] /screenshot -> ${shot.saved} (${shot.bytes} bytes on disk)`);

	// /reset_extension drives the built-in reset and verifies it returns to the
	// default 3×3 (9-cell) grid. It throws if the reset doesn't take.
	const reset = await call('/reset_extension', {});
	console.log(`[daemon-smoke] /reset_extension -> ${JSON.stringify(reset)}`);
	if (reset.resetCells !== 9) { throw new Error(`reset signature wrong: ${JSON.stringify(reset)}`); }

	const after = await call('/evaluate', { script: 'return document.querySelectorAll(".newtab-cell").length' });
	console.log(`[daemon-smoke] post-reset cells -> ${JSON.stringify(after.value)} (expect 9 — default grid)`);
	if (after.value !== 9) { throw new Error(`expected 9 cells after reset_extension, got ${after.value}`); }

	console.log('[daemon-smoke] OK');
} catch (e) {
	console.error(`[daemon-smoke] FAILED: ${e.message}`);
	exitCode = 1;
} finally {
	daemon.kill('SIGTERM');
	// Give the daemon a moment to quit Firefox cleanly before we exit.
	await sleep(3000);
	if (!daemon.killed) { daemon.kill('SIGKILL'); }
}

process.exit(exitCode);
