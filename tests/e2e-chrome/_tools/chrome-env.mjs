/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared plumbing for the Chrome runtime tier (CHROME.md D1/D5).
 *
 * - `resolveChromeBinary()` — $CHROME_BIN, then the usual binary names.
 * - `stageDevBuild()` — stages an UNPACKED dev build under dist/chrome-dev/:
 *   a copy of webextension/ with the merged Chrome-overlay manifest
 *   (scripts/build-manifest.mjs) plus an injected dev-only `key`, so the
 *   extension ID is deterministic across every profile and machine.
 *
 * The dev key (`dev-key.json`) is a committed PUBLIC key only: Chrome derives
 * the extension ID from the manifest `key` field (SHA-256 of the DER SPKI,
 * first 16 bytes mapped onto a-p); no private key is needed to LOAD an
 * unpacked extension, so none was kept. The key must never reach a store
 * artifact — `pnpm build chrome` does not include it; only this staging path
 * injects it (asserted by tests/unit/manifest-authoring.test.ts's overlay
 * shape checks staying key-free).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeManifest, serializeManifest } from '../../../scripts/build-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEV_KEY = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'dev-key.json'), 'utf8'));

/**
 * The committed dev build's deterministic Chrome extension id, read straight
 * off `dev-key.json` (no staging side effect) — for callers that just need
 * the id to build a `chrome-extension://` URL (e.g. the UAT runner's
 * prologue) without paying for `stageDevBuild()`'s copy.
 */
export const CHROME_DEV_EXTENSION_ID = DEV_KEY.id;

/**
 * Chrome-for-Testing binaries in the standard Puppeteer cache, newest first.
 * Branded Google Chrome >= 137 removed extension automation (both
 * --load-extension and the CDP install path produce a never-activated
 * extension — verified 2026-07-15, D1), so CfT is preferred over any branded
 * binary. `pnpm chrome:provision` populates this cache.
 * @return {string[]}
 */
function cftCandidates() {
	const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
	const chromeDir = path.join(cacheDir, 'chrome');
	try {
		return fs.readdirSync(chromeDir)
			.sort()
			.reverse()
			.map(build => path.join(chromeDir, build, 'chrome-linux64', 'chrome'))
			.filter(p => fs.existsSync(p));
	} catch {
		return [];
	}
}

/**
 * Locate a runnable Chrome binary: $CHROME_BIN, then Chrome for Testing,
 * then branded/chromium binaries as a last resort (branded cannot run
 * extension automation — the smokes will say so).
 * @return {{bin: string, version: string, branded: boolean} | null}
 */
export function resolveChromeBinary() {
	const candidates = [
		process.env.CHROME_BIN,
		...cftCandidates(),
		'google-chrome-stable',
		'google-chrome',
		'chromium',
		'chromium-browser',
		// Filtering with a type-guard (not bare `Boolean`) so tsc narrows
		// `(string | undefined)[]` to `string[]` — needed once this file gets
		// imported (not just run) by a checked .ts consumer (D5b, _helpers.ts).
	].filter((c) => typeof c === 'string');
	for (const candidate of candidates) {
		try {
			// Puppeteer requires an ABSOLUTE executablePath — resolve bare names via PATH.
			const bin = path.isAbsolute(candidate)
				? candidate
				: execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
			if (!bin || !fs.existsSync(bin)) { continue; }
			const version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
			if (version) {
				return { bin, version, branded: version.startsWith('Google Chrome') && !bin.includes('.cache/puppeteer') };
			}
		} catch { /* not this one */ }
	}
	return null;
}

/**
 * Derive the Chrome extension ID from a base64 manifest `key`.
 * @param {string} base64Key
 * @return {string}
 */
export function extensionIdFromKey(base64Key) {
	const der = Buffer.from(base64Key, 'base64');
	const hash = crypto.createHash('sha256').update(der).digest();
	return [...hash.subarray(0, 16)]
		.map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
		.join('');
}

/**
 * Stage the unpacked dev build (merged Chrome manifest + dev key).
 * @return {{dir: string, extensionId: string}}
 */
export function stageDevBuild() {
	const dir = path.join(ROOT, 'dist', 'chrome-dev');
	fs.rmSync(dir, { recursive: true, force: true });
	fs.cpSync(path.join(ROOT, 'webextension'), dir, { recursive: true });

	// Chrome's manifest icon keys don't accept SVG (manifest/chrome.json's
	// `icons`/`action.default_icon` point at these PNGs, CHROME.md D4) — copy
	// the pre-rasterized set (scripts/rasterize-icons.mjs) into the staged
	// images/ dir, same as scripts/build.mjs's chrome target does for the
	// real build artifact. Without this the CDP install rejects the staged
	// dev build outright ("Could not load icon 'images/icon-16.png'"),
	// blocking every check downstream of "extension installs".
	fs.cpSync(path.join(ROOT, 'assets', 'chrome-icons'), path.join(dir, 'images'), { recursive: true });

	const manifest = mergeManifest('chrome');
	manifest.key = DEV_KEY.key;
	fs.writeFileSync(path.join(dir, 'manifest.json'), serializeManifest(manifest));

	const extensionId = extensionIdFromKey(DEV_KEY.key);
	if (extensionId !== DEV_KEY.id) {
		throw new Error(`dev-key.json id drift: derived ${extensionId}, recorded ${DEV_KEY.id}`);
	}
	return { dir, extensionId };
}

/**
 * Args shared by every Chrome launch in this tier.
 * @param {string} stageDir
 * @return {string[]}
 */
export function chromeArgs(stageDir) {
	return [
		`--disable-extensions-except=${stageDir}`,
		`--load-extension=${stageDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-dev-shm-usage',
	];
}

export const NEWTAB_PATH = 'newTab.html';
