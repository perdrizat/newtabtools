#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `pnpm build [target]` — target is "firefox" (default) or "chrome".
 * See manifest/README.md for the two-target manifest-authoring flow this
 * builds on top of (chrome-prep C6, CHROME_PREP.md).
 *
 * firefox (default): byte-identical to the pre-C6 build. Regenerates
 * webextension/manifest.json from manifest/base.json + manifest/firefox.json
 * + package.json's version (scripts/sync-version.mjs), then runs
 * `web-ext build` straight against webextension/ (source == shipped holds —
 * no staging copy), then the existing UAT staging build.
 *
 * chrome: DORMANT target — nothing in this project's test matrix runs
 * against it yet; it exists so the eventual Chrome port (CHROME_PREP.md
 * "What the Chrome port then reduces to") only has to fork a handful of
 * seam files, not invent a build path too. Stages a copy of webextension/
 * under dist/chrome-build/, overwrites its manifest.json with the merged
 * Chrome overlay, then zips via `web-ext build`. The resulting zip is
 * unvalidated beyond "the build succeeded" — there is no Chrome runtime in
 * CI or E2E/UAT yet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeManifest, serializeManifest } from './build-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || 'firefox';

function run(cmd) {
	execSync(cmd, { cwd: root, stdio: 'inherit' });
}

if (target === 'firefox') {
	run('node scripts/sync-version.mjs');
	run('web-ext build --source-dir webextension/ --artifacts-dir dist --overwrite-dest');
	run('node scripts/build-uat.mjs');
} else if (target === 'chrome') {
	run('node scripts/sync-version.mjs'); // keep package.json the single version source even for the dormant target

	const stageDir = path.join(root, 'dist', 'chrome-build');
	fs.rmSync(stageDir, { recursive: true, force: true });
	fs.cpSync(path.join(root, 'webextension'), stageDir, { recursive: true });

	// Chrome's manifest icon keys don't accept SVG (manifest/chrome.json's
	// `icons`/`action.default_icon` point at these PNGs) — copy the
	// pre-rasterized set (scripts/rasterize-icons.mjs) into the staged
	// images/ dir. webextension/ itself keeps only the SVG originals, so the
	// Firefox artifact (built straight from webextension/, no staging copy)
	// stays byte-identical.
	fs.cpSync(path.join(root, 'assets', 'chrome-icons'), path.join(stageDir, 'images'), { recursive: true });

	const merged = mergeManifest('chrome');
	fs.writeFileSync(path.join(stageDir, 'manifest.json'), serializeManifest(merged));

	run(`web-ext build --source-dir "${stageDir}" --artifacts-dir "${path.join(root, 'dist')}" --filename "newtab_powertools-chrome.zip" --overwrite-dest`);

	fs.rmSync(stageDir, { recursive: true, force: true });
} else {
	throw new Error(`Unknown build target: "${target}" (expected "firefox" or "chrome")`);
}
