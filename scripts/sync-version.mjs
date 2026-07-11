#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regenerate webextension/manifest.json (the Firefox target) from
 * manifest/base.json + manifest/firefox.json, with the version injected
 * from package.json.
 *
 * `package.json` is the single source of truth for the version; neither
 * manifest source file carries one (see scripts/build-manifest.mjs's
 * header). Runs in two places so the committed manifest can never drift
 * from either its overlay sources or package.json:
 *   - the `version` lifecycle script (package.json) — `pnpm version` runs this
 *     after bumping package.json and stages the regenerated manifest, so the
 *     version commit + tag already carry a matching manifest (no separate
 *     build needed).
 *   - the prebuild step (`pnpm build`) — a belt-and-braces resync before packaging.
 * `tests/integration/sync-version.test.ts` and
 * `tests/unit/manifest-authoring.test.ts` are the CI backstop if both are
 * skipped: the latter fails on ANY drift between the committed manifest and
 * the merge output (an overlay edit, a hand-edit of the generated file, or a
 * stale version), not just a version mismatch.
 *
 * Release workflow:
 *   pnpm version patch      # bumps package.json, regenerates+stages manifest, commits + tags
 *   pnpm build               # packages the .xpi (resyncs as a safeguard)
 *
 * Exit code: always 0 on success. Regeneration is idempotent (rewriting
 * identical content is a no-op diff); a missing manifest source file or
 * unreadable JSON raises and exits non-zero via the default thrown error path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFirefoxManifest } from './build-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'webextension/manifest.json');

const before = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null;
writeFirefoxManifest();
const after = fs.readFileSync(manifestPath, 'utf8');

if (before === after) {
	console.log(`webextension/manifest.json is in sync: ${JSON.parse(after).version}`);
} else {
	const beforeVersion = before ? (JSON.parse(before).version ?? '(none)') : '(missing)';
	const afterVersion = JSON.parse(after).version;
	console.log(`webextension/manifest.json regenerated from manifest/base.json + manifest/firefox.json: ${beforeVersion} → ${afterVersion}`);
}
