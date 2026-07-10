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
 *
 * PAGE_MODULES.md P1 flips action.html to `<script type="module"
 * src="action.js">`. Loading the file via `vm.runInThisContext` (as this test
 * did before) runs it as classic, sloppy-mode script — real module scope is
 * strict and would reject e.g. an implicit-global assignment that sloppy mode
 * silently allows, so a vm-mode-only test could pass while the real,
 * module-loaded production file throws (code review,
 * 2026-07-10-page-modules-p1-code-review.md finding 2). This natively
 * `import()`s action.js instead, matching production. Each test needs a fresh
 * top-level run (action.js's top level does all its DOM wiring, and every
 * test wants a differently-mocked tab/pinned state), so `vi.resetModules()`
 * plus a cache-busting query suffix forces a real re-evaluation per call —
 * plain `import()` of the same specifier would hit vitest's module cache and
 * silently reuse the first run's closures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');

const actionHtml = fs.readFileSync(path.join(WEBEXT, 'action.html'), 'utf8');
const ACTION_JS_PATH = path.join(WEBEXT, 'action.js');

const TAB = { title: 'Example Page', url: 'https://example.com/page' };

let loadCounter = 0;

async function loadPopup(opts: { isPinned: boolean }) {
	// Mount the real popup body (between <body> and the script tag).
	const body = actionHtml.slice(actionHtml.indexOf('<body>') + 6, actionHtml.indexOf('<script'));
	document.body.innerHTML = body;

	const sendMessage = vi.fn((msg: any) => {
		if (msg.name === 'Tiles.isPinned') { return Promise.resolve(opts.isPinned); }
		return Promise.resolve();
	});
	(globalThis as any).chrome = {
		i18n: { getMessage: vi.fn((k: string) => `i18n:${k}`) },
	};
	(globalThis as any).browser = {
		tabs: { query: vi.fn().mockResolvedValue([TAB]) },
		runtime: { sendMessage },
	};
	const close = vi.fn();
	window.close = close;

	vi.resetModules();
	await import(/* @vite-ignore */ `${ACTION_JS_PATH}?loadPopup=${loadCounter++}`);
	return { sendMessage, close };
}

// Flush the getTab() promise chain (mocks call back synchronously).
const tick = () => new Promise(r => setTimeout(r, 0));

describe('action.js — toolbar popup glue (real markup + real module)', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('localizes every [data-message] label via i18n.getMessage', async () => {
		await loadPopup({ isPinned: false });
		const labels = [...document.querySelectorAll('[data-message]')];
		expect(labels.length).toBeGreaterThanOrEqual(3);
		for (const el of labels) {
			expect(el.textContent).toBe(`i18n:${(el as HTMLElement).dataset.message}`);
		}
	});

	it('on load with an unpinned tab: #pin is shown, #pinned is hidden', async () => {
		const { sendMessage } = await loadPopup({ isPinned: false });
		await tick();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Tiles.isPinned', url: TAB.url }),
		);
		expect((document.getElementById('pin') as HTMLElement).hidden).toBe(false);
		expect((document.getElementById('pinned') as HTMLElement).hidden).toBe(true);
	});

	it('on load with a pinned tab: #pinned is shown, #pin is hidden', async () => {
		await loadPopup({ isPinned: true });
		await tick();
		expect((document.getElementById('pin') as HTMLElement).hidden).toBe(true);
		expect((document.getElementById('pinned') as HTMLElement).hidden).toBe(false);
	});

	it('clicking #pin sends Tiles.pinTile with the active tab title+url, then closes', async () => {
		const { sendMessage, close } = await loadPopup({ isPinned: false });
		await tick();
		(document.getElementById('pin') as HTMLElement).click();
		await tick();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Tiles.pinTile', title: TAB.title, url: TAB.url }),
		);
		expect(close).toHaveBeenCalled();
	});

	it('clicking #capture sends Thumbnails.capture and closes on the callback', async () => {
		const { sendMessage, close } = await loadPopup({ isPinned: false });
		await tick();
		(document.getElementById('capture') as HTMLElement).click();
		// The click handler is now `async function() { await sendMessage(...); close(); }`
		// (Slice C of the MV3 migration: promise-based browser.* instead of a
		// callback) — flush the microtask so `close()` has run.
		await tick();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.capture' }),
		);
		expect(close).toHaveBeenCalled();
	});
});
