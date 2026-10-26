/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `pnpm build:<browser>` (`node scripts/build.mjs <browser>`) — packages one
 * browser registered in tests/_browsers/registry.mjs; `pnpm build` runs them
 * all. Each package is staged by scripts/stage.mjs (webextension/ +
 * overlays/<browser>/ + the merged manifest, see manifest/README.md) under
 * dist/_stage/<browser>/ and zipped to dist/newtab_powertools-<version>-<browser>.zip.
 * Firefox also builds the UAT package (scripts/build-uat.mjs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DIST, artifactPath, stageBuild } from './stage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];

function run(cmd) {
	execSync(cmd, { cwd: root, stdio: 'inherit' });
}

const zip = artifactPath(target); // validates target
run('node scripts/sync-version.mjs');
const stageDir = stageBuild(target, path.join(DIST, '_stage', target));
// Bare `web-ext` (not `npx web-ext`): the pinned local binary (audit m10).
run(`web-ext build --source-dir "${stageDir}" --artifacts-dir "${DIST}" --filename "${path.basename(zip)}" --overwrite-dest`);
fs.rmSync(stageDir, { recursive: true, force: true });
try {
	fs.rmdirSync(path.join(DIST, '_stage')); // only once no other stage is left in it
} catch { /* not empty, or already gone */ }

if (target === 'firefox') {
	run('node scripts/build-uat.mjs');
}
