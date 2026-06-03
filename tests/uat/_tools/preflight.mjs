#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * UAT preflight — env validation before runner.mjs spawns Claude.
 *
 * Runs ALL checks, collects results, then exits 0 (all green) or 1 (any fail).
 * Warnings do not fail preflight but surface for user attention.
 *
 * Output mirrors pre_commit_check.sh: section header, per-check lines with
 * [ok] / [warn] / [fail] + actionable detail.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

// SHA-256 of tests/uat/newtabtools_knowngood.zip — bump when fixtureVersion
// changes. Source of truth: tests/uat/README.md "fixtureVersion" section.
const FIXTURE_SHA256 = '07e89b741dcc388eaa209740265698c46a1e09eb274e873e97750bf411339348';

let failed = false;
let warned = false;

const ok = (name, detail) => console.log(`  [ok]   ${name}${detail ? ': ' + detail : ''}`);
const fail = (name, detail) => { console.log(`  [fail] ${name}${detail ? ': ' + detail : ''}`); failed = true; };
const warn = (name, detail) => { console.log(`  [warn] ${name}${detail ? ': ' + detail : ''}`); warned = true; };

function which(cmd) {
	const r = spawnSync('which', [cmd], { encoding: 'utf8' });
	return r.status === 0 ? r.stdout.trim() : null;
}

console.log('=== UAT preflight ===');
console.log();

// 1. Node version
{
	const major = parseInt(process.version.slice(1).split('.')[0], 10);
	if (major >= 22) {
		ok('Node', `${process.version} (≥ 22)`);
	} else {
		fail('Node', `${process.version} — need ≥ 22 (see .node-version); update via fnm/nvm`);
	}
}

// 2. pnpm version
{
	try {
		const out = execSync('pnpm --version', { encoding: 'utf8' }).trim();
		const major = parseInt(out.split('.')[0], 10);
		if (major >= 10) {
			ok('pnpm', `${out} (≥ 10)`);
		} else {
			fail('pnpm', `${out} — need ≥ 10; corepack prepare pnpm@10.0.0 --activate`);
		}
	} catch {
		fail('pnpm', 'not found on PATH — corepack enable && corepack prepare pnpm@10.0.0 --activate');
	}
}

// 3. Firefox release binary
{
	const envBin = process.env.FIREFOX_BIN;
	if (envBin) {
		if (fs.existsSync(envBin)) {
			ok('Firefox (release)', `${envBin} (via $FIREFOX_BIN)`);
		} else {
			fail('Firefox (release)', `$FIREFOX_BIN points to ${envBin} but file does not exist`);
		}
	} else {
		const ff = which('firefox');
		if (ff) {
			ok('Firefox (release)', `${ff} (PATH)`);
		} else {
			fail('Firefox (release)', 'not found — set $FIREFOX_BIN or install via Mozilla APT repo');
		}
	}
}

// 4. .xpi built for current manifest version
{
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	const xpiPath = path.join(ROOT, `dist/newtab_powertools-${pkg.version}.zip`);
	const xpiName = path.basename(xpiPath);
	if (!fs.existsSync(xpiPath)) {
		fail('Built .xpi', `${xpiName} not found in dist/ — run \`pnpm build\``);
	} else {
		const xpiMtime = fs.statSync(xpiPath).mtimeMs;
		const manifestMtime = fs.statSync(path.join(ROOT, 'webextension/manifest.json')).mtimeMs;
		if (xpiMtime < manifestMtime) {
			warn('Built .xpi', `${xpiName} is older than manifest.json — re-run \`pnpm build\``);
		} else {
			ok('Built .xpi', xpiName);
		}
	}
}

// 5. UAT fixture sha256 matches recorded value
{
	const fixturePath = path.join(ROOT, 'tests/uat/newtabtools_knowngood.zip');
	if (!fs.existsSync(fixturePath)) {
		fail('UAT fixture', `${path.basename(fixturePath)} missing — re-clone or restore`);
	} else {
		const hash = createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex');
		if (hash === FIXTURE_SHA256) {
			ok('UAT fixture', `sha256 matches (${hash.slice(0, 12)}…)`);
		} else {
			fail('UAT fixture',
				`sha256 mismatch — got ${hash.slice(0, 12)}…, expected ${FIXTURE_SHA256.slice(0, 12)}…\n` +
				'         (if intentional: update FIXTURE_SHA256 in preflight.mjs and bump fixtureVersion in tests/uat/README.md)');
		}
	}
}

// 6. claude CLI on PATH
{
	try {
		const out = execSync('claude --version', { encoding: 'utf8' }).trim();
		ok('claude CLI', out);
	} catch {
		fail('claude CLI', 'not found on PATH — install per https://docs.claude.com/claude-code, then `claude /login`');
	}
}

// 7. @modelcontextprotocol/sdk resolvable from this script's location
{
	try {
		require.resolve('@modelcontextprotocol/sdk/server/index.js');
		ok('@modelcontextprotocol/sdk', 'resolvable');
	} catch {
		fail('@modelcontextprotocol/sdk', 'not resolvable — run `pnpm install`');
	}
}

// 8. browser-daemon port is free (and not colliding with E2E's 9222)
{
	const E2E_PORT = 9222; // tests/e2e/run_esr_tests.sh
	const port = parseInt(process.env.UAT_DAEMON_PORT, 10) || 9876;
	if (port === E2E_PORT) {
		fail('UAT daemon port', `${port} collides with E2E's port ${E2E_PORT} — pick another via $UAT_DAEMON_PORT`);
	} else {
		const free = await new Promise((resolve) => {
			const probe = net.createServer();
			probe.once('error', () => resolve(false));
			probe.once('listening', () => probe.close(() => resolve(true)));
			probe.listen(port, '127.0.0.1');
		});
		if (free) {
			ok('UAT daemon port', `${port} free`);
		} else {
			fail('UAT daemon port', `${port} already in use — stop the other process or set $UAT_DAEMON_PORT`);
		}
	}
}

console.log();
if (failed) {
	console.log('=== preflight FAILED — fix the [fail] items above before running UAT ===');
	process.exit(1);
} else if (warned) {
	console.log('=== preflight OK (with warnings) ===');
	process.exit(0);
} else {
	console.log('=== preflight OK ===');
	process.exit(0);
}
