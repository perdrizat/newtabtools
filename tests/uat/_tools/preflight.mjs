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
	if (major >= 24) {
		ok('Node', `${process.version} (≥ 24)`);
	} else {
		fail('Node', `${process.version} — need ≥ 24 (see .node-version); update via fnm/nvm`);
	}
}

// 2. pnpm version
{
	try {
		const out = execSync('pnpm --version', { encoding: 'utf8' }).trim();
		const major = parseInt(out.split('.')[0], 10);
		if (major >= 11) {
			ok('pnpm', `${out} (≥ 11)`);
		} else {
			fail('pnpm', `${out} — need ≥ 11; corepack prepare pnpm@11.6.0 --activate`);
		}
	} catch {
		fail('pnpm', 'not found on PATH — corepack enable && corepack prepare pnpm@11.6.0 --activate');
	}
}

// 3. Firefox release binary — must exist AND report a clean version. geckodriver
//    validates the binary by parsing `<bin> --version`; a wrapper that emits noise
//    (e.g. Ubuntu's snap shim with xdg-utils missing → "xdg-settings: not found")
//    makes geckodriver reject it as "binary is not a Firefox executable". We catch
//    that here with an actionable message instead of a daemon-startup stack trace.
{
	const envBin = process.env.FIREFOX_BIN;
	let bin = null;
	if (envBin) {
		if (fs.existsSync(envBin)) {
			bin = envBin;
		} else {
			fail('Firefox (release)', `$FIREFOX_BIN points to ${envBin} but file does not exist`);
		}
	} else {
		bin = which('firefox');
		if (!bin) {
			fail('Firefox (release)', 'not found — set $FIREFOX_BIN or install via the Mozilla APT repo');
		}
	}
	if (bin) {
		const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
		const combined = `${r.stdout || ''}${r.stderr || ''}`;
		const versionLine = (r.stdout || '').match(/Mozilla Firefox \d+\.\S+/);
		const wrapperNoise = /xdg-settings|requires the firefox snap|: not found/i.test(combined);
		const where = envBin ? 'via $FIREFOX_BIN' : 'PATH';
		if (r.status !== 0 || !versionLine) {
			fail('Firefox (release)', `${bin} did not report a Firefox version via \`--version\` ` +
				`(got: ${combined.trim().slice(0, 120) || 'no output'}). The binary may be a broken wrapper — ` +
				'use the Mozilla APT build or point $FIREFOX_BIN at a real Firefox binary.');
		} else if (wrapperNoise) {
			const noise = combined.trim().split('\n').filter(l => l && !/Mozilla Firefox/.test(l)).join(' | ');
			fail('Firefox (release)', `${bin} runs, but \`--version\` emits wrapper noise that makes ` +
				`geckodriver reject it ("binary is not a Firefox executable"):\n         ${noise}\n         ` +
				'Likely the Ubuntu snap shim with xdg-utils missing — install xdg-utils, use the Mozilla APT build, or set $FIREFOX_BIN.');
		} else {
			// MV3_MIGRATION.md Slice D: tabs.captureVisibleTab is `undefined`
			// under MV3 on every Firefox build through 151.0 (spike/bisect) and
			// a working function from 152.0 — fail fast here with an actionable
			// message instead of letting the capture E2E/UAT scenarios time out
			// obscurely on an under-versioned binary.
			const versionMatch = versionLine[0].match(/Mozilla Firefox (\d+)\.(\d+)/);
			const majorVersion = versionMatch ? parseInt(versionMatch[1], 10) : NaN;
			if (Number.isNaN(majorVersion) || majorVersion < 152) {
				fail('Firefox (release)', `${versionLine[0]} is below the minimum required version (152) — ` +
					'MV3 tabs.captureVisibleTab does not exist below Firefox 152 (see MV3_MIGRATION.md spike). ' +
					'Install a newer release build or point $FIREFOX_BIN at one.');
			} else {
				ok('Firefox (release)', `${versionLine[0]} (${bin}, ${where})`);
			}
		}
	}
}

// 3b. Real geckodriver+Firefox launch handshake — the EXACT path the daemon uses
//     (`new Builder().forBrowser('firefox').build()`). A passing `firefox
//     --version` does NOT guarantee this works: geckodriver applies stricter
//     binary validation AND is a second dependency check #3 never touches. The
//     classic trap is a snap-confined geckodriver (on PATH as
//     /snap/bin/geckodriver) that cannot launch a Firefox outside its sandbox
//     and rejects it as "binary is not a Firefox executable". Launch headless →
//     about:blank → quit, so this failure class surfaces here in seconds instead
//     of as a 300s daemon-startup timeout.
{
	let driver = null;
	try {
		const { Builder } = await import('selenium-webdriver');
		const firefox = (await import('selenium-webdriver/firefox.js')).default;
		const opts = new firefox.Options();
		if (process.env.FIREFOX_BIN) { opts.setBinary(process.env.FIREFOX_BIN); }
		opts.addArguments('-headless');
		const t0 = Date.now();
		driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
		await driver.get('about:blank');
		ok('Firefox launch (geckodriver)', `headless launch OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	} catch (e) {
		const msg = (e && e.message ? e.message : String(e)).split('\n')[0];
		fail('Firefox launch (geckodriver)',
			`Selenium could not start Firefox via geckodriver: ${msg}\n` +
			'         This is the exact launch path the UAT daemon uses. Common causes:\n' +
			'         • a snap-confined geckodriver on PATH (/snap/bin/geckodriver) cannot launch a\n' +
			'           Firefox outside its sandbox — remove it so Selenium Manager auto-downloads a\n' +
			'           non-snap geckodriver, or put a non-snap one earlier on PATH;\n' +
			'         • a geckodriver/Firefox version mismatch;\n' +
			'         • selenium-webdriver not installed — run `pnpm install`.');
	} finally {
		if (driver) { try { await driver.quit(); } catch { /* already down */ } }
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
