#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Chrome E2E branded launcher (CHROME.md D8, Decision 12; the D1 amendment
 * recorded 2026-07-18: Puppeteer's CDP `installExtension` over the PIPE
 * transport, plus `--enable-unsafe-extension-debugging`, runs the extension
 * fine on branded stable Chrome — only the legacy `--load-extension` flag is
 * dead there). `run_chrome_tests.sh` spawns this script as a long-lived
 * background process instead of launching Chrome directly:
 *
 *   1. Resolve a Chrome binary, BRANDED-first (Decision 12: the E2E tier runs
 *      the production binary users actually have) via
 *      `resolveChromeBinary({ prefer: 'branded' })` — $CHROME_BIN →
 *      google-chrome-stable/google-chrome → the Puppeteer CfT cache (the
 *      fallback lane, same binaries `chrome:provision` populates) →
 *      chromium as a last resort. This does NOT change the default
 *      (CfT-first) order `resolveChromeBinary()` returns for every other
 *      caller (UAT daemon, preflight, the smokes, rasterize-icons).
 *   2. Stage the unpacked dev build (`stageDevBuild()`, unchanged).
 *   3. `puppeteer.launch()` with a DUAL transport: `pipe: true` (the CDP
 *      `Extensions` domain is pipe-only on branded) AND
 *      `--remote-debugging-port=9223` — so the vitest suite's OWN
 *      `puppeteer.connect({ browserURL: ... })` (tests/e2e/_helpers.ts,
 *      unchanged) keeps working exactly as it does against CfT today.
 *      Probe-proven 2026-07-18 (`.tmp/dual-transport-probe.mjs`): both
 *      transports serve simultaneously. No `--user-data-dir` is passed —
 *      Puppeteer manages its own temp profile and tears it down on
 *      `browser.close()`.
 *   4. `browser.installExtension(dir)` over the pipe; verify the returned id
 *      matches the staged dev-key id, else exit 1 with a diagnostic.
 *   5. Wait until the extension's service-worker TARGET is visible over the
 *      PORT specifically (not just the pipe) — the probe's one open caveat
 *      was that SW visibility over the port lagged when sampled immediately
 *      after install. A second `puppeteer.connect` client — standing in for
 *      the E2E suite's own later connection — polls for it via
 *      `waitForTarget`, then disconnects (NOT close — the browser stays up).
 *   6. Only once that wait passes: write the ready-file
 *      (`tests/e2e-chrome/.launcher-ready`, content: extension id then
 *      binary path, one per line) that `run_chrome_tests.sh` polls for. Any
 *      stale ready-file from a previous crashed run is removed at startup so
 *      it can never fool the shell script's wait loop into proceeding before
 *      THIS run is actually ready.
 *   7. Stay alive until SIGTERM/SIGINT (sent by the shell script's cleanup):
 *      `browser.close()`, remove the ready-file, exit 0. If the browser
 *      process dies on its own first, the `disconnected` event does the same
 *      cleanup and exits 1 so the shell script's ready-file wait fails fast
 *      instead of hanging for its full timeout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromeBinary, stageDevBuild } from './chrome-env.mjs';

const PORT = 9223;
const READY_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.launcher-ready');

function log(...args) { console.log('[launch-chrome]', ...args); }
function logErr(...args) { console.error('[launch-chrome]', ...args); }

async function removeReadyFile() {
	await fs.promises.rm(READY_FILE, { force: true }).catch(() => {});
}

async function main() {
	// Stale ready-file from a previous crashed run must never fool the shell
	// script's wait loop into proceeding before THIS run is actually ready.
	await removeReadyFile();

	const found = resolveChromeBinary({ prefer: 'branded' });
	if (!found) {
		logErr('x no Chrome binary found ($CHROME_BIN, google-chrome(-stable), the Puppeteer CfT cache, or chromium).');
		logErr('  Run `pnpm chrome:provision` (Chrome for Testing), install branded Chrome, or set CHROME_BIN.');
		process.exitCode = 1;
		return;
	}
	log(found.branded
		? `production-binary lane (branded): ${found.version} (${found.bin})`
		: `fallback lane (no branded binary found; using CfT/chromium): ${found.version} (${found.bin})`);

	const { dir, extensionId } = stageDevBuild();
	log(`staged: ${dir}`);
	log(`extension id: ${extensionId}`);

	let browser = null;
	let shuttingDown = false;

	const shutdown = async (exitCode) => {
		if (shuttingDown) { return; }
		shuttingDown = true;
		await removeReadyFile();
		if (browser) {
			await browser.close().catch(() => {});
		}
		process.exitCode = exitCode;
	};

	process.on('SIGTERM', () => { void shutdown(0); });
	process.on('SIGINT', () => { void shutdown(0); });

	try {
		// Dual transport (CHROME.md Decision 12 / the probe): pipe for the CDP
		// Extensions domain (branded is pipe-only there); a fixed port so the
		// vitest suite's own puppeteer.connect() keeps working unmodified.
		browser = await puppeteer.launch({
			executablePath: found.bin,
			headless: true,
			pipe: true,
			// Puppeteer injects --disable-extensions by default (only auto-dropped
			// when the legacy --disable-extensions-except flag is present) — it
			// silently inerts the CDP-installed extension (the same finding
			// smoke.mjs proved out for branded's install route).
			ignoreDefaultArgs: ['--disable-extensions'],
			args: [
				'--no-first-run',
				'--no-default-browser-check',
				'--disable-dev-shm-usage',
				'--enable-unsafe-extension-debugging',
				`--remote-debugging-port=${PORT}`,
			],
		});

		browser.on('disconnected', () => {
			if (!shuttingDown) {
				logErr('x Chrome disconnected unexpectedly.');
				void shutdown(1);
			}
		});

		const installedId = await browser.installExtension(dir);
		if (installedId !== extensionId) {
			logErr(`x installed extension id mismatch: got ${installedId}, dev-key says ${extensionId}.`);
			await shutdown(1);
			return;
		}
		log(`extension installed over the pipe: ${installedId}`);

		// The probe's one open caveat: the SW target lagged when sampled
		// immediately over the PORT (as opposed to the pipe connection just
		// used for install). Wait for it via a SECOND client — standing in for
		// the E2E suite's own later puppeteer.connect({ browserURL }) — before
		// signaling readiness, so the suite never races the SW's visibility
		// over the transport it actually uses.
		const swWaitStart = Date.now();
		const versionRes = await fetch(`http://127.0.0.1:${PORT}/json/version`);
		const version = await versionRes.json();
		const portClient = await puppeteer.connect({
			browserWSEndpoint: version.webSocketDebuggerUrl,
			defaultViewport: null,
		});
		try {
			await portClient.waitForTarget(
				t => t.type() === 'service_worker' && t.url().includes(extensionId),
				{ timeout: 30000 },
			);
		} catch (e) {
			logErr(`x service-worker target never became visible over the port (${PORT}) within 30s: ${String(e?.message || e)}`);
			logErr('  A suite run without a visible SW would fail confusingly later — refusing to signal ready.');
			await portClient.disconnect();
			await shutdown(1);
			return;
		}
		const swWaitMs = Date.now() - swWaitStart;
		log(`service-worker target visible over the port after ${swWaitMs}ms`);
		await portClient.disconnect();

		fs.writeFileSync(READY_FILE, `${extensionId}\n${found.bin}\n`);
		log(`ready-file written: ${READY_FILE}`);
		log('staying alive until SIGTERM/SIGINT...');

		// Keep the process alive; shutdown() (triggered by a signal or the
		// 'disconnected' handler above) is the only exit path from here.
		await new Promise(() => {});
	} catch (e) {
		logErr(`x fatal: ${String((e && e.stack) || e)}`);
		await shutdown(1);
	}
}

await main();
