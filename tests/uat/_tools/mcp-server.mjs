#!/usr/bin/env node
// NTT UAT — MCP browser-control server (Selenium + geckodriver + release Firefox).
//
// SCREENSHOT STRATEGY = Option C (see UAT_PLAN.md "Decided 2026-06-01"):
//   browser_take_screenshot  -> writes a PNG to disk, returns the PATH only
//                               (no image enters the model context).
//   browser_read_screenshot  -> loads a saved PNG INLINE on demand, so the
//                               agent pays the ~1.2k image-token cost only for
//                               the shots it actually needs to judge.
//
// The server process holds ONE Selenium driver for the whole agent session —
// it IS the browser daemon, so there is no separate launch script.
//
// Run standalone (after `npm i -D @modelcontextprotocol/sdk`):
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/mcp-server.mjs
// Normally spawned by the runner via mcp-config.json (env injected).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.resolve(__dirname, '../artifacts');
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const ADDON_ID = 'newtabtools@darktrojan.net';
const NEWTAB_URL = `moz-extension://${UUID}/newTab.xhtml`;

function resolveXpi() {
	if (process.env.EXTENSION_XPI) { return process.env.EXTENSION_XPI; }
	const f = fs.readdirSync(ARTIFACTS_DIR)
		.filter(n => n.endsWith('.xpi') || n.endsWith('.zip'))
		.map(n => path.join(ARTIFACTS_DIR, n))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	if (!f.length) { throw new Error(`No EXTENSION_XPI set and no .xpi/.zip in ${ARTIFACTS_DIR}`); }
	return f[0];
}

async function makeDriver() {
	const opts = new firefox.Options();
	if (process.env.FIREFOX_BIN) { opts.setBinary(process.env.FIREFOX_BIN); }
	opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
	opts.addArguments('-headless');
	const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
	await driver.installAddon(resolveXpi(), true); // temporary = unsigned OK on release
	await driver.get(NEWTAB_URL);
	return driver;
}

const TOOLS = [
	{ name: 'browser_navigate', description: 'Navigate to a URL.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
	{ name: 'browser_click', description: 'Click the first element matching a CSS selector.', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
	{ name: 'browser_evaluate', description: 'Run JS in the page and return the result.', inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } },
	{ name: 'browser_file_upload', description: 'Set a file <input> (matched by selector) to an absolute path.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, path: { type: 'string' } }, required: ['selector', 'path'] } },
	{ name: 'browser_take_screenshot', description: 'Capture the viewport to a PNG on disk and return its path. Does NOT put the image in context — call browser_read_screenshot to view it.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
	{ name: 'browser_read_screenshot', description: 'Load a previously-captured screenshot inline so you can judge it. Read only the ones you need.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];

const driver = await makeDriver();
const server = new Server({ name: 'ntt-uat', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	const { name, arguments: a = {} } = req.params;
	try {
		if (name === 'browser_navigate') {
			await driver.get(a.url);
			return { content: [{ type: 'text', text: `navigated to ${a.url}` }] };
		}
		if (name === 'browser_click') {
			await driver.findElement(By.css(a.selector)).click();
			return { content: [{ type: 'text', text: `clicked ${a.selector}` }] };
		}
		if (name === 'browser_evaluate') {
			const value = await driver.executeScript(a.script);
			return { content: [{ type: 'text', text: JSON.stringify(value) }] };
		}
		if (name === 'browser_file_upload') {
			await driver.findElement(By.css(a.selector)).sendKeys(a.path);
			return { content: [{ type: 'text', text: `uploaded ${a.path}` }] };
		}
		if (name === 'browser_take_screenshot') {
			const data = await driver.takeScreenshot();
			fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
			const p = path.join(ARTIFACTS_DIR, `${a.name}.png`);
			fs.writeFileSync(p, data, 'base64');
			return { content: [{ type: 'text', text: JSON.stringify({ saved: p, bytes: fs.statSync(p).size }) }] };
		}
		if (name === 'browser_read_screenshot') {
			const p = path.join(ARTIFACTS_DIR, `${a.name}.png`);
			const data = fs.readFileSync(p).toString('base64');
			return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
		}
		return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
	} catch (e) {
		return { content: [{ type: 'text', text: `error in ${name}: ${e.message}` }], isError: true };
	}
});

process.on('SIGTERM', () => { void driver.quit(); });
process.on('SIGINT', () => { void driver.quit(); });

await server.connect(new StdioServerTransport());
