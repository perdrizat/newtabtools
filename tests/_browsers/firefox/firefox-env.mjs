#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Firefox binary resolution, shared by the E2E launcher hook (`e2e.sh`) and
 * the UAT tools. The tier picks a channel (tests/_browsers/registry.mjs);
 * this maps the channel to a binary. `$FIREFOX_BIN` overrides it for
 * whichever tier is running (e.g. `FIREFOX_BIN=firefox pnpm test:e2e:firefox`
 * previews release-only driver gates on the E2E suite — see
 * tests/compat/NOTEBOOK.md).
 *
 * CLI: `node firefox-env.mjs <channel>` prints the resolved absolute path, or
 * exits 1 with an actionable message.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Binary name per channel, as the Mozilla APT repo installs them. */
export const FIREFOX_CHANNEL_BINARIES = Object.freeze({
	esr: 'firefox-esr',
	release: 'firefox',
});

/**
 * @typedef {object} FirefoxBinary
 * @property {string | null} bin absolute path, or null when not found
 * @property {string} name the binary name searched for (or $FIREFOX_BIN's value)
 * @property {'$FIREFOX_BIN' | 'PATH'} source
 */

/**
 * @param {object} options
 * @param {string} options.channel a key of FIREFOX_CHANNEL_BINARIES
 * @param {Record<string, string | undefined>} [options.env] defaults to process.env
 * @returns {FirefoxBinary}
 */
export function resolveFirefoxBinary({ channel, env = process.env }) {
	if (env.FIREFOX_BIN) {
		const name = env.FIREFOX_BIN;
		const bin = path.isAbsolute(name) ? (fs.existsSync(name) ? name : null) : which(name);
		return { bin, name, source: '$FIREFOX_BIN' };
	}
	const name = /** @type {Record<string, string>} */ (FIREFOX_CHANNEL_BINARIES)[channel];
	if (!name) {
		throw new Error(`unknown Firefox channel "${channel}" — expected one of: ${Object.keys(FIREFOX_CHANNEL_BINARIES).join(', ')}`);
	}
	return { bin: which(name), name, source: 'PATH' };
}

/**
 * @param {string} cmd
 * @returns {string | null}
 */
function which(cmd) {
	const r = spawnSync('which', [cmd], { encoding: 'utf8' });
	return r.status === 0 ? r.stdout.trim() : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const channel = process.argv[2];
	try {
		const found = resolveFirefoxBinary({ channel });
		if (!found.bin) {
			const hint = found.source === '$FIREFOX_BIN'
				? 'point $FIREFOX_BIN at a real Firefox binary'
				: `install Firefox ${channel} (Mozilla APT repo, see TESTING.md) or set $FIREFOX_BIN`;
			throw new Error(`'${found.name}' (${found.source}) not found — ${hint}.`);
		}
		console.log(found.bin);
	} catch (err) {
		console.error(`[firefox-env] x ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	}
}
