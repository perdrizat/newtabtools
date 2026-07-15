#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Provision Chrome for Testing (CHROME.md D1) — `pnpm chrome:provision`.
 *
 * Branded Google Chrome >= 137 removed extension automation (both
 * `--load-extension` and the CDP install path silently produce a
 * never-activated extension — verified empirically 2026-07-15, D1). The
 * supported automation vehicle is **Chrome for Testing**, the same
 * binary-fetch model as Selenium Manager's geckodriver/chromedriver
 * provisioning (see tests/uat/README.md "Dependencies").
 *
 * Downloads the current CfT stable into ~/.cache/puppeteer (the standard
 * Puppeteer cache; ~200 MB once) and prints the executable path. Idempotent —
 * re-running verifies and reuses the cached copy. Uses @puppeteer/browsers
 * from puppeteer-core's own dependency tree — no new npm packages.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// @puppeteer/browsers is a puppeteer-core dependency — resolve it from
// puppeteer-core's REAL location (pnpm's strict symlink layout hides
// transitive deps from the repo root on purpose; createRequire does not
// follow the node_modules/puppeteer-core symlink by itself).
const puppeteerCoreReal = fs.realpathSync(path.join(ROOT, 'node_modules', 'puppeteer-core'));
const requireFromPuppeteer = createRequire(path.join(puppeteerCoreReal, 'package.json'));
const browsers = requireFromPuppeteer('@puppeteer/browsers');

const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
const platform = browsers.detectBrowserPlatform();
if (!platform) {
	console.error('[chrome-provision] x could not detect a supported platform');
	process.exit(1);
}

const buildId = await browsers.resolveBuildId(browsers.Browser.CHROME, platform, 'stable');
console.log(`[chrome-provision] chrome for testing ${buildId} (${platform}) -> ${cacheDir}`);

let lastPct = -10;
await browsers.install({
	browser: browsers.Browser.CHROME,
	buildId,
	cacheDir,
	downloadProgressCallback: (downloaded, total) => {
		const pct = Math.floor((downloaded / total) * 100);
		if (pct >= lastPct + 10) {
			lastPct = pct;
			console.log(`[chrome-provision] ${pct}%`);
		}
	},
});

const executablePath = browsers.computeExecutablePath({
	browser: browsers.Browser.CHROME,
	buildId,
	cacheDir,
});
console.log(`[chrome-provision] ✓ ready: ${executablePath}`);
