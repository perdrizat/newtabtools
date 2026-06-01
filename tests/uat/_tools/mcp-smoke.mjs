#!/usr/bin/env node
// Smoke + payload-measurement client for mcp-server.mjs (Option C).
// Verifies the server boots, drives Firefox, and prints the wire-payload size of
// each result so the token model stays honest: schema overhead (fixed), the
// disk-path screenshot result (tiny), and an on-demand inline read (~the image).
//
// Run (after `npm i -D @modelcontextprotocol/sdk`):
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/mcp-smoke.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'mcp-server.mjs');
const size = o => Buffer.byteLength(JSON.stringify(o));

const transport = new StdioClientTransport({ command: 'node', args: [SERVER], env: { ...process.env } });
const client = new Client({ name: 'uat-smoke', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log(`[smoke] tools/list payload (fixed schema overhead, in context all session): ${size(tools)} bytes`);

const cells = await client.callTool({ name: 'browser_evaluate', arguments: { script: 'return document.querySelectorAll("#newtab-grid > *").length' } });
console.log(`[smoke] browser_evaluate -> ${cells.content[0].text}  (${size(cells)} bytes)`);

const shot = await client.callTool({ name: 'browser_take_screenshot', arguments: { name: 'smoke' } });
console.log(`[smoke] browser_take_screenshot (disk path — Option C default): ${size(shot)} bytes -> ${shot.content[0].text}`);

const view = await client.callTool({ name: 'browser_read_screenshot', arguments: { name: 'smoke' } });
console.log(`[smoke] browser_read_screenshot (inline image, on demand): ${size(view)} bytes`);

await client.close();
process.exit(0);
