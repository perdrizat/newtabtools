#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Two-target manifest authoring (chrome-prep C6, CHROME_PREP.md).
 *
 * Merges `manifest/base.json` with a per-browser overlay
 * (`manifest/firefox.json` or `manifest/chrome.json`) into a single,
 * shippable manifest object. See `manifest/README.md` for the full flow;
 * this header documents the mechanics.
 *
 * MERGE SEMANTICS — shallow, top-level-key only. An overlay key REPLACES
 * the base key wholesale; there is no recursive/deep merge. If a nested
 * field (e.g. `action.theme_icons`) differs between targets, the WHOLE
 * top-level key (`action`) must be fully declared in each overlay that
 * diverges — base.json only holds keys that are byte-for-byte identical
 * across every target. This duplicates a little JSON across overlays in
 * exchange for zero "spooky action": editing one overlay can never
 * silently reach into a nested structure another target still depends on.
 *
 * VERSION — package.json is the single source of truth. Neither base.json
 * nor any overlay carries a "version" field; this script reads
 * package.json directly at merge time and injects the value. That keeps
 * the manifest-authoring sources themselves stateless with respect to
 * versioning. `scripts/sync-version.mjs` is what regenerates and stages
 * the committed `webextension/manifest.json` (the Firefox target) as part
 * of the `pnpm version` lifecycle.
 *
 * OUTPUT ORDER — deterministic: CANONICAL_KEY_ORDER below (mirroring the
 * pre-C6 hand-authored webextension/manifest.json) is applied on top of
 * the merged key set; keys absent for a given target are skipped. This
 * makes regeneration diff-clean regardless of source-file key order, and
 * is why `pnpm build`'s Firefox output byte-matches the committed file.
 *
 * Any top-level key present in base/overlay JSON but missing from
 * CANONICAL_KEY_ORDER throws loudly rather than being silently dropped —
 * add new keys to the list when you add them to a manifest source file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestDir = path.join(root, 'manifest');

const TARGETS = ['firefox', 'chrome'];

const CANONICAL_KEY_ORDER = [
	'name',
	'description',
	'version',
	'icons',
	'browser_specific_settings',
	'minimum_chrome_version',
	'message_serialization',
	'chrome_url_overrides',
	'background',
	'action',
	'incognito',
	'permissions',
	'host_permissions',
	'optional_permissions',
	'default_locale',
	'manifest_version',
	'content_security_policy',
];

/** @param {string} p */
function readJson(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Merge manifest/base.json with the named target's overlay, inject the
 * version from package.json, and return the result in canonical key order.
 *
 * `target` is typed as a plain `string`, not a `'firefox'|'chrome'` union:
 * membership is validated at RUNTIME (below) against TARGETS, which is the
 * real gate (this is a tooling script fed by `process.argv`/test input, not
 * one of the typed production monoliths, so there's no compile-time caller
 * to narrow the literal for).
 *
 * @param {string} target
 * @returns {Record<string, any>}
 */
export function mergeManifest(target) {
	if (!TARGETS.includes(target)) {
		throw new Error(`Unknown manifest target: "${target}" (expected one of: ${TARGETS.join(', ')})`);
	}

	const base = readJson(path.join(manifestDir, 'base.json'));
	const overlay = readJson(path.join(manifestDir, `${target}.json`));
	const pkg = readJson(path.join(root, 'package.json'));

	const merged = { ...base, ...overlay, version: pkg.version };

	const knownKeys = new Set(CANONICAL_KEY_ORDER);
	const unknown = Object.keys(merged).filter((key) => !knownKeys.has(key));
	if (unknown.length > 0) {
		throw new Error(
			`manifest/${target}.json (or base.json) declares key(s) not in CANONICAL_KEY_ORDER: ${unknown.join(', ')} — add them to scripts/build-manifest.mjs`
		);
	}

	/** @type {Record<string, any>} */
	const ordered = {};
	for (const key of CANONICAL_KEY_ORDER) {
		if (Object.prototype.hasOwnProperty.call(merged, key)) {
			ordered[key] = merged[key];
		}
	}
	return ordered;
}

/**
 * Stable serialization: tabs, trailing newline — matches the repo's existing JSON style.
 * @param {Record<string, any>} manifestObj
 * @returns {string}
 */
export function serializeManifest(manifestObj) {
	return JSON.stringify(manifestObj, null, '\t') + '\n';
}

/**
 * Regenerate the committed Firefox manifest (webextension/manifest.json) in place.
 * @returns {string} the absolute path written
 */
export function writeFirefoxManifest() {
	const merged = mergeManifest('firefox');
	const outPath = path.join(root, 'webextension/manifest.json');
	fs.writeFileSync(outPath, serializeManifest(merged));
	return outPath;
}

// CLI: `node scripts/build-manifest.mjs [target] [outPath]`
//   - firefox (default), no outPath: regenerates webextension/manifest.json in place.
//   - any target with an explicit outPath: writes the merged manifest there
//     (used by scripts/build.mjs to stage the Chrome build directory — there
//     is no committed Chrome manifest file, only the overlay source).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const target = process.argv[2] || 'firefox';
	const outPath = process.argv[3];

	if (!outPath) {
		if (target !== 'firefox') {
			throw new Error(`node scripts/build-manifest.mjs ${target} requires an explicit output path (e.g. node scripts/build-manifest.mjs chrome dist/chrome-build/manifest.json)`);
		}
		const written = writeFirefoxManifest();
		console.log(`Wrote ${path.relative(root, written)}`);
	} else {
		const merged = mergeManifest(target);
		fs.writeFileSync(outPath, serializeManifest(merged));
		console.log(`Wrote ${path.relative(root, outPath)} (${target})`);
	}
}
