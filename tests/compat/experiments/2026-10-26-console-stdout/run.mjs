#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Experiment (2026-10-26): can Firefox's console-to-stdout prefs stand in for
 * the BiDi console/pageerror events that never fire on moz-extension:// pages
 * (NOTEBOOK.md section 3)? Result and decision: README.md next to this file.
 *
 *   node tests/compat/experiments/2026-10-26-console-stdout/run.mjs [esr|release] [content|chrome]
 *
 * Launches its own Firefox (own profile, random BiDi port), so it can run
 * alongside the E2E tiers. Opens the new-tab page, emits marker messages
 * (console.error, console.log, an uncaught exception, a rejected promise) and
 * reports which markers reached Firefox's stdout/stderr.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveFirefoxBinary } from '../../../_browsers/firefox/firefox-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT_DIR = path.join(ROOT, 'tests/compat/_artifacts');
const channel = process.argv[2] || 'esr';
// Which of the two prefs to set: content, chrome or both (default).
const prefs = process.argv[3] === 'content' || process.argv[3] === 'chrome' ? [process.argv[3]] : ['content', 'chrome'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MARKERS = {
	'console.error': 'ntt-exp-console-error',
	'console.log': 'ntt-exp-console-log',
	'uncaught exception': 'ntt-exp-uncaught',
	'unhandled rejection': 'ntt-exp-rejection',
};

async function main() {
	const { bin } = resolveFirefoxBinary({ channel });
	if (!bin) {
		throw new Error(`no Firefox binary for channel ${channel}`);
	}
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const profile = path.join(OUT_DIR, `console-stdout-${channel}-profile`);
	fs.rmSync(profile, { recursive: true, force: true });
	fs.mkdirSync(profile);

	let log = '';
	const child = spawn(path.join(ROOT, 'node_modules/.bin/web-ext'), [
		'run', '--verbose', '--source-dir', 'webextension/', `--firefox=${bin}`,
		'--firefox-profile', profile, '--keep-profile-changes',
		...prefs.map(p => `--pref=devtools.console.stdout.${p}=true`),
		'--args=--remote-debugging-port', '--args=0', '--args=-headless', '--args=--remote-allow-system-access',
	], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
	child.stdout.on('data', d => { log += d; });
	child.stderr.on('data', d => { log += d; });

	try {
		let port;
		for (let i = 0; i < 60 && !port; i++) {
			port = /WebDriver BiDi listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1];
			await sleep(500);
		}
		if (!port) {
			throw new Error('Firefox never reported its BiDi port');
		}
		let uuid;
		for (let i = 0; i < 30 && !uuid; i++) {
			const prefs = fs.existsSync(path.join(profile, 'prefs.js')) ? fs.readFileSync(path.join(profile, 'prefs.js'), 'utf8') : '';
			uuid = /newtabtools@symlink\.ch\\":\\"([0-9a-f-]+)/.exec(prefs)?.[1];
			await sleep(500);
		}
		if (!uuid) {
			throw new Error('extension UUID not found in prefs.js');
		}

		const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}/session`, protocol: 'webDriverBiDi' });
		const page = await browser.newPage();
		const url = `moz-extension://${uuid}/newTab.html`;
		page.goto(url, { timeout: 3_000 }).catch(() => {});
		for (let i = 0; i < 100; i++) {
			const href = await page.evaluate(() => location.href).catch(() => '');
			if (href.startsWith(url)) {
				break;
			}
			await sleep(100);
		}
		await sleep(1_000);
		const before = log.length;
		await page.evaluate(m => {
			console.error(m['console.error']);
			console.log(m['console.log']);
			setTimeout(() => { throw new Error(m['uncaught exception']); }, 0);
			Promise.reject(new Error(m['unhandled rejection']));
		}, MARKERS);
		await sleep(2_000);
		await browser.disconnect();

		const after = log.slice(before);
		console.log(`Firefox ${channel} (${bin}), devtools.console.stdout.{${prefs.join(',')}} = true:`);
		for (const [what, marker] of Object.entries(MARKERS)) {
			console.log(`  ${after.includes(marker) ? 'delivered' : 'missing  '}  ${what}`);
		}
		const logFile = path.join(OUT_DIR, `console-stdout-${channel}-${prefs.join('-')}.log`);
		fs.writeFileSync(logFile, log);
		console.log(`full Firefox output: ${path.relative(ROOT, logFile)}`);
	} finally {
		// Firefox keeps writing the profile until it has exited, so wait for that.
		const exited = new Promise(r => child.once('exit', r));
		child.kill('SIGTERM');
		await Promise.race([exited, sleep(10_000)]);
		await sleep(1_000);
		fs.rmSync(profile, { recursive: true, force: true });
	}
}

main().catch(err => {
	console.error(`[experiment] x ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
});
