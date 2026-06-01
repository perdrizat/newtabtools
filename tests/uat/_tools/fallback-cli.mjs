#!/usr/bin/env node
// UAT bridge prototype — OPTION B: CLI-over-Bash (the @playwright/cli shape).
//
// A CLI for stateful browser control needs a persistent browser *server* that
// every command attaches to (Playwright CLI does exactly this). So this splits
// into a long-lived daemon that holds ONE Selenium driver, and a thin client
// the agent invokes per step. Screenshots are written to DISK and the client
// prints the path — the agent then Read()s the file when it needs to look.
//
//   node uat_cli_proto.mjs daemon         # long-lived; holds Firefox+driver
//   node uat_cli_proto.mjs nav <url>
//   node uat_cli_proto.mjs shot <name>    # -> writes PNG to disk, prints path+bytes
//   node uat_cli_proto.mjs eval '<js>'
//   node uat_cli_proto.mjs quit
//
// Compare with OPTION A (uat_mcp_proto.mjs): there the server holds the driver
// AND speaks MCP, returning screenshots inline.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = process.env.ARTIFACTS_DIR || path.resolve(__dirname, '../artifacts');
const DAEMON_FILE = `${ART_DIR}/uat-cli-daemon.json`;
const ADDON_ID = 'newtabtools@darktrojan.net';
const UUID = 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const NEWTAB_URL = `moz-extension://${UUID}/newTab.xhtml`;

function newestXpi() {
	const f = fs.readdirSync(ART_DIR)
		.filter(n => n.endsWith('.xpi') || n.endsWith('.zip'))
		.map(n => path.join(ART_DIR, n))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	if (!f.length) { throw new Error(`No xpi/zip in ${ART_DIR}`); }
	return f[0];
}

async function runDaemon() {
	fs.mkdirSync(ART_DIR, { recursive: true });
	const opts = new firefox.Options();
	if (process.env.FIREFOX_BIN) { opts.setBinary(process.env.FIREFOX_BIN); }
	opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
	opts.addArguments('-headless');

	const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
	await driver.installAddon(newestXpi(), true);
	await driver.get(NEWTAB_URL);

	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', c => { body += c; });
		req.on('end', async () => {
			const { cmd, arg } = JSON.parse(body || '{}');
			try {
				let out;
				if (cmd === 'nav') { await driver.get(arg); out = { url: arg }; }
				else if (cmd === 'eval') { out = { value: await driver.executeScript(arg) }; }
				else if (cmd === 'shot') {
					const png = await driver.takeScreenshot();
					const p = `${ART_DIR}/cli-${arg || 'shot'}.png`;
					fs.writeFileSync(p, png, 'base64');
					out = { path: p, bytes: fs.statSync(p).size };
				} else if (cmd === 'quit') {
					out = { ok: true };
					res.end(JSON.stringify(out));
					await driver.quit();
					server.close();
					return;
				} else { throw new Error(`unknown cmd: ${cmd}`); }
				res.end(JSON.stringify(out));
			} catch (e) {
				res.statusCode = 500;
				res.end(JSON.stringify({ error: e.message }));
			}
		});
	});

	server.listen(0, '127.0.0.1', () => {
		const { port } = server.address();
		fs.writeFileSync(DAEMON_FILE, JSON.stringify({ port, newtabUrl: NEWTAB_URL }));
		console.log(`[cli-daemon] ready on 127.0.0.1:${port}; newtab=${NEWTAB_URL}`);
	});
}

function client(cmd, arg) {
	const { port } = JSON.parse(fs.readFileSync(DAEMON_FILE, 'utf8'));
	const payload = JSON.stringify({ cmd, arg });
	const req = http.request(
		{ host: '127.0.0.1', port, method: 'POST', path: '/cmd', headers: { 'content-length': Buffer.byteLength(payload) } },
		res => {
			let body = '';
			res.on('data', c => { body += c; });
			res.on('end', () => {
				process.stdout.write(body + '\n');
				process.exit(res.statusCode === 200 ? 0 : 1);
			});
		}
	);
	req.on('error', e => { console.error(`[cli] ${e.message} (is the daemon running?)`); process.exit(2); });
	req.end(payload);
}

const [, , cmd, ...rest] = process.argv;
if (cmd === 'daemon') {
	await runDaemon();
} else if (cmd) {
	client(cmd, rest.join(' '));
} else {
	console.error('usage: uat_cli_proto.mjs <daemon|nav <url>|shot <name>|eval <js>|quit>');
	process.exit(2);
}
