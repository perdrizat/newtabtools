#!/usr/bin/env node
// Standalone smoke for browser-daemon.mjs — the long-lived browser host that
// holds ONE Selenium+Firefox session for a whole UAT run and exposes it over a
// localhost HTTP API (port 9876 by default; $UAT_DAEMON_PORT overrides).
//
// This is the daemon's behavioural contract test: spawn it, wait for /health,
// drive each endpoint once, then SIGTERM it. It is independent of the MCP and
// agent layers (mcp-smoke.mjs covers those, daemon-backed).
//
//   pnpm build
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/daemon-smoke.mjs
//
// Slow internet note: the daemon seeds 9 real URLs into history at startup, so
// /health can take a while to go green on a cold connection.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, 'browser-daemon.mjs');
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || 9876;
const BASE = `http://127.0.0.1:${PORT}`;
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const NEWTAB_URL = `moz-extension://${UUID}/newTab.xhtml`;

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

console.log(`[daemon-smoke] spawning daemon on port ${PORT}`);
const daemon = spawn('node', [DAEMON], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env } });

let exitCode = 0;
try {
	const health = await waitHealthy(300000);
	console.log(`[daemon-smoke] /health ready (port ${health.port})`);

	const nav = await call('/navigate', { url: NEWTAB_URL });
	console.log(`[daemon-smoke] /navigate -> ${JSON.stringify(nav)}`);

	const evald = await call('/evaluate', { script: 'return document.querySelectorAll(".newtab-cell, #newtab-grid > *").length' });
	console.log(`[daemon-smoke] /evaluate cell-ish count -> ${JSON.stringify(evald.value)}  (${size(evald)} bytes)`);

	const shot = await call('/screenshot', { name: 'daemon-smoke' });
	console.log(`[daemon-smoke] /screenshot -> ${shot.saved} (${shot.bytes} bytes on disk)`);

	// /reset_extension drives the built-in reset (16->9 cells, verified) then
	// restores the fixture (9->16 cells AND 9 tiles rendered live, verified).
	// It throws if any step doesn't take.
	const reset = await call('/reset_extension', {});
	console.log(`[daemon-smoke] /reset_extension -> ${JSON.stringify(reset)}`);
	if (reset.resetCells !== 9 || reset.restoredCells !== 16 || reset.restoredSites !== 9) {
		throw new Error(`reset/restore signature wrong: ${JSON.stringify(reset)}`);
	}

	const after = await call('/evaluate', { script: 'return document.querySelectorAll(".newtab-site").length + "/" + document.querySelectorAll(".newtab-cell").length' });
	console.log(`[daemon-smoke] post-reset tiles/cells -> ${JSON.stringify(after.value)} (expect 9/16 — fixture restored)`);
	if (after.value !== '9/16') { throw new Error(`expected 9/16 after reset_extension, got ${after.value}`); }

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
