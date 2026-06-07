#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// NTT UAT — MCP browser-control server (thin client).
//
// A stdio MCP server that owns no browser state: it forwards each browser_* tool
// call to the long-lived browser daemon (browser-daemon.mjs) over its localhost
// HTTP API. The daemon holds the one warm Firefox session for the whole run;
// Claude spawns a fresh, cheap copy of this server per scenario (via
// mcp-config.json), and they all attach to that same browser.
//
// Screenshots are disk-backed and read on demand to keep image-token cost
// proportional to what the agent actually judges:
//   browser_take_screenshot  -> daemon writes a PNG to disk (into this agent's
//                               ARTIFACTS_DIR), returns the PATH only.
//   browser_read_screenshot  -> reads a saved PNG INLINE from local disk on
//                               demand (~2.8k image tokens per shot viewed).
//
// Env:
//   UAT_DAEMON_PORT    daemon port (default 9876; must match the running daemon)
//   ARTIFACTS_DIR      where screenshots are written/read for THIS scenario
//   UAT_SCENARIO_LABEL scenario slug, embedded in screenshot filenames

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || 9876;
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.resolve(__dirname, '../artifacts');
const SCENARIO_LABEL = process.env.UAT_SCENARIO_LABEL || '';

// Screenshot filenames lead with the CAPTURE time (not the run-start time), so a
// strict filename sort equals the order shots were taken — across scenarios too
// (a later scenario's shots get later timestamps). Format:
// <YYYYMMDD-HHMMSS>-<scenario>-<shot>.png. Seconds resolution is enough: shots
// are always several seconds apart, so no sub-second sequence is needed.
function captureStamp(d = new Date()) {
	const p = n => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// Map the agent's short shot name (e.g. "01-grid") to the timestamped filename
// it was actually saved as, so browser_read_screenshot can find it again.
const shotFiles = new Map();
function buildShotName(name) {
	const label = SCENARIO_LABEL ? `-${SCENARIO_LABEL}` : '';
	const file = `${captureStamp()}${label}-${name}`;
	shotFiles.set(name, file);
	return file;
}

async function daemon(endpoint, body) {
	const res = await fetch(`${BASE}${endpoint}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json();
	if (!res.ok) { throw new Error(json.error || `daemon ${endpoint} -> ${res.status}`); }
	return json;
}

const TOOLS = [
	{ name: 'browser_navigate', description: 'Navigate to a URL.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
	{ name: 'browser_click', description: 'Click the first element matching a CSS selector.', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
	{ name: 'browser_hover', description: 'Move the pointer over the first element matching a CSS selector, so CSS :hover styles (e.g. tile action rows) activate. The pointer stays there for a follow-up screenshot or evaluate.', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
	{ name: 'browser_evaluate', description: 'Run JS in the page and return the result.', inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } },
	{ name: 'browser_capture_tiles', description: 'Open each given tile URL in turn (short timeout, then return to the new-tab page) to trigger the extension\'s auto-thumbnail + favicon capture. Use this for capture tests instead of navigating to each tile URL one by one.', inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } } }, required: ['urls'] } },
	{ name: 'browser_file_upload', description: 'Set a file <input> (matched by selector) to an absolute path.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, path: { type: 'string' } }, required: ['selector', 'path'] } },
	{ name: 'browser_take_screenshot', description: 'Capture the viewport to a PNG on disk and return its path. Does NOT put the image in context — call browser_read_screenshot to view it.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
	{ name: 'browser_read_screenshot', description: 'Load a previously-captured screenshot inline so you can judge it. Read only the ones you need.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];

const server = new Server({ name: 'ntt-uat', version: '0.2.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	const { name, arguments: a = {} } = req.params;
	try {
		if (name === 'browser_navigate') {
			await daemon('/navigate', { url: a.url });
			return { content: [{ type: 'text', text: `navigated to ${a.url}` }] };
		}
		if (name === 'browser_click') {
			await daemon('/click', { selector: a.selector });
			return { content: [{ type: 'text', text: `clicked ${a.selector}` }] };
		}
		if (name === 'browser_hover') {
			await daemon('/hover', { selector: a.selector });
			return { content: [{ type: 'text', text: `hovered ${a.selector}` }] };
		}
		if (name === 'browser_evaluate') {
			const { value } = await daemon('/evaluate', { script: a.script });
			return { content: [{ type: 'text', text: JSON.stringify(value) }] };
		}
		if (name === 'browser_capture_tiles') {
			const out = await daemon('/capture_tiles', { urls: a.urls });
			return { content: [{ type: 'text', text: JSON.stringify(out) }] };
		}
		if (name === 'browser_file_upload') {
			await daemon('/file_upload', { selector: a.selector, path: a.path });
			return { content: [{ type: 'text', text: `uploaded ${a.path}` }] };
		}
		if (name === 'browser_take_screenshot') {
			// Stamp with the capture time + sequence, then have the daemon write it
			// into this scenario's dir.
			const out = await daemon('/screenshot', { name: buildShotName(a.name), dir: ARTIFACTS_DIR });
			return { content: [{ type: 'text', text: JSON.stringify(out) }] };
		}
		if (name === 'browser_read_screenshot') {
			// Daemon and this process share the filesystem; read locally, resolving
			// the agent's short name to the timestamped file it was saved as.
			const base = shotFiles.get(a.name) || a.name;
			const p = path.join(ARTIFACTS_DIR, `${base}.png`);
			const data = fs.readFileSync(p).toString('base64');
			return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
		}
		return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
	} catch (e) {
		return { content: [{ type: 'text', text: `error in ${name}: ${e.message}` }], isError: true };
	}
});

await server.connect(new StdioServerTransport());
