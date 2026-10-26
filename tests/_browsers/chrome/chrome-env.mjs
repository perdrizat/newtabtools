/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared Chrome plumbing for the E2E and UAT tiers (CHROME.md D1/D5).
 *
 * - `resolveChromeBinary({ channel })` — $CHROME_BIN, then the channel's
 *   search order (the tier's channel comes from tests/_browsers/registry.mjs).
 * - `stageDevBuild()` — stages an UNPACKED dev build under dist/dev/chrome/:
 *   the Chrome stage of scripts/stage.mjs (webextension/ + overlays/chrome/ +
 *   the merged manifest) plus an injected dev-only `key`, so the
 *   extension ID is deterministic across every profile and machine.
 *
 * The dev key (`dev-key.json`) is a committed PUBLIC key only: Chrome derives
 * the extension ID from the manifest `key` field (SHA-256 of the DER SPKI,
 * first 16 bytes mapped onto a-p); no private key is needed to LOAD an
 * unpacked extension, so none was kept. The key must never reach a store
 * artifact — `pnpm build:chrome` does not include it; only this staging path
 * injects it (asserted by tests/unit/manifest-authoring.test.ts's overlay
 * shape checks staying key-free).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DIST, stageBuild } from '../../../scripts/stage.mjs';
import { TIERS } from '../registry.mjs';

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
 * `pnpm provision:chrome` populates this cache.
 *
 * Historical note (D1, 2026-07-15): branded Google Chrome >= 137 was found to
 * ignore `--load-extension` outright, and the CDP install path was believed
 * to leave the extension inert too — so CfT was preferred over any branded
 * binary everywhere. **Amended 2026-07-18 (D1 amendment / CHROME.md Decision
 * 12):** the CDP-install half doesn't reproduce on branded stable 150 —
 * `browser.installExtension()` over the PIPE transport plus
 * `--enable-unsafe-extension-debugging` installs and runs the extension fine
 * on branded (`--load-extension` alone is still dead there). The `cft`
 * channel (CfT-first) remains the default for UAT/smoke callers (Selenium,
 * which those use, still can't drive branded — the CDP `Extensions` domain is
 * pipe-only); the Chrome E2E launcher (`launch-chrome.mjs`) runs the
 * registry's `stable` channel (branded-first).
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

/** The Chrome channels `resolveChromeBinary` knows (registry tiers name one each). */
export const CHROME_CHANNELS = Object.freeze(['stable', 'cft']);

/**
 * Locate a runnable Chrome binary.
 *
 * `opts.channel` selects the search order (CHROME.md Decision 12):
 *   - `'cft'` (default): $CHROME_BIN → Chrome for Testing (newest cached) →
 *     branded/chromium as a last resort. The UAT tier (Selenium) can't drive
 *     branded Chrome (the CDP `Extensions` domain is pipe-only), so it needs
 *     CfT preferred.
 *   - `'stable'`: $CHROME_BIN → google-chrome-stable/google-chrome (branded)
 *     → Chrome for Testing (fallback lane, when no branded binary exists) →
 *     chromium as a last resort. The E2E tier's production-binary lane.
 * @param {{channel?: string}} [opts]
 * @return {{bin: string, version: string, branded: boolean} | null}
 */
export function resolveChromeBinary({ channel = 'cft' } = {}) {
	if (!CHROME_CHANNELS.includes(channel)) {
		throw new Error(`unknown Chrome channel "${channel}" — expected one of: ${CHROME_CHANNELS.join(', ')}`);
	}
	const cft = cftCandidates();
	const branded = ['google-chrome-stable', 'google-chrome'];
	const chromium = ['chromium', 'chromium-browser'];
	const ordered = channel === 'stable'
		? [process.env.CHROME_BIN, ...branded, ...cft, ...chromium]
		: [process.env.CHROME_BIN, ...cft, ...branded, ...chromium];
	// Filtering with a type-guard (not bare `Boolean`) so tsc narrows
	// `(string | undefined)[]` to `string[]` — needed once this file gets
	// imported (not just run) by a checked .ts consumer (D5b, _helpers.ts).
	const candidates = ordered.filter((c) => typeof c === 'string');
	for (const candidate of candidates) {
		let bin = '';
		try {
			// Puppeteer requires an ABSOLUTE executablePath — resolve bare names via PATH.
			bin = path.isAbsolute(candidate)
				? candidate
				: execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
			if (!bin || !fs.existsSync(bin)) { continue; }
			const version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
			if (version) {
				return { bin, version, branded: version.startsWith('Google Chrome') && !bin.includes('.cache/puppeteer') };
			}
		} catch (err) {
			if (bin && fs.existsSync(bin)) {
				console.warn(`[chrome-env] candidate ${bin} failed verification: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}
	return null;
}

/**
 * CfT staleness guard (CHROME.md Decision 12): the cached Chrome for Testing
 * and the user's branded stable drift apart in BOTH directions (this box,
 * 2026-07-18: CfT 151 cached vs branded stable 150 installed — CfT's
 * "stable" label can run AHEAD of the rollout users actually have). Compares
 * the given CfT version's major against the locally installed branded
 * Chrome's major and returns a human-readable warning on mismatch, or null
 * when they match / no branded binary exists / either version is unparsable.
 * Callers (provision:chrome, the UAT preflight) print it as a warning, never
 * a hard failure — drift is a fidelity signal, not an error.
 * @param {string} cftVersion any string containing the CfT version (e.g.
 *   "Google Chrome for Testing 151.0.7922.34" or a bare "151.0.7922.34").
 * @return {string | null}
 */
export function cftStalenessWarning(cftVersion) {
	const cftMajor = parseInt((String(cftVersion).match(/(\d+)\.\d+\.\d+/) || [])[1] ?? '', 10);
	if (!Number.isFinite(cftMajor)) { return null; }
	for (const name of ['google-chrome-stable', 'google-chrome']) {
		try {
			const v = execFileSync(name, ['--version'], { encoding: 'utf8' }).trim();
			const m = v.match(/Google Chrome (\d+)\./);
			if (!m) { continue; }
			const brandedMajor = parseInt(m[1], 10);
			if (brandedMajor === cftMajor) { return null; }
			return `cached CfT is major ${cftMajor} but the local branded stable is ${brandedMajor} (${v}) — `
				+ 'the two lanes are testing different Chrome majors; re-run `pnpm provision:chrome` to resync '
				+ '(CHROME.md Decision 12, CfT staleness guard)';
		} catch { /* no branded binary under this name — try the next */ }
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

/** Where `stageDevBuild()` stages by default: `pnpm dev:chrome`'s "Load unpacked" dir. */
export const DEV_STAGE_DIR = path.join(DIST, 'dev', 'chrome');

/**
 * A test tier's own stage dir. Chrome runs the extension straight from the
 * stage, so two tiers sharing one would delete each other's mid-run.
 * @param {string} tier one of the registry's TIERS
 * @return {string}
 */
export function tierStageDir(tier) {
	if (!(/** @type {readonly string[]} */ (TIERS)).includes(tier)) {
		throw new Error(`unknown tier "${tier}" — expected one of: ${TIERS.join(', ')}`);
	}
	return path.join(DIST, '_stage', `chrome-${tier}`);
}

/**
 * Stage the unpacked dev build: the same Chrome stage as the store package
 * (scripts/stage.mjs) plus the dev key.
 * @param {{dir?: string}} [opts]
 * @return {{dir: string, extensionId: string}}
 */
export function stageDevBuild({ dir = DEV_STAGE_DIR } = {}) {
	stageBuild('chrome', dir, { patchManifest: m => ({ ...m, key: DEV_KEY.key }) });

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
		'--no-sandbox',
	];
}

export const NEWTAB_PATH = 'newTab.html';
