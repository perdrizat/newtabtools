#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `pnpm chrome:stage` — stage the unpacked Chrome dev build for MANUAL
 * testing in a real Chrome (no automation, no CWS account needed):
 *
 *   1. pnpm chrome:stage
 *   2. open chrome://extensions in any Chrome (branded is fine — the
 *      >=137 restriction killed the AUTOMATION flags, not manual loading)
 *   3. enable "Developer mode" (top right)
 *   4. "Load unpacked" -> pick the dist/chrome-dev/ directory printed below
 *   5. open a new tab
 *
 * The stage carries the merged Chrome manifest (structured-clone messaging,
 * PNG icons, minimum_chrome_version) plus the committed dev key, so the
 * extension ID is always lncefjbclhbbikhanecleanbbohpiclk. Re-run after any
 * source change, then hit the reload arrow on chrome://extensions.
 */

import { stageDevBuild } from './chrome-env.mjs';

const { dir, extensionId } = stageDevBuild();
console.log(`[chrome-stage] staged: ${dir}`);
console.log(`[chrome-stage] extension id: ${extensionId}`);
console.log('[chrome-stage] load it: chrome://extensions -> Developer mode -> "Load unpacked" -> pick that directory');
