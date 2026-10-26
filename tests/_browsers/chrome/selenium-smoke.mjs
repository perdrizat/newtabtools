#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Selenium-drives-Chrome smoke (CHROME.md D1, extended scope) —
 * `pnpm chrome:smoke:selenium`.
 *
 * Proves the OTHER automation path the Chrome program needs: the UAT tier
 * (D6) runs on Selenium, not Puppeteer, and its Firefox daemon relies on
 * geckodriver-only `installAddon`. This smoke verifies the Chrome
 * equivalents work at all on this machine: Selenium Manager provisions
 * chromedriver, `--load-extension` loads the staged dev build, and the
 * deterministic dev-key extension ID is reachable.
 *
 * Exit code: 0 when the new-tab page renders grid cells under Selenium.
 */

import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { resolveChromeBinary, stageDevBuild, chromeArgs, NEWTAB_PATH } from './chrome-env.mjs';

const found = resolveChromeBinary();
if (!found) {
	console.error('[selenium-smoke] x no Chrome binary found ($CHROME_BIN or PATH). Install Chrome or set CHROME_BIN.');
	process.exit(1);
}

const { dir, extensionId } = stageDevBuild();
console.log(`[selenium-smoke] chrome: ${found.version}`);
console.log(`[selenium-smoke] extension id: ${extensionId}`);

const opts = new chrome.Options();
opts.setChromeBinaryPath(found.bin);
opts.addArguments('--headless=new', ...chromeArgs(dir));

let driver = null;
let exitCode = 1;
try {
	driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
	const caps = await driver.getCapabilities();
	console.log(`[selenium-smoke] ✓ session up (chromedriver ${caps.get('chrome')?.chromedriverVersion?.split(' ')[0] ?? 'unknown'})`);

	await driver.get(`chrome-extension://${extensionId}/${NEWTAB_PATH}`);
	const cells = await driver.wait(async () => {
		const n = await driver.executeScript('return document.querySelectorAll("#newtab-grid .newtab-cell").length');
		return n > 0 ? n : null;
	}, 15000).catch(() => 0);

	if (cells > 0) {
		console.log(`[selenium-smoke] ✓ grid renders under Selenium (${cells} cells)`);
		console.log('[selenium-smoke] GREEN');
		exitCode = 0;
	} else {
		console.log('[selenium-smoke] x no .newtab-cell within 15s');
		console.log('[selenium-smoke] RED');
	}
} catch (e) {
	console.error(`[selenium-smoke] x ${String(e?.message || e)}`);
	console.log('[selenium-smoke] RED');
} finally {
	if (driver) { await driver.quit().catch(() => {}); }
}
process.exit(exitCode);
