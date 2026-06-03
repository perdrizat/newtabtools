#!/usr/bin/env node
// Smoke + payload-measurement for the full MCP path, daemon-backed.
//
// mcp-server.mjs is a thin client to browser-daemon.mjs, so this smoke spawns
// the DAEMON first, waits for /health, then drives the MCP server (which
// forwards to the daemon). Verifies the server boots, reaches the browser via
// the daemon, and prints the wire-payload size of each result so the token
// model stays honest: schema overhead (fixed), the disk-path screenshot result
// (tiny), and an on-demand inline read (~the image).
//
// Run (after `pnpm build`):
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/mcp-smoke.mjs

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'mcp-server.mjs');
const DAEMON = path.join(__dirname, 'browser-daemon.mjs');
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || 9876;
const BASE = `http://127.0.0.1:${PORT}`;
const size = o => Buffer.byteLength(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHealthy(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok && (await res.json()).ready) { return; }
		} catch { /* not up yet */ }
		await sleep(1000);
	}
	throw new Error(`daemon did not become healthy within ${timeoutMs}ms`);
}

console.log(`[mcp-smoke] spawning daemon on port ${PORT}`);
const daemon = spawn('node', [DAEMON], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env } });

let exitCode = 0;
let client;
try {
	await waitHealthy(300000);
	console.log('[mcp-smoke] daemon healthy; connecting MCP server');

	const transport = new StdioClientTransport({ command: 'node', args: [SERVER], env: { ...process.env } });
	client = new Client({ name: 'uat-smoke', version: '0.2.0' }, { capabilities: {} });
	await client.connect(transport);

	const tools = await client.listTools();
	console.log(`[mcp-smoke] tools/list payload (fixed schema overhead, in context all session): ${size(tools)} bytes`);

	const cells = await client.callTool({ name: 'browser_evaluate', arguments: { script: 'return document.querySelectorAll("#newtab-grid > *").length' } });
	console.log(`[mcp-smoke] browser_evaluate -> ${cells.content[0].text}  (${size(cells)} bytes)`);

	const shot = await client.callTool({ name: 'browser_take_screenshot', arguments: { name: 'smoke' } });
	console.log(`[mcp-smoke] browser_take_screenshot (disk path, default): ${size(shot)} bytes -> ${shot.content[0].text}`);

	const view = await client.callTool({ name: 'browser_read_screenshot', arguments: { name: 'smoke' } });
	console.log(`[mcp-smoke] browser_read_screenshot (inline image, on demand): ${size(view)} bytes`);

	console.log('[mcp-smoke] OK');
} catch (e) {
	console.error(`[mcp-smoke] FAILED: ${e.message}`);
	exitCode = 1;
} finally {
	if (client) { try { await client.close(); } catch { /* ignore */ } }
	daemon.kill('SIGTERM');
	await sleep(3000);
	if (!daemon.killed) { daemon.kill('SIGKILL'); }
}

process.exit(exitCode);
