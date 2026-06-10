/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Audit 2026-06-10 §10.1 — behavioral coverage for the toolbar-popup glue
 * (`action.js`). E2E is not achievable here: a browser-action popup is
 * browser chrome, not a content page, so Puppeteer-over-BiDi cannot open it.
 * Integration is the realistic tier — the `Tiles.pinTile` message itself is
 * already covered (`background-messages.test.ts`); this pins the popup's
 * button→message wiring on top of the REAL `action.html` markup + `action.js`:
 *
 *   - load: queries the active tab and toggles #pinned/#pin visibility
 *   - #pin click: sends Tiles.pinTile with the active tab's title+url, closes
 *   - #capture click: sends Thumbnails.capture, closes on the callback
 *   - [data-message] labels are localized via i18n.getMessage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');

const actionHtml = fs.readFileSync(path.join(WEBEXT, 'action.html'), 'utf8');
const actionJs = fs.readFileSync(path.join(WEBEXT, 'action.js'), 'utf8');

const TAB = { title: 'Example Page', url: 'https://example.com/page' };

function loadPopup(opts: { isPinned: boolean }) {
	// Mount the real popup body (between <body> and the script tag).
	const body = actionHtml.slice(actionHtml.indexOf('<body>') + 6, actionHtml.indexOf('<script'));
	document.body.innerHTML = body;

	const sendMessage = vi.fn((msg: any, cb?: (r?: unknown) => void) => {
		if (typeof cb !== 'function') { return; }
		if (msg.name === 'Tiles.isPinned') { cb(opts.isPinned); }
		else { cb(); }
	});
	(globalThis as any).chrome = {
		i18n: { getMessage: vi.fn((k: string) => `i18n:${k}`) },
		tabs: { query: vi.fn((_q: unknown, cb: (tabs: unknown[]) => void) => cb([TAB])) },
		runtime: { sendMessage },
	};
	const close = vi.fn();
	window.close = close;

	vm.runInThisContext(actionJs, { filename: 'action.js' });
	return { sendMessage, close };
}

// Flush the getTab() promise chain (mocks call back synchronously).
const tick = () => new Promise(r => setTimeout(r, 0));

describe('action.js — toolbar popup glue (real markup + real script)', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('localizes every [data-message] label via i18n.getMessage', () => {
		loadPopup({ isPinned: false });
		const labels = [...document.querySelectorAll('[data-message]')];
		expect(labels.length).toBeGreaterThanOrEqual(3);
		for (const el of labels) {
			expect(el.textContent).toBe(`i18n:${(el as HTMLElement).dataset.message}`);
		}
	});

	it('on load with an unpinned tab: #pin is shown, #pinned is hidden', async () => {
		const { sendMessage } = loadPopup({ isPinned: false });
		await tick();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Tiles.isPinned', url: TAB.url }),
			expect.any(Function),
		);
		expect((document.getElementById('pin') as HTMLElement).hidden).toBe(false);
		expect((document.getElementById('pinned') as HTMLElement).hidden).toBe(true);
	});

	it('on load with a pinned tab: #pinned is shown, #pin is hidden', async () => {
		loadPopup({ isPinned: true });
		await tick();
		expect((document.getElementById('pin') as HTMLElement).hidden).toBe(true);
		expect((document.getElementById('pinned') as HTMLElement).hidden).toBe(false);
	});

	it('clicking #pin sends Tiles.pinTile with the active tab title+url, then closes', async () => {
		const { sendMessage, close } = loadPopup({ isPinned: false });
		await tick();
		(document.getElementById('pin') as HTMLElement).click();
		await tick();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Tiles.pinTile', title: TAB.title, url: TAB.url }),
		);
		expect(close).toHaveBeenCalled();
	});

	it('clicking #capture sends Thumbnails.capture and closes on the callback', async () => {
		const { sendMessage, close } = loadPopup({ isPinned: false });
		await tick();
		(document.getElementById('capture') as HTMLElement).click();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.capture' }),
			expect.any(Function),
		);
		expect(close).toHaveBeenCalled();
	});
});
