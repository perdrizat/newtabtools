/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The single registry of UAT browsers and their per-browser configuration.
 *
 * Every UAT tool resolves its browser here, and nowhere else. Before this
 * module, six files each re-derived the same values with a binary ternary —
 * `UAT_BROWSER === 'chrome' ? <chrome value> : <firefox value>` — so anything
 * that was not exactly "chrome" (a third browser, or a typo like "Chrome")
 * silently got Firefox's port, timeout, artifact dir and URL scheme. One of
 * those copies drifted: mcp-smoke.mjs never learned Chrome's port, so it could
 * not pass in Chrome mode at all.
 *
 * The rules this module enforces:
 *
 *   1. One row per browser. Adding a browser means adding a row here; nothing
 *      else enumerates browsers for configuration.
 *   2. No silent fallback. Unset/empty UAT_BROWSER means the documented
 *      default (firefox); any other unrecognised value throws, listing the
 *      valid names.
 *   3. Tools declare what they implement. A tool with per-browser code passes
 *      `supported`, so registering a new browser makes every tool that has
 *      no code path for it fail at startup, naming itself — instead of
 *      quietly running the Firefox branch.
 *   4. Resolve once, pass it down. Spawn children with `uatChildEnv()`, which
 *      pins UAT_BROWSER and UAT_DAEMON_PORT explicitly so a child never has
 *      to re-derive them.
 *
 * tests/integration/uat-browsers.test.ts guards all four, including that no
 * other file in this directory reads process.env.UAT_BROWSER or hardcodes a
 * daemon port.
 */

/**
 * @typedef {object} UatBrowserProfile
 * @property {number} port            default daemon HTTP port
 * @property {number} healthTimeoutMs how long to wait for the daemon's /health
 * @property {string} artifactSuffix  run-dir suffix, matching the E2E
 *   `_artifacts-<suffix>` dirs
 * @property {string} extensionScheme URL scheme of the extension origin
 */

/** @type {Readonly<Record<string, Readonly<UatBrowserProfile>>>} */
export const UAT_BROWSERS = Object.freeze({
	firefox: Object.freeze({
		port: 9876,
		healthTimeoutMs: 300_000,
		artifactSuffix: 'ff',
		extensionScheme: 'moz-extension',
	}),
	// Chrome's `--headless=new` renders the seed sites much closer to real
	// Chrome (full JS/ads/trackers) than Firefox's classic `-headless`, so the
	// same environment seed measurably takes longer per site — a real timing
	// difference, not a hang. Hence double the health budget.
	chrome: Object.freeze({
		port: 9877,
		healthTimeoutMs: 600_000,
		artifactSuffix: 'cft',
		extensionScheme: 'chrome-extension',
	}),
});

export const DEFAULT_UAT_BROWSER = 'firefox';

/**
 * Ports the E2E tiers' browsers listen on (tests/e2e/run_esr_tests.sh and
 * tests/e2e-chrome/run_chrome_tests.sh). No UAT daemon may take one.
 */
export const RESERVED_E2E_PORTS = Object.freeze([9222, 9223]);

const NAMES = Object.keys(UAT_BROWSERS);

/**
 * @param {string} name
 * @returns {Readonly<UatBrowserProfile>}
 */
export function uatBrowserProfile(name) {
	if (!NAMES.includes(name)) {
		throw new Error(`unknown UAT_BROWSER "${name}" — expected one of: ${NAMES.join(', ')} (case-sensitive)`);
	}
	return UAT_BROWSERS[name];
}

/**
 * @typedef {UatBrowserProfile & { browser: string }} UatEnv
 */

/**
 * Resolve the browser and its configuration for this process.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env] defaults to process.env
 * @param {string} [options.tool] the calling tool's name, for error messages
 * @param {string[]} [options.supported] the browsers this tool implements;
 *   omit for browser-agnostic tools
 * @returns {UatEnv}
 */
export function resolveUatEnv({ env = process.env, tool = 'UAT tool', supported } = {}) {
	if (supported) {
		const unregistered = supported.filter(name => !NAMES.includes(name));
		if (unregistered.length) {
			throw new Error(`${tool} declares support for unregistered browser(s): ${unregistered.join(', ')}`);
		}
	}

	const browser = env.UAT_BROWSER || DEFAULT_UAT_BROWSER;
	const profile = uatBrowserProfile(browser);

	if (supported && !supported.includes(browser)) {
		throw new Error(`${tool} does not implement UAT_BROWSER "${browser}" (it supports: ${supported.join(', ')})`);
	}

	let port = profile.port;
	if (env.UAT_DAEMON_PORT !== undefined && env.UAT_DAEMON_PORT !== '') {
		port = Number(env.UAT_DAEMON_PORT);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`invalid UAT_DAEMON_PORT "${env.UAT_DAEMON_PORT}" — expected an integer 1-65535`);
		}
	}

	return { ...profile, browser, port };
}

/**
 * The environment for a child UAT process, with the resolved browser and port
 * pinned explicitly so the child never re-derives them.
 *
 * @param {UatEnv} uat
 * @param {Record<string, string | undefined>} [env] defaults to process.env
 * @param {Record<string, string>} [extra] merged last
 * @returns {Record<string, string | undefined>}
 */
export function uatChildEnv(uat, env = process.env, extra = {}) {
	return { ...env, UAT_BROWSER: uat.browser, UAT_DAEMON_PORT: String(uat.port), ...extra };
}
