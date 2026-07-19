#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Provision Chrome for Testing (CHROME.md D1) — `pnpm chrome:provision`.
 *
 * CfT is the CURRENT-binary lane (CHROME.md Decision 12): the UAT tier and
 * the local smoke run on it — Selenium/chromedriver cannot drive branded
 * Chrome (branded >= 137 ignores `--load-extension`, and chromedriver's port
 * transport can't reach the pipe-only CDP `Extensions` install domain). The
 * E2E tier runs branded stable via `launch-chrome.mjs` (the D1-amendment
 * pipe-install route) and only falls back to this cache when no branded
 * binary exists. Same binary-fetch model as Selenium Manager's
 * geckodriver/chromedriver provisioning (see tests/uat/README.md
 * "Dependencies").
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
import { cftStalenessWarning } from './chrome-env.mjs';

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

// CfT staleness guard (CHROME.md Decision 12): warn when the CfT "stable"
// build being provisioned and the locally installed branded stable are on
// different majors — the current-binary and production-binary lanes would
// then be testing different Chromes.
{
	const drift = cftStalenessWarning(buildId);
	if (drift) {
		console.warn(`[chrome-provision] ~ ${drift}`);
	}
}

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
