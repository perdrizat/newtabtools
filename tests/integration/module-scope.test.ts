/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * THE load-bearing M1 regression test (MODERNIZATION.md, slice M1).
 *
 * With the background flipped to `{"scripts": ["lib/background-main.js"],
 * "type": "module"}`, every file `background-main.js` side-effect-imports
 * loads as a real ES module. In module scope, top-level `var X = …` /
 * `function X() {}` declarations create bindings local to that module's
 * scope — they do NOT attach to `globalThis`, unlike the exact same syntax
 * in a classic script (which is how every OTHER integration test in this
 * repo loads these files, via `vm.runInThisContext` — script mode). A file
 * that still uses bare `var`/`function` for a cross-file symbol therefore
 * passes every vm-loaded test while being silently broken in production:
 * the next file in the manifest that reads that symbol hits a
 * `ReferenceError` the instant the background event page loads for real.
 *
 * This file natively `import()`s the six background files, in the
 * manifest's declared order, and asserts every cross-file symbol from
 * audit/2026-07-09-mv3-inventory.md §1.9 is actually reachable on
 * `globalThis` afterward — the same thing a sibling module reading that
 * global via a bare identifier depends on.
 *
 * Before the M1 conversion (bare `var`/`function`), this suite fails hard:
 * `background.js`'s top-level `Promise.all([Prefs.init(), waitForDB()])`
 * throws `ReferenceError: Prefs is not defined` the instant it's imported,
 * because `prefs.js`'s `var Prefs = {…}` never left prefs.js's own module
 * scope. After the conversion (`globalThis.Prefs = {…}`, etc.), the same
 * imports succeed and every symbol below is defined.
 *
 * MODERNIZATION.md slice M2 updates the §1.9 map this file asserts against:
 * the `db` global is GONE (by design — it's module-private to lib/db.js
 * now), replaced by `withStore` (lib/db.js) and `SAFE_PROTOCOLS`
 * (lib/constants.js), both bridged onto `globalThis` the same way
 * lib/background-main.js does in production. `tiles.js` itself is now a real
 * ES module (a bridge shim importing lib/tiles-store.js), so its dynamic
 * `import()` below picks up its own `Tiles`/`Background` real-import chain
 * transparently — no change needed to how it's loaded here.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { withStore } from '../../webextension/lib/db.js';
import { SAFE_PROTOCOLS } from '../../webextension/lib/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const EXTENSION_ID = 'newtabtools@symlink.ch';

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock — auto-resolves indexedDB.open() on a
// microtask (crib: tests/integration/event-page-resilience.test.ts). We only
// need waitForDB()'s initDB() call to actually settle so globalThis.db gets
// set; no per-test timing control is needed here (unlike db-wake-race.test.ts).
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
	return mockDB;
}

describe('module-scope bridge — every §1.9 cross-file global lands on globalThis via native import()', () => {
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
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({});
		// Default jest-webextension-mock resolves tabs.query with `[{}]`, whose
		// missing `.url` throws inside the top-level action-sweep's `new
		// URL(tab.url)` — that particular throw is caught by background.js's own
		// trailing `.catch(console.error)`, but the empty-list form (matching
		// the other background.js integration tests) keeps this test's console
		// quiet.
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };
		(globalThis as any).chrome.permissions = { contains: vi.fn().mockResolvedValue(true) };
		(globalThis as any).chrome.action = {
			enable: vi.fn().mockResolvedValue(undefined),
			disable: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage.session = {
			get: vi.fn().mockResolvedValue({}),
			set: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage.local = {
			get: vi.fn().mockResolvedValue({ thumbnailSize: 600 }),
			set: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
		};

		// M2: bridge lib/db.js's withStore() and lib/constants.js's
		// SAFE_PROTOCOLS onto globalThis BEFORE background.js loads — the same
		// two bridge assignments lib/background-main.js makes in production
		// (see that file's header comment). Both are real `import`s at the top
		// of this file; tiles.js needs no such treatment here since it's now
		// itself a real ES module that does its own Tiles/Background bridging
		// via a real relative import when dynamically imported below.
		(globalThis as any).withStore = withStore;
		(globalThis as any).SAFE_PROTOCOLS = SAFE_PROTOCOLS;

		// --- Native import(), in the manifest's declared background.scripts
		// order (audit §1: common.js, tiles.js, prefs.js, background.js,
		// lib/zip.js [now lib/zip-global.js], export.js) ---
		await import(/* @vite-ignore */ webext('common.js'));
		await import(/* @vite-ignore */ webext('tiles.js'));
		await import(/* @vite-ignore */ webext('prefs.js'));
		await import(/* @vite-ignore */ webext('background.js'));
		await import(/* @vite-ignore */ webext('lib/zip-global.js'));
		await import(/* @vite-ignore */ webext('export.js'));

		// Flush the top-level Prefs.init() chain, and prove the connection
		// lifecycle works end-to-end through the bridged withStore() (M2
		// replaces the old "wait for globalThis.db" assertion — see below).
		await vi.waitFor(() => expect((globalThis as any).withStore).toBeDefined());
	});

	// ------------------------------------------------------------------
	// common.js → compareVersions (used tiles.js, newTab.js)
	// ------------------------------------------------------------------
	it('common.js defines globalThis.compareVersions', () => {
		expect(typeof (globalThis as any).compareVersions).toBe('function');
	});

	// ------------------------------------------------------------------
	// prefs.js → Prefs, Blocked, Filters, NeverCapture
	// ------------------------------------------------------------------
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
	// tiles.js (bridge shim, M2) → Tiles, Background (from lib/tiles-store.js)
	// ------------------------------------------------------------------
	it('tiles.js bridges globalThis.Tiles from lib/tiles-store.js', () => {
		expect(typeof (globalThis as any).Tiles).toBe('object');
		// getAllTiles was renamed to getGridTiles internally in M2 (the WIRE
		// message name 'Tiles.getAllTiles' stays frozen — Decision 3 — but
		// this is the internal store method, which is not the wire name).
		expect(typeof (globalThis as any).Tiles.getGridTiles).toBe('function');
	});

	it('tiles.js bridges globalThis.Background from lib/tiles-store.js', () => {
		expect(typeof (globalThis as any).Background).toBe('object');
		expect(typeof (globalThis as any).Background.getBackground).toBe('function');
	});

	// ------------------------------------------------------------------
	// lib/db.js → withStore (M2: replaces the `db` global, which no longer
	// exists anywhere — it's module-private to lib/db.js)
	// ------------------------------------------------------------------
	it('lib/background-main.js\'s bridge exposes globalThis.withStore, and it resolves once the connection is open', async () => {
		expect(typeof (globalThis as any).withStore).toBe('function');
		const store = await (globalThis as any).withStore('tiles', 'readonly', (s: unknown) => s);
		expect(store).toBeDefined();
	});

	// ------------------------------------------------------------------
	// lib/constants.js → SAFE_PROTOCOLS (M2)
	// ------------------------------------------------------------------
	it('lib/background-main.js\'s bridge exposes globalThis.SAFE_PROTOCOLS', () => {
		expect((globalThis as any).SAFE_PROTOCOLS).toEqual(['http:', 'https:', 'ftp:']);
	});

	// ------------------------------------------------------------------
	// background.js → purgeNeverCaptureHost
	// ------------------------------------------------------------------
	it('background.js defines globalThis.purgeNeverCaptureHost', () => {
		expect(typeof (globalThis as any).purgeNeverCaptureHost).toBe('function');
	});

	// ------------------------------------------------------------------
	// export.js → makeZip, readZip
	// ------------------------------------------------------------------
	it('export.js defines globalThis.makeZip', () => {
		expect(typeof (globalThis as any).makeZip).toBe('function');
	});

	it('export.js defines globalThis.readZip', () => {
		expect(typeof (globalThis as any).readZip).toBe('function');
	});

	// ------------------------------------------------------------------
	// lib/zip.js → zip (used export.js)
	// ------------------------------------------------------------------
	it('lib/zip-global.js defines globalThis.zip', () => {
		expect(typeof (globalThis as any).zip).toBe('object');
		expect(typeof (globalThis as any).zip.ZipWriter).toBe('function');
	});
});
