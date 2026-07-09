/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * THE load-bearing module-scope regression test (MODERNIZATION.md, slices
 * M1 → M5).
 *
 * M1's premise: with the background flipped to `{"scripts":
 * ["lib/background-main.js"], "type": "module"}`, every file
 * `background-main.js` side-effect-imports loads as a real ES module. In
 * module scope, top-level `var X = …` / `function X() {}` declarations
 * create bindings local to that module's scope — they do NOT attach to
 * `globalThis`, unlike the exact same syntax in a classic script. A file that
 * still used bare `var`/`function` for a cross-file symbol would pass every
 * vm-loaded test while being silently broken in production.
 *
 * M5 dissolves the former background.js entirely: its message dispatch moved
 * to lib/messages.js (real module, real imports of Tiles/Background/
 * withStore/the capture pipeline/makeZip/readZip) and every listener
 * registration moved into lib/background-main.js itself (also real imports).
 * NONE of those M2/M3/M4 `globalThis` bridge assignments
 * (`withStore`/`SAFE_PROTOCOLS`/`Tiles`/`Background`/the capture-pipeline
 * exports/`makeZip`/`readZip`) exist anymore — every consumer reaches them
 * via real `import` bindings instead. This file's job flips accordingly:
 * prove the RETIRED bridges are actually gone (a regression here would mean
 * someone re-added a `globalThis.X = …` line instead of using a real
 * import), while the Decision-2 dual-scope bridge (`Prefs`/`Blocked`/
 * `Filters`/`NeverCapture` from prefs.js; `compareVersions` from common.js —
 * these stay bridge-mode PERMANENTLY, since the page still needs them as a
 * classic `<script>` global) still lands correctly.
 *
 * This natively `import()`s lib/background-main.js — the manifest's actual
 * background entry — with the browser/chrome surface it touches at its own
 * top level mocked just enough that import doesn't throw (no listener body
 * is invoked; only registration + the top-level `Prefs.init()` chain runs).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const EXTENSION_ID = 'newtabtools@symlink.ch';

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock — auto-resolves indexedDB.open() on a
// microtask (crib: tests/integration/event-page-resilience.test.ts). Nothing
// in this file dispatches a message or navigation event that would actually
// touch a store, but lib/db.js is in the import graph (via lib/messages.js),
// so `indexedDB` must at least exist and be well-behaved if anything lazily
// probes it.
// ---------------------------------------------------------------------------

function installAutoResolvingIndexedDB() {
	const mockDB: Record<string, unknown> = {
		objectStoreNames: { contains: () => true },
		createObjectStore: () => ({ createIndex: () => {} }),
		close: () => {},
		transaction: () => ({
			objectStore: () => ({
				getAll: () => ({ onsuccess: null }),
			}),
		}),
	};
	const openMock = vi.fn(() => {
		const handlers: Record<string, Function> = {};
		const req: Record<string, unknown> = {};
		for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
			Object.defineProperty(req, prop, {
				set(cb: Function) { handlers[prop] = cb; },
				configurable: true,
			});
		}
		Promise.resolve().then(() => {
			handlers.onsuccess && handlers.onsuccess.call({ result: mockDB });
		});
		return req;
	});
	(globalThis as any).indexedDB = { open: openMock };
}

describe('module-scope bridge — lib/background-main.js\'s globalThis surface after M5', () => {
	beforeAll(async () => {
		installAutoResolvingIndexedDB();
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		// --- Browser / Chrome API gaps (crib: event-page-resilience.test.ts) ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn((p: string) => `moz-extension://test-uuid/${p}`);
		(globalThis as any).chrome.management = { getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }) };
		(globalThis as any).browser.menus = {
			create: vi.fn((_props: unknown, cb?: Function) => { if (cb) { cb(); } }),
			update: vi.fn(),
			refresh: vi.fn(),
			onShown: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.idle = { onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.webNavigation = { onCompleted: { addListener: vi.fn() } };
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };
		(globalThis as any).browser.runtime.onInstalled = { addListener: vi.fn() };
		(globalThis as any).browser.runtime.onStartup = { addListener: vi.fn() };
		(globalThis as any).chrome.storage.local = {
			get: vi.fn().mockResolvedValue({ thumbnailSize: 600 }),
			set: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage.onChanged = { addListener: vi.fn() };

		// --- Native import() of the manifest's real background entry ---
		await import(/* @vite-ignore */ webext('lib/background-main.js'));

		// Flush the top-level Prefs.init() chain.
		await vi.waitFor(() => expect((globalThis as any).Prefs).toBeDefined());
	});

	// ------------------------------------------------------------------
	// Decision-2 dual-scope bridge — permanent, still expected on globalThis
	// ------------------------------------------------------------------
	it('common.js defines globalThis.compareVersions', () => {
		expect(typeof (globalThis as any).compareVersions).toBe('function');
	});

	it('prefs.js defines globalThis.Prefs', () => {
		expect(typeof (globalThis as any).Prefs).toBe('object');
		expect(typeof (globalThis as any).Prefs.init).toBe('function');
	});

	it('prefs.js defines globalThis.Blocked', () => {
		expect(typeof (globalThis as any).Blocked).toBe('object');
		expect(typeof (globalThis as any).Blocked.isBlocked).toBe('function');
	});

	it('prefs.js defines globalThis.Filters', () => {
		expect(typeof (globalThis as any).Filters).toBe('object');
		expect(typeof (globalThis as any).Filters.getList).toBe('function');
	});

	it('prefs.js defines globalThis.NeverCapture', () => {
		expect(typeof (globalThis as any).NeverCapture).toBe('object');
		expect(typeof (globalThis as any).NeverCapture.matches).toBe('function');
	});

	// ------------------------------------------------------------------
	// Retired M2/M3/M4 bridges (MODERNIZATION.md M5) — must NOT leak.
	// Every consumer now reaches these via a real `import` instead.
	// ------------------------------------------------------------------
	it('does NOT bridge globalThis.Tiles (real import in lib/messages.js / lib/background-main.js now)', () => {
		expect((globalThis as any).Tiles).toBeUndefined();
	});

	it('does NOT bridge globalThis.Background', () => {
		expect((globalThis as any).Background).toBeUndefined();
	});

	it('does NOT bridge globalThis.withStore', () => {
		expect((globalThis as any).withStore).toBeUndefined();
	});

	it('does NOT bridge globalThis.SAFE_PROTOCOLS', () => {
		expect((globalThis as any).SAFE_PROTOCOLS).toBeUndefined();
	});

	it('does NOT bridge globalThis.getTZDateString', () => {
		expect((globalThis as any).getTZDateString).toBeUndefined();
	});

	it('does NOT bridge globalThis.resetNetworkIdleTimer / disarmNetworkIdle', () => {
		expect((globalThis as any).resetNetworkIdleTimer).toBeUndefined();
		expect((globalThis as any).disarmNetworkIdle).toBeUndefined();
	});

	it('does NOT bridge globalThis.startCaptureSession / removeCaptureSession', () => {
		expect((globalThis as any).startCaptureSession).toBeUndefined();
		expect((globalThis as any).removeCaptureSession).toBeUndefined();
	});

	it('does NOT bridge globalThis.addPendingCapture / takePendingCapture / removePendingCapture', () => {
		expect((globalThis as any).addPendingCapture).toBeUndefined();
		expect((globalThis as any).takePendingCapture).toBeUndefined();
		expect((globalThis as any).removePendingCapture).toBeUndefined();
	});

	it('does NOT bridge globalThis.purgeNeverCaptureHost', () => {
		expect((globalThis as any).purgeNeverCaptureHost).toBeUndefined();
	});

	it('does NOT bridge globalThis.makeZip / readZip', () => {
		expect((globalThis as any).makeZip).toBeUndefined();
		expect((globalThis as any).readZip).toBeUndefined();
	});
});
