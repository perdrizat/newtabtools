#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Sync webextension/manifest.json version with package.json.
 *
 * `package.json` is the source of truth; `manifest.json` mirrors it. Runs in
 * two places so the two files can never drift:
 *   - the `version` lifecycle script (package.json) — `pnpm version` runs this
 *     after bumping package.json and stages the synced manifest, so the version
 *     commit + tag already carry a matching manifest (no separate build needed).
 *   - the prebuild step (`pnpm build`) — a belt-and-braces resync before packaging.
 * `tests/integration/sync-version.test.ts` is the CI backstop if both are skipped.
 *
 * Release workflow:
 *   pnpm version patch      # bumps package.json, syncs+stages manifest, commits + tags
 *   pnpm build              # packages the .xpi (resyncs as a safeguard)
 *
 * Exit code: always 0. Drift is fixed in place; a missing file or an
 * unreadable JSON file raises and exits non-zero via the default thrown
 * error path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'webextension/manifest.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.version === pkg.version) {
	console.log(`webextension/manifest.json version is in sync: ${pkg.version}`);
} else {
	const before = manifest.version;
	manifest.version = pkg.version;
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`webextension/manifest.json: ${before} → ${pkg.version}`);
}
