/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: package.json and webextension/manifest.json carry the
 * same version. The sync is automated by scripts/sync-version.mjs at build
 * time; this test is the regression guard that fails CI if drift slips in
 * (e.g., a hand-bump that forgets the other file).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

describe('Version sync — package.json ⇄ webextension/manifest.json', () => {
	it('package.json and manifest.json carry identical versions', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
		// eslint-disable-next-line ntt/no-source-grep -- regression guard for version drift between the two release-relevant files
		const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'webextension/manifest.json'), 'utf8'));
		expect(manifest.version).toBe(pkg.version);
	});

	it('sync-version.mjs script exists and regenerates the manifest from package.json (chrome-prep C6)', () => {
		const scriptPath = path.join(ROOT, 'scripts/sync-version.mjs');
		expect(fs.existsSync(scriptPath)).toBe(true);
		const src = fs.readFileSync(scriptPath, 'utf8');
		expect(src).toContain('webextension/manifest.json');
		// chrome-prep C6: the version-injection logic itself lives in
		// build-manifest.mjs's mergeManifest() (base.json/overlays carry no
		// "version" field at all) — sync-version.mjs delegates to it rather
		// than patching manifest.version directly.
		expect(src).toContain('from \'./build-manifest.mjs\'');
		expect(src).toMatch(/writeFirefoxManifest\(\)/);
	});

	it('build-manifest.mjs injects the version from package.json (single source of truth)', () => {
		const scriptPath = path.join(ROOT, 'scripts/build-manifest.mjs');
		const src = fs.readFileSync(scriptPath, 'utf8');
		expect(src).toContain('package.json');
		expect(src).toMatch(/version:\s*pkg\.version/);
	});

	it('package.json build script delegates to build.mjs, which runs sync-version as a prebuild step (chrome-prep C6)', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
		expect(pkg.scripts.build).toBe('node scripts/build.mjs');
		const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
		expect(buildSrc).toContain('sync-version');
	});
});
