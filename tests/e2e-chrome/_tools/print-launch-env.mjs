#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Resolve the Chrome binary + stage the dev build, then print shell-`eval`-able
 * `KEY=value` lines — the one non-bash piece `run_chrome_tests.sh` (CHROME.md
 * D5b) needs, since `resolveChromeBinary()`/`stageDevBuild()` only exist as JS
 * (`chrome-env.mjs`, shared with `chrome:smoke`/`chrome:stage`). Mirrors
 * `stage-dev.mjs`'s staging call; this script additionally resolves the
 * binary and fails fast (before the caller wastes a port-wait timeout) if
 * none is usable.
 *
 * Output (stdout, only on success):
 *   CHROME_BIN=/abs/path/to/chrome
 *   STAGE_DIR=/abs/path/to/dist/chrome-dev
 *   EXTENSION_ID=lncefjbclhbbikhanecleanbbohpiclk
 */

import { resolveChromeBinary, stageDevBuild } from './chrome-env.mjs';

const found = resolveChromeBinary();
if (!found) {
	console.error('[chrome-e2e] x no Chrome binary found ($CHROME_BIN or the Puppeteer cache).');
	console.error('[chrome-e2e]   Run `pnpm chrome:provision` (Chrome for Testing) or set CHROME_BIN.');
	process.exit(1);
}
if (found.branded) {
	console.error('[chrome-e2e] x branded Google Chrome cannot run extension automation (D1 finding: >=137 removed it).');
	console.error('[chrome-e2e]   Run `pnpm chrome:provision` for Chrome for Testing.');
	process.exit(1);
}

const { dir, extensionId } = stageDevBuild();
console.error(`[chrome-e2e] chrome: ${found.version} (${found.bin})`);
console.error(`[chrome-e2e] staged: ${dir}`);
console.error(`[chrome-e2e] extension id: ${extensionId}`);

console.log(`CHROME_BIN=${found.bin}`);
console.log(`STAGE_DIR=${dir}`);
console.log(`EXTENSION_ID=${extensionId}`);
