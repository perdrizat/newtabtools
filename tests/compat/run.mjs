#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Compat tier entry point (`pnpm test:compat`, tests/compat/README.md).
 *
 *   node tests/compat/run.mjs [<browser>-<channel> ...] [--accept] [--e2e]
 *
 * For each target (default: every channel of every compat browser): run the
 * probe harness through tests/e2e/run.sh with NTT_CHANNEL set, so the same
 * launcher hook starts that channel's binary; then diff the matrix against
 * tests/compat/expected/<target>.json. `--accept` writes this run's matrix as
 * the new expectation; `--e2e` also runs the E2E suite on the channel.
 * Exits 1 on any diff, harness failure or E2E failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diffMatrix, matrixPath, parseTargets } from './matrix.mjs';
import { e2eArtifactsDir } from '../_browsers/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(ROOT, 'tests/e2e/run.sh');

/** @param {string} file */
function readJson(file) {
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/**
 * @param {string} browser
 * @param {string} channel
 * @param {'compat'|'e2e'} project
 * @param {string[]} args
 */
function runTier(browser, channel, project, args) {
	const r = spawnSync(RUNNER, [browser, ...args], {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, NTT_CHANNEL: channel, NTT_VITEST_PROJECT: project },
	});
	return r.status === 0;
}

function main() {
	const argv = process.argv.slice(2);
	const accept = argv.includes('--accept');
	const withE2E = argv.includes('--e2e');
	const targets = parseTargets(argv.filter(a => !a.startsWith('--')));
	for (const name of ['FIREFOX_BIN', 'CHROME_BIN']) {
		if (process.env[name]) {
			throw new Error(`unset $${name}: the compat tier picks each binary by channel, and an override would mislabel the matrix`);
		}
	}

	let failed = false;
	for (const target of targets) {
		console.log(`\n[compat] === ${target.name} ===`);
		const actualPath = matrixPath('actual', target.name);
		fs.rmSync(actualPath, { force: true });

		if (!runTier(target.browser, target.channel, 'compat', ['tests/compat/harness.test.ts'])) {
			console.error(`[compat] x ${target.name}: probe harness failed (see output above)`);
			failed = true;
			continue;
		}
		const actual = readJson(actualPath);
		if (!actual) {
			console.error(`[compat] x ${target.name}: harness wrote no matrix to ${actualPath}`);
			failed = true;
			continue;
		}

		const expectedPath = matrixPath('expected', target.name);
		const diff = diffMatrix(readJson(expectedPath), actual);
		if (accept) {
			fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
			fs.copyFileSync(actualPath, expectedPath);
			console.log(`[compat] ✓ ${target.name} (${actual.version}): accepted ${diff.length} change(s) into ${path.relative(ROOT, expectedPath)}`);
		} else if (diff.length) {
			failed = true;
			console.log(`[compat] x ${target.name} (${actual.version}): ${diff.length} probe(s) changed. Log it in tests/compat/NOTEBOOK.md, then --accept or work around:`);
			for (const row of diff) {
				const error = actual.probes[row.id]?.error;
				console.log(`  ${row.id.padEnd(28)} ${row.expected.padEnd(7)} -> ${row.actual}${error ? `  (${error})` : ''}`);
			}
		} else {
			console.log(`[compat] ✓ ${target.name} (${actual.version}): matches the expected matrix`);
		}

		if (withE2E) {
			const ok = runTier(target.browser, target.channel, 'e2e', []);
			const keep = path.join(path.dirname(actualPath), `${target.name}-e2e`);
			fs.rmSync(keep, { recursive: true, force: true });
			fs.cpSync(e2eArtifactsDir(target.browser), keep, { recursive: true });
			console.log(`[compat] ${ok ? '✓' : 'x'} ${target.name}: E2E suite ${ok ? 'passed' : 'failed'} (artifacts: ${path.relative(ROOT, keep)})`);
			failed ||= !ok;
		}
	}
	process.exitCode = failed ? 1 : 0;
}

try {
	main();
} catch (err) {
	console.error(`[compat] x ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
}
