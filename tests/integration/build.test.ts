/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The shared build staging (scripts/stage.mjs): every package and dev build
// is webextension/ + overlays/<browser>/ + the merged manifest, staged by one
// function, and every artifact name comes from one helper.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it, expect } from 'vitest';
import { TARGETS, TIERS } from '../_browsers/registry.mjs';
import { mergeManifest } from '../../scripts/build-manifest.mjs';
import { DIST, artifactPath, stageBuild } from '../../scripts/stage.mjs';
import { CHROME_DEV_EXTENSION_ID, DEV_STAGE_DIR, stageDevBuild, tierStageDir } from '../_browsers/chrome/chrome-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TMP = path.join(ROOT, '.tmp', 'build-test');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Every file under dir, as sorted '/'-joined relative paths. */
function listFiles(dir: string): string[] {
	return (fs.readdirSync(dir, { recursive: true }) as string[])
		.filter(f => fs.statSync(path.join(dir, f)).isFile())
		.map(f => f.split(path.sep).join('/'))
		.sort();
}

afterAll(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

describe('artifactPath', () => {
	it('names every target dist/newtab_powertools-<version>-<browser>.zip', () => {
		for (const target of TARGETS) {
			expect(artifactPath(target)).toBe(path.join(DIST, `newtab_powertools-${pkg.version}-${target}.zip`));
		}
	});

	it('takes another directory and version', () => {
		expect(artifactPath('chrome', { dir: '/x', version: '9.9.9' })).toBe(path.join('/x', 'newtab_powertools-9.9.9-chrome.zip'));
	});

	it('rejects a browser the registry does not know', () => {
		expect(() => artifactPath('safari')).toThrow(/unknown build target "safari"/i);
	});
});

describe('stageBuild', () => {
	it('stages chrome as webextension/ plus overlays/chrome/, with the merged Chrome manifest', () => {
		const dir = stageBuild('chrome', path.join(TMP, 'chrome'));
		const overlay = path.join(ROOT, 'overlays', 'chrome');
		const expected = [...new Set([...listFiles(path.join(ROOT, 'webextension')), ...listFiles(overlay)])].sort();
		expect(listFiles(dir)).toEqual(expected);
		for (const f of listFiles(overlay)) {
			expect(fs.readFileSync(path.join(dir, f)).equals(fs.readFileSync(path.join(overlay, f))), f).toBe(true);
		}
		expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toEqual(mergeManifest('chrome'));
	});

	it('stages firefox as an exact copy of webextension/ (no overlay dir, committed manifest)', () => {
		const dir = stageBuild('firefox', path.join(TMP, 'firefox'));
		expect(listFiles(dir)).toEqual(listFiles(path.join(ROOT, 'webextension')));
		expect(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
			.toBe(fs.readFileSync(path.join(ROOT, 'webextension', 'manifest.json'), 'utf8'));
	});

	it('applies patchManifest to the staged manifest', () => {
		const dir = stageBuild('firefox', path.join(TMP, 'patched'), {
			patchManifest: m => ({ ...m, name: 'patched' }),
		});
		expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).name).toBe('patched');
	});

	it('replaces a previous stage instead of merging into it', () => {
		const dir = path.join(TMP, 'stale');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'leftover.txt'), 'x');
		stageBuild('firefox', dir);
		expect(fs.existsSync(path.join(dir, 'leftover.txt'))).toBe(false);
	});

	it('rejects a browser the registry does not know', () => {
		expect(() => stageBuild('safari', path.join(TMP, 'safari'))).toThrow(/unknown build target "safari"/i);
	});
});

describe('stageDevBuild (Chrome unpacked dev build)', () => {
	it('defaults to dist/dev/chrome/', () => {
		expect(DEV_STAGE_DIR).toBe(path.join(DIST, 'dev', 'chrome'));
	});

	it('gives each test tier its own stage, so tiers running in parallel never delete each other\'s', () => {
		const dirs = [DEV_STAGE_DIR, path.join(DIST, '_stage', 'chrome'), ...TIERS.map(tierStageDir)];
		expect(new Set(dirs).size).toBe(dirs.length);
		expect(tierStageDir('e2e')).toBe(path.join(DIST, '_stage', 'chrome-e2e'));
		expect(() => tierStageDir('nope')).toThrow(/unknown tier "nope"/);
	});

	it('is the chrome stage plus the dev key', () => {
		const { dir, extensionId } = stageDevBuild({ dir: path.join(TMP, 'dev-chrome') });
		expect(extensionId).toBe(CHROME_DEV_EXTENSION_ID);
		expect(fs.existsSync(path.join(dir, 'images', 'icon-128.png'))).toBe(true);
		const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
		const { key, ...rest } = manifest;
		expect(typeof key).toBe('string');
		expect(rest).toEqual(mergeManifest('chrome'));
	});
});
