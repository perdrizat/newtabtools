#!/usr/bin/env node
// Standalone browser-path smoke (no MCP, no SDK needed) — promoted from the
// validated prototype. Launches release Firefox via Selenium + geckodriver,
// installs the unsigned extension temporarily, pins the moz-extension UUID,
// opens the new-tab page, and screenshots it. Use this to verify the browser
// half is healthy independently of the MCP/agent layer.
//
//   npx web-ext build --source-dir webextension/ --artifacts-dir tests/uat/artifacts --overwrite-dest
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/browser-smoke.mjs
//   # optional explicit xpi: node tests/uat/_tools/browser-smoke.mjs /path/to.xpi

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = process.env.ARTIFACTS_DIR || path.resolve(__dirname, '../artifacts');
const ADDON_ID = 'newtabtools@darktrojan.net';
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const NEWTAB_URL = `moz-extension://${UUID}/newTab.xhtml`;
const SHOT = `${ART_DIR}/browser-smoke.png`;

function resolveXpi() {
	if (process.argv[2]) { return process.argv[2]; }
	const xpis = fs.readdirSync(ART_DIR)
		.filter(f => f.endsWith('.xpi') || f.endsWith('.zip'))
		.map(f => path.join(ART_DIR, f))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	if (xpis.length === 0) { throw new Error(`No .xpi/.zip in ${ART_DIR} — run the web-ext build command in the header first.`); }
	return xpis[0];
}

const xpi = resolveXpi();
console.log(`[smoke] extension: ${xpi}`);

const options = new firefox.Options();
if (process.env.FIREFOX_BIN) { options.setBinary(process.env.FIREFOX_BIN); }
options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
options.addArguments('-headless'); // drop to watch it run

const t0 = Date.now();
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
console.log(`[smoke] Firefox up in ${((Date.now() - t0) / 1000).toFixed(1)}s (geckodriver owns the lifecycle)`);

try {
	const id = await driver.installAddon(xpi, true); // temporary = unsigned OK on release
	console.log(`[smoke] installed temporary add-on: ${id}`);
	await driver.get(NEWTAB_URL);
	const grid = await driver.wait(until.elementLocated(By.css('#newtab-scrollbox, #newtab-grid')), 10000);
	await driver.wait(until.elementIsVisible(grid), 5000);
	const tiles = await driver.findElements(By.css('.newtab-cell, [id^="newtab-cell"]'));
	console.log(`[smoke] new-tab grid rendered; tile-ish elements: ${tiles.length}`);
	const png = await driver.takeScreenshot();
	fs.mkdirSync(path.dirname(SHOT), { recursive: true });
	fs.writeFileSync(SHOT, png, 'base64');
	console.log(`[smoke] screenshot: ${SHOT}`);
	console.log(`[smoke] OK — total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
	console.error(`[smoke] FAILED: ${e.message}`);
	process.exitCode = 1;
} finally {
	await driver.quit();
}
