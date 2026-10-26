/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The one staging path every build shares: the store packages
 * (scripts/build.mjs, `dist/_stage/<browser>/`), the Firefox UAT package
 * (scripts/build-uat.mjs) and the unpacked Chrome dev build
 * (tests/_browsers/chrome/chrome-env.mjs `stageDevBuild()`, `dist/dev/chrome/`).
 *
 * A stage is a copy of webextension/, with overlays/<browser>/ copied over it
 * (browser-only assets, e.g. Chrome's PNG icons — its manifest icon keys
 * reject SVG) and the merged manifest for that browser written last. Targets
 * come from tests/_browsers/registry.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, mergeManifest, serializeManifest } from './build-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DIST = path.join(root, 'dist');

/** @param {string} target */
function assertTarget(target) {
	if (!TARGETS.includes(target)) {
		throw new Error(`Unknown build target "${target}" (expected one of: ${TARGETS.join(', ')})`);
	}
}

/**
 * The store package for a browser: `<dir>/newtab_powertools-<version>-<browser>.zip`.
 * @param {string} target
 * @param {{dir?: string, version?: string}} [opts] default: dist/ and package.json's version
 * @returns {string}
 */
export function artifactPath(target, { dir = DIST, version } = {}) {
	assertTarget(target);
	const v = version ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
	return path.join(dir, `newtab_powertools-${v}-${target}.zip`);
}

/**
 * Stage a browser's build into dir, replacing whatever was there.
 * @param {string} target
 * @param {string} dir
 * @param {{patchManifest?: (m: Record<string, any>) => Record<string, any>}} [opts]
 * @returns {string} dir
 */
export function stageBuild(target, dir, { patchManifest } = {}) {
	assertTarget(target);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.cpSync(path.join(root, 'webextension'), dir, { recursive: true });
	const overlay = path.join(root, 'overlays', target);
	if (fs.existsSync(overlay)) {
		fs.cpSync(overlay, dir, { recursive: true });
	}
	const merged = mergeManifest(target);
	fs.writeFileSync(path.join(dir, 'manifest.json'), serializeManifest(patchManifest ? patchManifest(merged) : merged));
	return dir;
}
