/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: unguarded db access on event-page wake (audit
 * 2026-07-09-mv3-code-review.md §2.1/§2.2, adjudicated in MV3_MIGRATION.md
 * "Pre-release fixes" item 1 — WIDENED beyond the original report).
 *
 * MODERNIZATION.md slice M2 rewrite: this is the §2.1-regression guard the
 * M2 test-harness strategy explicitly calls out to survive the readiness
 * redesign, now proving `withStore()`'s readiness gate instead of the old
 * `waitForDB()`/`globalThis.db` pair. There is no `db` global left to poke —
 * `db` is module-private to lib/db.js — so the mechanism changes but the
 * property under test does not: **a message dispatched before the
 * connection finishes opening must still be answered correctly once it
 * does**, for every db-touching handler, and the capture path's
 * `Tiles.ensureReady()`/`_ready` sticky-state behavior.
 *
 * `tiles.js` is now a bridge shim (`import {Tiles, Background} from
 * './lib/tiles-store.js'; …`) with real `import` syntax, so it can no
 * longer be `vm.runInThisContext`-loaded (script-mode parsing rejects
 * `import`). Instead: a native `import` of the real lib/tiles-store.js +
 * lib/db.js + lib/constants.js, with the SAME bridge assignments tiles.js /
 * lib/background-main.js make in production — `globalThis.Tiles = Tiles`,
 * `globalThis.withStore = withStore`, `globalThis.SAFE_PROTOCOLS =
 * SAFE_PROTOCOLS` — before vm-loading `background.js` (still bridge-mode,
 * unchanged). Because lib/tiles-store.js reaches the connection via the SAME
 * imported `withStore` function background.js's own handlers use (one
 * cached ES module instance), dispatching ANY db-touching message — through
 * either path — drives the identical controllable `indexedDB.open()` mock.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { Tiles as RealTiles, Background as RealBackground } from '../../webextension/lib/tiles-store.js';
import { withStore, _resetForTests } from '../../webextension/lib/db.js';
import { SAFE_PROTOCOLS } from '../../webextension/lib/constants.js';
import {
	getTZDateString,
	resetNetworkIdleTimer,
	disarmNetworkIdle,
	startCaptureSession,
	removeCaptureSession,
	addPendingCapture,
	takePendingCapture,
	removePendingCapture,
	purgeNeverCaptureHost,
	_captureSessionsForTests,
} from '../../webextension/lib/capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND_PATH = path.resolve(__dirname, '../../webextension/background.js');
const EXTENSION_ID = 'newtabtools@symlink.ch';

// ---------------------------------------------------------------------------
// In-memory IndexedDB mock (tiles / background / thumbnails stores)
// ---------------------------------------------------------------------------

function createMockDB() {
	let autoId = 1;
	const stores: Record<string, Array<Record<string, unknown>>> = {
		tiles: [],
		background: [],
		thumbnails: [],
	};

	function makeOp<T>(resultFn: () => T) {
		const op: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
		// Real IDB ops resolve asynchronously — fire onsuccess on a microtask.
		Promise.resolve().then(() => {
			op.result = resultFn();
			const cb = op.onsuccess as (() => void) | null;
			if (cb) { cb.call(op); }
		});
		return op;
	}

	function makeCursorRequest(name: string) {
		let index = 0;
		let handler: ((this: unknown) => void) | null = null;
		const req: Record<string, unknown> = {};
		const advance = () => {
			const entries = stores[name];
			if (index < entries.length) {
				const i = index;
				const cursor = {
					value: entries[i],
					update: (updated: Record<string, unknown>) => { entries[i] = updated; },
					delete: () => { entries.splice(i, 1); },
					continue: () => { index++; Promise.resolve().then(advance); },
				};
				handler && handler.call({ result: cursor });
			} else {
				handler && handler.call({ result: null });
			}
		};
		Object.defineProperty(req, 'onsuccess', {
			set(cb: (this: unknown) => void) { handler = cb; Promise.resolve().then(advance); },
			configurable: true,
		});
		return req;
	}

	function keyOf(name: string, record: Record<string, unknown>) {
		return name === 'thumbnails' ? record.url : record.id;
	}

	function makeObjectStore(name: string) {
		return {
			getAll() { return makeOp(() => stores[name].map(r => ({ ...r }))); },
			get(id: unknown) {
				return makeOp(() => stores[name].find(r => keyOf(name, r) === id) || null);
			},
			put(record: Record<string, unknown>) {
				if (name !== 'thumbnails' && record.id == null) { record.id = autoId++; }
				const idx = stores[name].findIndex(r => keyOf(name, r) === keyOf(name, record));
				if (idx >= 0) { stores[name].splice(idx, 1); }
				stores[name].push({ ...record });
				return makeOp(() => keyOf(name, record));
			},
			add(record: Record<string, unknown>) {
				record.id = autoId++;
				stores[name].push({ ...record });
				return makeOp(() => record.id);
			},
			delete(key: unknown) {
				stores[name] = stores[name].filter(r => keyOf(name, r) !== key);
				return makeOp(() => undefined);
			},
			clear() {
				stores[name].length = 0;
				return makeOp(() => undefined);
			},
			index(indexName: string) {
				return {
					get(value: unknown) {
						return makeOp(() => stores[name].find(r => r[indexName] === value) || null);
					},
					openCursor() { return makeCursorRequest(name); },
				};
			},
			openCursor() { return makeCursorRequest(name); },
		};
	}

	return {
		objectStoreNames: { contains: (n: string) => n in stores },
		createObjectStore: () => {},
		close: () => {},
		transaction(_storeName: string) {
			return { objectStore: (name: string) => makeObjectStore(name) };
		},
		_stores: stores,
	};
}

// ---------------------------------------------------------------------------
// Controllable indexedDB.open — resolves ONLY when the test calls .resolve()
// ---------------------------------------------------------------------------

type ControllableOpen = { resolve: () => void; reject: () => void };

describe('db-wake-race — message handlers wait for the DB (audit §2.1/§2.2)', () => {
	let mockDBInstance: ReturnType<typeof createMockDB>;
	let pendingOpens: ControllableOpen[];
	let openMock: ReturnType<typeof vi.fn>;
	let listener: (message: unknown, sender: unknown, sendResponse: any) => boolean;
	let onCompletedListener: (details: { frameId: number; tabId: number; url: string }) => void;
	let Tiles: any;

	const validSender = { id: EXTENSION_ID };

	function installControllableIndexedDB() {
		pendingOpens = [];
		openMock = vi.fn(() => {
			const handlers: Record<string, Function> = {};
			const req: Record<string, unknown> = {};
			for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
				Object.defineProperty(req, prop, {
					set(cb: Function) { handlers[prop] = cb; },
					configurable: true,
				});
			}
			const controllable: ControllableOpen = {
				resolve() {
					if (handlers.onsuccess) { handlers.onsuccess.call({ result: mockDBInstance }); }
				},
				reject() {
					if (handlers.onerror) { handlers.onerror(new Event('error')); }
				},
			};
			pendingOpens.push(controllable);
			return req;
		});
		(globalThis as any).indexedDB = { open: openMock };
	}

	/** The controllable open request from the MOST RECENT initDB() call. */
	function latestOpen(): ControllableOpen {
		return pendingOpens[pendingOpens.length - 1];
	}

	beforeAll(async () => {
		mockDBInstance = createMockDB();
		installControllableIndexedDB();

		// --- Dependencies tiles.js expects (plain-object mocks, real tiles.js loaded below) ---
		(globalThis as any).Prefs = {
			init: vi.fn().mockResolvedValue(undefined),
			version: -1,
			rows: 3,
			columns: 3,
			history: false,
		};
		(globalThis as any).Blocked = { isBlocked: vi.fn(() => false) };
		(globalThis as any).Filters = { getList: vi.fn(() => ({})) };
		(globalThis as any).NeverCapture = {
			_list: [] as string[],
			matches: vi.fn().mockReturnValue(false),
			matchingEntry: vi.fn().mockReturnValue(undefined),
			hostMatchesPattern(host: string, pattern: string) {
				if (pattern.startsWith('.')) {
					return host === pattern.substring(1) || host.endsWith(pattern);
				}
				return host === pattern;
			},
		};
		(globalThis as any).makeZip = vi.fn().mockResolvedValue(new Blob(['zip-data']));
		(globalThis as any).readZip = vi.fn().mockResolvedValue(undefined);

		// --- Browser / Chrome API gaps (mirrors event-page-resilience.test.ts) ---
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
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({ active: true, windowId: 1, incognito: false });
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
		};

		// --- Bridge the real lib modules onto globalThis (production does this
		// via tiles.js + lib/background-main.js), THEN vm-load background.js
		// (still bridge-mode — reads Tiles/Background/withStore/SAFE_PROTOCOLS
		// as bare identifiers) ---
		(globalThis as any).Tiles = RealTiles;
		(globalThis as any).Background = RealBackground;
		(globalThis as any).withStore = withStore;
		(globalThis as any).SAFE_PROTOCOLS = SAFE_PROTOCOLS;
		(globalThis as any).compareVersions = vi.fn(); // Prefs.history is false below — never actually called.

		// M3: bridge the real lib/capture.js exports onto globalThis, same as
		// production's lib/background-main.js does — background.js is still
		// bridge-mode and reaches the whole capture pipeline as bare
		// identifiers (see this file's own header comment for the pattern).
		(globalThis as any).getTZDateString = getTZDateString;
		(globalThis as any).resetNetworkIdleTimer = resetNetworkIdleTimer;
		(globalThis as any).disarmNetworkIdle = disarmNetworkIdle;
		(globalThis as any).startCaptureSession = startCaptureSession;
		(globalThis as any).removeCaptureSession = removeCaptureSession;
		(globalThis as any).addPendingCapture = addPendingCapture;
		(globalThis as any).takePendingCapture = takePendingCapture;
		(globalThis as any).removePendingCapture = removePendingCapture;
		(globalThis as any).purgeNeverCaptureHost = purgeNeverCaptureHost;

		(globalThis as any).chrome.runtime.onMessage.addListener.mockClear();
		(globalThis as any).chrome.webNavigation.onCompleted.addListener.mockClear();
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		vm.runInThisContext(fs.readFileSync(BACKGROUND_PATH, 'utf8'), { filename: 'background.js' });

		Tiles = (globalThis as any).Tiles;

		const messageCalls = (globalThis as any).chrome.runtime.onMessage.addListener.mock.calls;
		expect(messageCalls.length).toBe(1);
		listener = messageCalls[0][0];

		const navCalls = (globalThis as any).chrome.webNavigation.onCompleted.addListener.mock.calls;
		expect(navCalls.length).toBe(1);
		onCompletedListener = navCalls[0][0];

		// No eager top-level connection warm-up anymore (M2 drops it — see
		// background.js's own comment): background.js's top level now only
		// calls Prefs.init(), nothing touches the DB until the first message
		// or navigation event. Each test below is therefore responsible for
		// triggering the open itself by dispatching its message — see
		// beforeEach's `_resetForTests()`.
	});

	let sendResponse: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		sendResponse = vi.fn();
		Tiles._ready = false;
		Tiles._list = [];
		Tiles._cache = [];
		mockDBInstance._stores.tiles.length = 0;
		mockDBInstance._stores.thumbnails.length = 0;
		mockDBInstance._stores.background.length = 0;
		(globalThis as any).NeverCapture._list = [];

		// Force a fresh "db is still opening" state for this test: no cached
		// connection, no in-flight open promise — lib/db.js's public escape
		// hatch for exactly this (see its own doc comment), replacing the old
		// `if (db) { db.onclose(); }` dance now that there's no raw `db`
		// global to poke. The test's own listener()/onCompletedListener() call
		// below triggers the FIRST `indexedDB.open()` for this test, pushing a
		// new controllable entry onto `pendingOpens` — exactly the "event
		// page just woke, connection still opening" race under test.
		_resetForTests();
	});

	// =========================================================================
	// Tiles.isPinned
	// =========================================================================

	it('Tiles.isPinned — waits for the DB, then responds correctly (was: unhandled rejection, no response)', async () => {
		mockDBInstance._stores.tiles.push({ id: 1, url: 'https://pinned.example.com', position: 0 });

		expect(() => listener(
			{ name: 'Tiles.isPinned', url: 'https://pinned.example.com' }, validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(true));
	});

	// =========================================================================
	// Tiles.getAllTiles (already guarded — regression coverage)
	// =========================================================================

	it('Tiles.getAllTiles — already guarded, still waits for the DB and responds correctly', async () => {
		mockDBInstance._stores.tiles.push({ id: 1, url: 'https://a.com', position: 0 });

		expect(() => listener({ name: 'Tiles.getAllTiles' }, validSender, sendResponse)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		const response = sendResponse.mock.calls[0][0];
		expect(response.list).toEqual(['https://a.com']);
	});

	// =========================================================================
	// Tiles.getTile / putTile / removeTile
	// =========================================================================

	it('Tiles.getTile — waits for the DB, then responds with the tile (was: never responds)', async () => {
		mockDBInstance._stores.tiles.push({ id: 1, url: 'https://b.com', title: 'B', position: 0 });

		expect(() => listener({ name: 'Tiles.getTile', url: 'https://b.com' }, validSender, sendResponse)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(
			expect.objectContaining({ url: 'https://b.com' }),
		));
	});

	it('Tiles.putTile — waits for the DB, then writes and responds (was: never responds)', async () => {
		expect(() => listener(
			{ name: 'Tiles.putTile', tile: { url: 'https://c.com', title: 'C', position: 0 } },
			validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		expect(mockDBInstance._stores.tiles.some(t => t.url === 'https://c.com')).toBe(true);
	});

	it('Tiles.removeTile — waits for the DB, then deletes and responds (was: never responds)', async () => {
		mockDBInstance._stores.tiles.push({ id: 5, url: 'https://d.com', position: 0 });
		Tiles._list.push('https://d.com');

		expect(() => listener(
			{ name: 'Tiles.removeTile', tile: { id: 5, url: 'https://d.com' } },
			validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		expect(mockDBInstance._stores.tiles.some(t => t.id === 5)).toBe(false);
	});

	// =========================================================================
	// Tiles.clear (already guarded — regression coverage)
	// =========================================================================

	it('Tiles.clear — already guarded, waits for the DB and responds', async () => {
		mockDBInstance._stores.tiles.push({ id: 1, url: 'https://e.com', position: 0 });

		expect(() => listener({ name: 'Tiles.clear' }, validSender, sendResponse)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		expect(mockDBInstance._stores.tiles).toHaveLength(0);
	});

	// =========================================================================
	// Background.getBackground (already guarded — regression coverage)
	// =========================================================================

	it('Background.getBackground — already guarded, waits for the DB and responds', async () => {
		mockDBInstance._stores.background.push({ id: 1, color: '#fff' });

		expect(() => listener({ name: 'Background.getBackground' }, validSender, sendResponse)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(
			expect.objectContaining({ color: '#fff' }),
		));
	});

	// =========================================================================
	// Thumbnails.save
	// =========================================================================

	it('Thumbnails.save — dispatching before the DB opens does not throw, and the write lands once it does (was: synchronous throw)', async () => {
		expect(() => listener(
			{ name: 'Thumbnails.save', url: 'https://f.com', image: 'data:image/png;base64,abc' },
			validSender, sendResponse,
		)).not.toThrow();
		expect(mockDBInstance._stores.thumbnails).toHaveLength(0);

		latestOpen().resolve();
		await vi.waitFor(() => expect(
			mockDBInstance._stores.thumbnails.some(t => t.url === 'https://f.com'),
		).toBe(true));
	});

	// =========================================================================
	// Thumbnails.get
	// =========================================================================

	it('Thumbnails.get — dispatching before the DB opens does not throw, and responds with the correct Map once it does (was: synchronous throw)', async () => {
		mockDBInstance._stores.thumbnails.push({ url: 'https://g.com', image: 'data:img', used: '2000-01-01' });

		expect(() => listener(
			{ name: 'Thumbnails.get', urls: ['https://g.com'] }, validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		const sentMap: Map<string, string> = sendResponse.mock.calls[0][0];
		expect(sentMap.get('https://g.com')).toBe('data:img');
	});

	// =========================================================================
	// Thumbnails.getFavicons
	// =========================================================================

	it('Thumbnails.getFavicons — dispatching before the DB opens does not throw, and responds correctly once it does (was: synchronous throw)', async () => {
		mockDBInstance._stores.thumbnails.push({ url: 'https://h.com', favicon: new Blob(['f']) });

		expect(() => listener(
			{ name: 'Thumbnails.getFavicons', urls: ['https://h.com'] }, validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		const sentMap: Map<string, unknown> = sendResponse.mock.calls[0][0];
		expect(sentMap.has('https://h.com')).toBe(true);
	});

	// =========================================================================
	// Thumbnails.getFaviconsByHost
	// =========================================================================

	it('Thumbnails.getFaviconsByHost — dispatching before the DB opens does not throw, and responds correctly once it does (was: synchronous throw)', async () => {
		mockDBInstance._stores.thumbnails.push({ url: 'https://sub.example.com/x', favicon: new Blob(['f']) });

		expect(() => listener(
			{ name: 'Thumbnails.getFaviconsByHost', hosts: ['sub.example.com'] }, validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		const sentMap: Map<string, unknown> = sendResponse.mock.calls[0][0];
		expect(sentMap.has('sub.example.com')).toBe(true);
	});

	// =========================================================================
	// Thumbnails.purgeHost (already guarded internally — regression coverage)
	// =========================================================================

	it('Thumbnails.purgeHost — already guarded, waits for the DB and responds', async () => {
		mockDBInstance._stores.thumbnails.push({ url: 'https://example.com/a', image: new Blob(['a']) });

		expect(() => listener(
			{ name: 'Thumbnails.purgeHost', host: '.example.com' }, validSender, sendResponse,
		)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(
			expect.objectContaining({ thumbnails: 1 }),
		));
	});

	// =========================================================================
	// Thumbnails.clear (already guarded — regression coverage)
	// =========================================================================

	it('Thumbnails.clear — already guarded, waits for the DB and responds', async () => {
		mockDBInstance._stores.thumbnails.push({ url: 'https://example.com/a', image: new Blob(['a']) });

		expect(() => listener({ name: 'Thumbnails.clear' }, validSender, sendResponse)).not.toThrow();
		expect(sendResponse).not.toHaveBeenCalled();

		latestOpen().resolve();
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		expect(mockDBInstance._stores.thumbnails).toHaveLength(0);
	});

	// =========================================================================
	// webNavigation.onCompleted capture path
	// =========================================================================

	describe('webNavigation.onCompleted capture path', () => {
		it('waits for the DB before checking the Tiles cache — no throw, capture proceeds once the DB opens, and _ready is not left stuck true with an empty list', async () => {
			vi.useFakeTimers();
			try {
				mockDBInstance._stores.tiles.push({ id: 1, url: 'https://example.com', position: 0 });
				const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

				expect(() => onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' })).not.toThrow();

				// Give the (pre-fix, buggy) ensureReady() chain every chance to run
				// and get stuck before we resolve the DB.
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);

				// M3: captureSessions moved to lib/capture.js and is module-private
				// (no `globalThis.captureSessions` global to poke anymore) —
				// `_captureSessionsForTests` is the same test-only escape hatch
				// pattern as lib/db.js's `_resetForTests` (a live reference onto the
				// real Map, not a copy).
				const captureSessions = _captureSessionsForTests;
				expect(captureSessions.has(42)).toBe(false); // still waiting on the DB

				latestOpen().resolve();
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);

				expect(captureSessions.has(42)).toBe(true);
				expect(Tiles._cache).toContain('https://example.com');
				// Correctly true now, set only AFTER the successful read (tiles.js §2.2).
				expect(Tiles._ready).toBe(true);
				expect(consoleSpy).not.toHaveBeenCalled();

				captureSessions.get(42) && (captureSessions.get(42) as any).timers.forEach(clearTimeout);
				captureSessions.delete(42);
				consoleSpy.mockRestore();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	// =========================================================================
	// tiles.js §2.2 amplifier (now lib/tiles-store.js), exercised directly: a
	// failing read must not leave _ready stuck true with an empty _list.
	//
	// M2 note: the original version of this test forced a synchronous throw
	// by nulling `globalThis.db` directly — that whole bug class is what M2
	// eliminates by construction (there's no raw `db` to null anymore; every
	// access is readiness-gated through withStore()). The equivalent failure
	// mode that's STILL representable is the connection failing to open at
	// all — so this drives that path instead via the controllable
	// indexedDB.open() mock, and asserts the same postcondition: `_ready`
	// isn't left stuck true by a call that never reached a successful read.
	// =========================================================================

	it('Tiles.getGridTiles — a failed connection open does not leave _ready stuck true (lib/tiles-store.js §2.2)', async () => {
		const promise = Tiles.getGridTiles();
		expect(Tiles._ready).toBe(false);
		latestOpen().reject();
		await expect(promise).rejects.toBeDefined();
		expect(Tiles._ready).toBe(false);
	});
});
