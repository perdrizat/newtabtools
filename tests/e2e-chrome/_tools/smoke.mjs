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
 *
 * A red result here is DATA, not a harness failure — D1 established this
 * smoke precisely to give the D2/D3 arcs a red/green target on real Chrome.
 * Exit code: 0 if checks 1-4 pass, 1 otherwise.
 */

import puppeteer from 'puppeteer-core';
import { resolveChromeBinary, stageDevBuild, NEWTAB_PATH } from './chrome-env.mjs';

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
} finally {
	if (browser) { await browser.close(); }
}

const failed = checks.filter(c => !c.passed);
console.log(`[chrome-smoke] ${failed.length === 0 ? 'GREEN' : 'RED'} — ${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
