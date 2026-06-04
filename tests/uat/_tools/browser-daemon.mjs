#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// NTT UAT — browser daemon.
//
// A LONG-LIVED process that owns exactly ONE Selenium + release-Firefox session
// for the whole UAT run, and exposes it over a localhost HTTP API. The MCP
// server (mcp-server.mjs) is a thin client that forwards each browser_* tool
// call here; the runner spawns this once, polls /health, runs every scenario
// against the same warm browser, then SIGTERMs it.
//
// Why a daemon (vs. launching Firefox inside each `claude -p` session):
//   - Launch + extension-install + history-seed cost is paid ONCE per run, not
//     once per scenario.
//   - History seeding (9 real URLs) only makes sense paid once.
//   - Established split (browserless / Playwright launch-server / Selenium Grid):
//     browser runtime is separate from the agent's MCP context.
//
// PORT: 9876 by default, $UAT_DAEMON_PORT overrides. Deliberately != E2E's 9222
// (tests/e2e/run_esr_tests.sh) so UAT and E2E never collide. preflight.mjs
// enforces the port is free before the runner starts.
//
// Endpoints (all JSON):
//   GET  /health          -> { status, ready, port }
//   POST /navigate         { url }              -> { ok, url }
//   POST /click            { selector }         -> { ok, selector }
//   POST /hover            { selector }         -> { ok, selector }
//   POST /evaluate         { script }           -> { value }
//   POST /file_upload      { selector, path }   -> { ok, path }
//   POST /screenshot       { name, dir? }       -> { saved, bytes }
//   POST /reset_extension                       -> { ok, resetCells, restoredCells, restoredSites }
//
// Run standalone (after `pnpm build`):
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/browser-daemon.mjs

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || 9876;
const XPI_DIR = process.env.XPI_DIR || path.resolve(ROOT, 'dist');
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.resolve(__dirname, '../artifacts');
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const ADDON_ID = 'newtabtools@symlink.ch';
const NEWTAB_URL = `moz-extension://${UUID}/newTab.xhtml`;
const FIXTURE = path.resolve(ROOT, 'tests/uat/newtabtools_knowngood.zip');

// History seed — real navigation, so NTT's history-backed features (recent
// tiles, autocomplete) have something to render against. URLs land in Firefox's
// history database on navigation START, so a page-load timeout is harmless.
const SEED_URLS = [
	'https://nzz.ch/',
	'https://www.tagesanzeiger.ch/',
	'https://www.amazon.de/',
	'https://www.ricardo.ch/',
	'https://www.migros.ch/',
	'https://www.coop.ch/',
	'https://www.ebay.com/',
	'https://claude.ai/',
	'https://chatgpt.com/',
];
const SEED_PAGELOAD_TIMEOUT_MS = 5000;
const NORMAL_PAGELOAD_TIMEOUT_MS = 300000;

// Grid signatures (.newtab-cell count = rows×columns). NTT's default grid is
// 3×3 = 9; the UAT fixture sets a 4×4 = 16 grid. These let /reset_extension
// VERIFY both the built-in reset (16 -> 9) and the restore (9 -> 16) actually
// took effect — if either count is wrong the daemon throws, surfacing a broken
// reset/restore code path as a between-scenario failure.
const DEFAULT_GRID_CELLS = 9;
const FIXTURE_GRID_CELLS = 16;
const FIXTURE_TILES = 9; // populated cells (.newtab-site) the fixture restores

const LOG_PATH = path.join(ARTIFACTS_DIR, 'daemon.log');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

function log(msg) {
	const line = `[daemon] ${msg}`;
	console.log(line);
	try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch { /* best-effort log */ }
}

function resolveXpi() {
	if (process.env.EXTENSION_XPI) { return process.env.EXTENSION_XPI; }
	if (!fs.existsSync(XPI_DIR)) { throw new Error(`No ${XPI_DIR} — run \`pnpm build\` first.`); }
	const f = fs.readdirSync(XPI_DIR)
		.filter(n => n.endsWith('.xpi') || n.endsWith('.zip'))
		.map(n => path.join(XPI_DIR, n))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	if (!f.length) { throw new Error(`No EXTENSION_XPI set and no .xpi/.zip in ${XPI_DIR}`); }
	return f[0];
}

async function makeDriver() {
	const opts = new firefox.Options();
	if (process.env.FIREFOX_BIN) { opts.setBinary(process.env.FIREFOX_BIN); }
	opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
	opts.addArguments('-headless');
	// Render at Full HD, 100% (device-pixel-ratio 1) — a realistic desktop
	// viewport. Screenshots are downscaled before saving (see SHOT_SCALE) so the
	// agent judges a representative FHD layout without the full-res token cost.
	opts.addArguments('--width=1920', '--height=1080');
	const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
	await driver.manage().window().setRect({ x: 0, y: 0, width: 1920, height: 1080 });
	const xpi = resolveXpi();
	await driver.installAddon(xpi, true); // temporary = unsigned OK on release
	log(`extension installed: ${path.basename(xpi)}`);
	return driver;
}

async function seedHistory(driver) {
	await driver.manage().setTimeouts({ pageLoad: SEED_PAGELOAD_TIMEOUT_MS });
	let seeded = 0;
	for (const url of SEED_URLS) {
		try {
			await driver.get(url);
			seeded++;
		} catch {
			// Timeout / network error: the URL still reached the history DB on
			// navigation start, which is all the seed needs. Count it anyway.
			seeded++;
		}
	}
	await driver.manage().setTimeouts({ pageLoad: NORMAL_PAGELOAD_TIMEOUT_MS });
	log(`history seeded: ${seeded}/${SEED_URLS.length} URLs`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Screenshots render at Full HD but are saved downscaled to keep the agent's
// image-token cost low (these tests judge layout/occlusion/contrast, not exact
// pixel placement). 0.5 → a 1920-wide capture is saved ~960 wide, which keeps
// tile titles and the About text legible while roughly quartering the pixels.
// Override with $UAT_SHOT_SCALE; set to 1 to disable. The downscale runs in-page
// on a <canvas> (the extension CSP allows `img-src data:`), so it needs no extra
// dependency or external image tool.
const SHOT_SCALE = (() => {
	const v = parseFloat(process.env.UAT_SHOT_SCALE);
	return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5;
})();
const DOWNSCALE_SCRIPT = `
	const b64 = arguments[0], factor = arguments[1], done = arguments[arguments.length - 1];
	const img = new Image();
	img.onload = () => {
		const w = Math.max(1, Math.round(img.naturalWidth * factor));
		const h = Math.max(1, Math.round(img.naturalHeight * factor));
		const c = document.createElement('canvas');
		c.width = w; c.height = h;
		const ctx = c.getContext('2d');
		ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, w, h);
		done(c.toDataURL('image/png').split(',')[1]);
	};
	img.onerror = () => done(null);
	img.src = 'data:image/png;base64,' + b64;
`;

// Downscale a base64 PNG via the page's canvas. Falls back to the full-res image
// if scaling is disabled or fails, so a screenshot is never lost.
async function downscalePng(b64) {
	if (SHOT_SCALE >= 1) { return b64; }
	try {
		const scaled = await driver.executeAsyncScript(DOWNSCALE_SCRIPT, b64, SHOT_SCALE);
		return scaled || b64;
	} catch (e) {
		log(`screenshot downscale failed (${e.message}); saving full-res`);
		return b64;
	}
}

// Poll the live grid's .newtab-cell count until it equals `expected`. Swallows
// transient errors (the page reloads mid-reset, briefly detaching the context).
async function waitForCells(expected, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		try {
			last = await driver.executeScript('return document.querySelectorAll(".newtab-cell").length');
			if (last === expected) { return last; }
		} catch { /* page reloading — retry */ }
		await sleep(250);
	}
	throw new Error(`grid never reached ${expected} cells (last=${last}) within ${timeoutMs}ms`);
}

// Poll the rendered tile count (.newtab-site = a populated cell). After a valid
// restore the fixture renders 9 tiles LIVE (no reload needed).
async function waitForSites(expected, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		try {
			last = await driver.executeScript('return document.querySelectorAll(".newtab-site").length');
			if (last === expected) { return last; }
		} catch { /* page reloading — retry */ }
		await sleep(250);
	}
	throw new Error(`grid never reached ${expected} tiles (last=${last}) within ${timeoutMs}ms`);
}

async function openAdvancedDrawer() {
	await driver.findElement(By.css('#options-toggle')).click();
	await sleep(300);
	await driver.findElement(By.css('[data-drawer-tab="advanced"]')).click();
	await sleep(300);
}

// Between-scenario reset. Returns the extension to a known state AND exercises
// its own reset + restore code on every run, so a regression in either surfaces
// here as a between-scenario failure:
//   1. Drive the built-in reset (#options-reset-all -> resetAllSettings()),
//      bypassing its blocking window.confirm. It clears everything and reloads.
//   2. VERIFY the reset took: grid back to the default 9-cell (3×3) layout.
//   3. Restore the checked-in fixture through the UI (#options-restore-file +
//      #options-restore).
//   4. VERIFY the restore took: grid back to the fixture's 16-cell (4×4) layout
//      AND its 9 tiles rendered live (no reload).
// History is NOT touched — it stays the seeded environment.
async function resetAndRestore() {
	await driver.get(NEWTAB_URL);
	await openAdvancedDrawer();
	await driver.executeScript('window.confirm = () => true;');
	await driver.findElement(By.css('#options-reset-all')).click();
	const resetCells = await waitForCells(DEFAULT_GRID_CELLS, 15000);

	await openAdvancedDrawer();
	await driver.findElement(By.css('#options-restore-file')).sendKeys(FIXTURE);
	await sleep(300);
	await driver.findElement(By.css('#options-restore')).click();
	const restoredCells = await waitForCells(FIXTURE_GRID_CELLS, 15000);
	const restoredSites = await waitForSites(FIXTURE_TILES, 15000);

	return { ok: true, resetCells, restoredCells, restoredSites };
}

const driver = await makeDriver();
await seedHistory(driver);
await driver.get(NEWTAB_URL);
log('initial newTab.xhtml loaded');

// ─── HTTP handlers ──────────────────────────────────────────────────────────

function readBody(req) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', c => { raw += c; });
		req.on('end', () => {
			if (!raw) { resolve({}); return; }
			try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
		});
		req.on('error', reject);
	});
}

async function handle(method, url, body) {
	if (method === 'GET' && url === '/health') {
		return { status: 'ok', ready: true, port: PORT };
	}
	if (method !== 'POST') { return { __status: 404, error: `no route ${method} ${url}` }; }

	switch (url) {
	case '/navigate':
		await driver.get(body.url);
		return { ok: true, url: body.url };
	case '/click':
		await driver.findElement(By.css(body.selector)).click();
		return { ok: true, selector: body.selector };
	case '/hover': {
		// Real pointer move so CSS :hover activates (synthetic JS events don't).
		// The pointer stays put, so a follow-up screenshot/evaluate sees the
		// hover state.
		const el = await driver.findElement(By.css(body.selector));
		await driver.actions().move({ origin: el }).perform();
		return { ok: true, selector: body.selector };
	}
	case '/evaluate':
		// body.async => executeAsyncScript: the script gets a callback as its
		// last argument and must call it with the result (for chrome.* / IDB
		// queries that resolve via callbacks/promises).
		return { value: body.async ? await driver.executeAsyncScript(body.script) : await driver.executeScript(body.script) };
	case '/file_upload':
		await driver.findElement(By.css(body.selector)).sendKeys(body.path);
		return { ok: true, path: body.path };
	case '/screenshot': {
		const dir = body.dir || ARTIFACTS_DIR;
		fs.mkdirSync(dir, { recursive: true });
		const data = await downscalePng(await driver.takeScreenshot());
		const p = path.join(dir, `${body.name}.png`);
		fs.writeFileSync(p, data, 'base64');
		return { saved: p, bytes: fs.statSync(p).size };
	}
	case '/reset_extension':
		return await resetAndRestore();
	default:
		return { __status: 404, error: `no route ${method} ${url}` };
	}
}

const server = http.createServer(async (req, res) => {
	let body = {};
	try {
		if (req.method === 'POST') { body = await readBody(req); }
	} catch (e) {
		res.writeHead(400, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: `bad JSON body: ${e.message}` }));
		return;
	}
	const reqPath = req.url.split('?')[0];
	try {
		const out = await handle(req.method, reqPath, body);
		const code = out.__status || 200;
		delete out.__status;
		res.writeHead(code, { 'content-type': 'application/json' });
		res.end(JSON.stringify(out));
	} catch (e) {
		log(`error ${req.method} ${reqPath}: ${e.message}`);
		res.writeHead(500, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: e.message }));
	}
});

server.on('error', (e) => {
	if (e.code === 'EADDRINUSE') {
		log(`FATAL: port ${PORT} already in use — is another daemon (or E2E) running? Set $UAT_DAEMON_PORT.`);
	} else {
		log(`FATAL server error: ${e.message}`);
	}
	void shutdown(1);
});

server.listen(PORT, '127.0.0.1', () => {
	log(`ready on http://127.0.0.1:${PORT}`);
});

// ─── lifecycle ────────────────────────────────────────────────────────────

let shuttingDown = false;
async function shutdown(code) {
	if (shuttingDown) { return; }
	shuttingDown = true;
	log('shutting down');
	try { server.close(); } catch { /* already closed */ }
	try { await driver.quit(); } catch { /* already gone */ }
	process.exit(code);
}

process.on('SIGTERM', () => { void shutdown(0); });
process.on('SIGINT', () => { void shutdown(0); });
