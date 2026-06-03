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
//                               demand (~1.2k image tokens per shot viewed).
//
// Env:
//   UAT_DAEMON_PORT  daemon port (default 9876; must match the running daemon)
//   ARTIFACTS_DIR    where screenshots are written/read for THIS scenario
//   UAT_SHOT_PREFIX  filename prefix the runner sets, prepended to shot names

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
// Set by the runner: `<run-stamp>-<scenario>`. Prepended to the agent's shot
// name so files sort in capture order across the run and never collide between
// runs (e.g. 20260603-071342-restore-dogfood-01-grid.png). Falls back to no
// prefix when run outside the runner (e.g. mcp-smoke).
const SHOT_PREFIX = process.env.UAT_SHOT_PREFIX || '';
const shotFile = name => (SHOT_PREFIX ? `${SHOT_PREFIX}-${name}` : name);

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
	{ name: 'browser_evaluate', description: 'Run JS in the page and return the result.', inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } },
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
		if (name === 'browser_evaluate') {
			const { value } = await daemon('/evaluate', { script: a.script });
			return { content: [{ type: 'text', text: JSON.stringify(value) }] };
		}
		if (name === 'browser_file_upload') {
			await daemon('/file_upload', { selector: a.selector, path: a.path });
			return { content: [{ type: 'text', text: `uploaded ${a.path}` }] };
		}
		if (name === 'browser_take_screenshot') {
			// Tell the daemon to write into THIS agent's per-scenario dir, under
			// the timestamped, capture-ordered filename.
			const out = await daemon('/screenshot', { name: shotFile(a.name), dir: ARTIFACTS_DIR });
			return { content: [{ type: 'text', text: JSON.stringify(out) }] };
		}
		if (name === 'browser_read_screenshot') {
			// Daemon and this process share the filesystem; read locally. Same
			// prefix as take_screenshot so the agent still refers to its own name.
			const p = path.join(ARTIFACTS_DIR, `${shotFile(a.name)}.png`);
			const data = fs.readFileSync(p).toString('base64');
			return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
		}
		return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
	} catch (e) {
		return { content: [{ type: 'text', text: `error in ${name}: ${e.message}` }], isError: true };
	}
});

await server.connect(new StdioServerTransport());
