#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The single registry of test browsers and their per-tier configuration,
 * shared by the E2E and UAT tiers (and the compat tier, when it lands).
 *
 * Naming: a browser is always spelled by its registry key (`firefox`,
 * `chrome`) — in directory names (`tests/_browsers/<browser>/`,
 * `tests/e2e/_artifacts/<browser>/`, `tests/uat/artifacts/<stamp>-<browser>/`),
 * pnpm script suffixes (`test:e2e:<browser>`) and the `NTT_BROWSER` selector.
 * The channel (esr/release, stable/cft) is a separate axis: each tier's
 * default channel lives here (CHROME.md Decision 12: the frequent E2E tier
 * runs the production binary, the pre-release UAT tier the current one), and
 * the per-browser env module (`firefox/firefox-env.mjs`,
 * `chrome/chrome-env.mjs`) turns a channel into a binary. `$FIREFOX_BIN` /
 * `$CHROME_BIN` override the binary for whichever tier is running.
 *
 * The rules this module enforces:
 *
 *   1. One row per browser. Adding a browser means adding a row here plus a
 *      `tests/_browsers/<browser>/` dir with its env module and `e2e.sh`
 *      launcher hook; nothing else enumerates browsers for configuration.
 *   2. No silent fallback. Unset/empty NTT_BROWSER means the documented
 *      default (firefox); any other unrecognised value throws, listing the
 *      valid names. The renamed variables (UAT_BROWSER, NTT_E2E_BROWSER,
 *      FIREFOX_ESR_BIN) throw too, rather than being ignored.
 *   3. Tools declare what they implement. A tool with per-browser code passes
 *      `supported`, so registering a new browser makes every tool that has
 *      no code path for it fail at startup, naming itself.
 *   4. Resolve once, pass it down. Spawn children with `browserChildEnv()`.
 *   5. Branch on `engine`, not the browser name, where behaviour follows the
 *      engine (a Chromium-based browser inherits Chrome's handling).
 *
 * tests/integration/browser-registry.test.ts guards all of these, including
 * that no tool reads process.env.NTT_BROWSER directly or hardcodes a port.
 *
 * CLI (for shell runners): `node registry.mjs shell-env <tier>` prints
 * `export NAME='value'` lines for the browser named by $NTT_BROWSER.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @typedef {object} TierProfile
 * @property {string} channel           default channel the tier runs on
 * @property {number} port              the tier's fixed debugging/daemon port
 * @property {number} [healthTimeoutMs] UAT only: how long to wait for the daemon's /health
 */

/**
 * @typedef {object} BrowserProfile
 * @property {'gecko'|'chromium'|'webkit'} engine
 * @property {string} extensionScheme URL scheme of the extension origin
 * @property {Readonly<Record<'e2e'|'uat', Readonly<TierProfile>>>} tiers
 */

/** @type {readonly ('e2e'|'uat')[]} */
export const TIERS = Object.freeze(['e2e', 'uat']);

/** @type {Readonly<Record<string, Readonly<BrowserProfile>>>} */
export const BROWSERS = Object.freeze({
	firefox: Object.freeze({
		engine: 'gecko',
		extensionScheme: 'moz-extension',
		tiers: Object.freeze({
			e2e: Object.freeze({ channel: 'esr', port: 9222 }),
			uat: Object.freeze({ channel: 'release', port: 9876, healthTimeoutMs: 300_000 }),
		}),
	}),
	// `stable` = branded Google Chrome (CfT fallback when none is installed);
	// `cft` = Chrome for Testing, the only Chrome Selenium can drive with an
	// extension (chrome-env.mjs). Chrome's `--headless=new` renders the UAT
	// seed sites much closer to real Chrome than Firefox's `-headless`, so
	// the same seed takes longer per site: hence double the health budget.
	chrome: Object.freeze({
		engine: 'chromium',
		extensionScheme: 'chrome-extension',
		tiers: Object.freeze({
			e2e: Object.freeze({ channel: 'stable', port: 9223 }),
			uat: Object.freeze({ channel: 'cft', port: 9877, healthTimeoutMs: 600_000 }),
		}),
	}),
});

export const DEFAULT_BROWSER = 'firefox';

const NAMES = Object.keys(BROWSERS);

/** Variables renamed by the 2026-10-26 naming harmonization, and their successors. */
const RENAMED_ENV = Object.freeze({
	UAT_BROWSER: 'NTT_BROWSER',
	NTT_E2E_BROWSER: 'NTT_BROWSER',
	FIREFOX_ESR_BIN: 'FIREFOX_BIN',
});

/**
 * @param {string} name
 * @returns {Readonly<BrowserProfile>}
 */
export function browserProfile(name) {
	if (!NAMES.includes(name)) {
		throw new Error(`unknown NTT_BROWSER "${name}" — expected one of: ${NAMES.join(', ')} (case-sensitive)`);
	}
	return BROWSERS[name];
}

/**
 * Every registered browser's port on one tier, in registry order.
 * @param {'e2e'|'uat'} tier
 * @returns {number[]}
 */
export function tierPorts(tier) {
	return NAMES.map(name => BROWSERS[name].tiers[tier].port);
}

/**
 * @typedef {object} BrowserEnv
 * @property {string} browser
 * @property {'e2e'|'uat'} tier
 * @property {'gecko'|'chromium'|'webkit'} engine
 * @property {string} extensionScheme
 * @property {string} channel
 * @property {number} port
 * @property {number} [healthTimeoutMs]
 */

/**
 * Resolve the browser and its tier configuration for this process.
 *
 * @param {object} options
 * @param {'e2e'|'uat'} options.tier
 * @param {Record<string, string | undefined>} [options.env] defaults to process.env
 * @param {string} [options.tool] the calling tool's name, for error messages
 * @param {string[]} [options.supported] the browsers this tool implements;
 *   omit for browser-agnostic tools
 * @returns {BrowserEnv}
 */
export function resolveBrowserEnv({ tier, env = process.env, tool = 'test tool', supported } = /** @type {any} */ ({})) {
	if (!tier) {
		throw new Error(`${tool}: resolveBrowserEnv needs a tier (${TIERS.join(' | ')})`);
	}
	if (!TIERS.includes(tier)) {
		throw new Error(`${tool}: unknown tier "${tier}" — expected one of: ${TIERS.join(', ')}`);
	}
	for (const [old, replacement] of Object.entries(RENAMED_ENV)) {
		if (env[old]) {
			throw new Error(`$${old} was renamed to $${replacement} — set that instead (tests/_browsers/registry.mjs)`);
		}
	}
	if (supported) {
		const unregistered = supported.filter(name => !NAMES.includes(name));
		if (unregistered.length) {
			throw new Error(`${tool} declares support for unregistered browser(s): ${unregistered.join(', ')}`);
		}
	}

	const browser = env.NTT_BROWSER || DEFAULT_BROWSER;
	const profile = browserProfile(browser);

	if (supported && !supported.includes(browser)) {
		throw new Error(`${tool} does not implement NTT_BROWSER "${browser}" (it supports: ${supported.join(', ')})`);
	}

	const tierProfile = profile.tiers[tier];
	let port = tierProfile.port;
	if (tier === 'uat' && env.UAT_DAEMON_PORT !== undefined && env.UAT_DAEMON_PORT !== '') {
		port = Number(env.UAT_DAEMON_PORT);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`invalid UAT_DAEMON_PORT "${env.UAT_DAEMON_PORT}" — expected an integer 1-65535`);
		}
	}

	return {
		browser,
		tier,
		engine: profile.engine,
		extensionScheme: profile.extensionScheme,
		...tierProfile,
		port,
	};
}

/**
 * The environment for a child process, with the resolved browser (and, on
 * the uat tier, the daemon port) pinned explicitly so the child never
 * re-derives them.
 *
 * @param {BrowserEnv} resolved
 * @param {Record<string, string | undefined>} [env] defaults to process.env
 * @param {Record<string, string>} [extra] merged last
 * @returns {Record<string, string | undefined>}
 */
export function browserChildEnv(resolved, env = process.env, extra = {}) {
	const pinned = { NTT_BROWSER: resolved.browser };
	if (resolved.tier === 'uat') {
		Object.assign(pinned, { UAT_DAEMON_PORT: String(resolved.port) });
	}
	return { ...env, ...pinned, ...extra };
}

/**
 * Per-browser E2E artifacts dir, so the browsers' runs of the same test files
 * can go concurrently without racing on fixtures/screenshots.
 * @param {string} browser
 * @returns {string}
 */
export function e2eArtifactsDir(browser) {
	browserProfile(browser);
	return path.join(ROOT, 'tests/e2e/_artifacts', browser);
}

/**
 * Full extension-origin URL to the new tab page.
 * @param {string} id Firefox's per-profile moz-extension UUID, or Chrome's
 *   deterministic dev-key extension id
 * @param {string} [browser] a registered browser name, default firefox
 * @returns {string}
 */
export function newTabURL(id, browser = DEFAULT_BROWSER) {
	return `${browserProfile(browser).extensionScheme}://${id}/newTab.html`;
}

/** @param {string} value */
function shellQuote(value) {
	return `'${String(value).replace(/'/g, '\'\\\'\'')}'`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, tier] = process.argv.slice(2);
	try {
		if (command !== 'shell-env') {
			throw new Error('usage: registry.mjs shell-env <tier>');
		}
		const resolved = resolveBrowserEnv({ tier: /** @type {'e2e'|'uat'} */ (tier), tool: 'registry.mjs shell-env' });
		const vars = {
			NTT_BROWSER: resolved.browser,
			NTT_ENGINE: resolved.engine,
			NTT_CHANNEL: resolved.channel,
			...(tier === 'e2e'
				? { NTT_E2E_PORT: resolved.port, NTT_E2E_ARTIFACTS_DIR: e2eArtifactsDir(resolved.browser) }
				: { UAT_DAEMON_PORT: resolved.port }),
		};
		for (const [name, value] of Object.entries(vars)) {
			console.log(`export ${name}=${shellQuote(String(value))}`);
		}
	} catch (err) {
		console.error(`[registry] x ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	}
}
