/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: event-page respawn resilience (MV3 migration Slice B,
 * see MV3_MIGRATION.md "Event-page respawn hygiene" / "IndexedDB").
 *
 * Under MV3 the background becomes an event page torn down after ~30s idle
 * and respawned by events — top-level code re-runs on every respawn. This
 * file characterizes the three respawn-safety mechanisms added in Slice B,
 * loading the real `background.js` (script-mode) the same way
 * `background-messages.test.ts` does:
 *
 *   1. `browser.menus.create` is duplicate-tolerant (a respawn re-creating
 *      an existing menu id must not throw or log).
 *   2. IndexedDB reconnect: `onclose`/`onversionchange` clear `db`, and
 *      `waitForDB()` re-runs `initDB()` from an unset/broken connection
 *      instead of being doomed for the context's lifetime, while still
 *      deduping concurrent callers onto one in-flight open.
 *   3. The one-shot idle-cleanup listener re-arms per respawn, but
 *      `cleanupThumbnails()` itself is now guarded to run at most once a day.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND_PATH = path.resolve(__dirname, '../../webextension/background.js');
const EXTENSION_ID = 'newtabtools@symlink.ch';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Simulates an IDB cursor iteration (see background-messages.test.ts for the
 * canonical version of this helper — duplicated here to keep this file
 * self-contained per the project's existing per-file mocking convention).
 */
function mockCursorIteration(entries: Array<Record<string, unknown>>) {
	let index = 0;
	let handler: Function;
	const request: Record<string, unknown> = {};

	const advance = () => {
		if (index < entries.length) {
			const entry = entries[index++];
			const cursor = {
				value: { ...entry },
				update: vi.fn(),
				continue: () => advance(),
				delete: vi.fn(),
			};
			handler.call({ result: cursor });
		} else {
			handler.call({ result: null });
		}
	};

	Object.defineProperty(request, 'onsuccess', {
		set(cb: Function) { handler = cb; advance(); },
		configurable: true,
	});

	return request;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('background.js — event-page respawn resilience (Slice B)', () => {
	let mockDB: Record<string, unknown>;
	let thumbnailStore: Record<string, ReturnType<typeof vi.fn>>;

	// Controllable indexedDB.open mock: each call fires asynchronously
	// (microtask) with either the shared mockDB (default: 'success') or an
	// error event, driven by a per-call queue so tests can script a specific
	// open outcome without touching the earlier calls already made at load.
	let openQueue: Array<'success' | 'error'>;
	let openMock: ReturnType<typeof vi.fn>;

	function installControllableIndexedDB() {
		openQueue = [];
		openMock = vi.fn(() => {
			const behavior = openQueue.length ? openQueue.shift() : 'success';
			const handlers: Record<string, Function> = {};
			const req: Record<string, unknown> = {};
			for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
				Object.defineProperty(req, prop, {
					set(cb: Function) { handlers[prop] = cb; },
					configurable: true,
				});
			}
			// Fire after the synchronous handler-assignment block in initDB()
			// completes, mirroring IndexedDB's real async open.
			Promise.resolve().then(() => {
				if (behavior === 'error' && handlers.onerror) {
					handlers.onerror(new Event('error'));
				} else if (handlers.onsuccess) {
					handlers.onsuccess.call({ result: mockDB });
				}
			});
			return req;
		});
		(globalThis as any).indexedDB = { open: openMock };
	}

	beforeAll(async () => {
		// --- Tiles / Background / Prefs / Blocked / Filters / NeverCapture ---
		(globalThis as any).Tiles = {
			ensureReady: vi.fn().mockResolvedValue({ cache: [], list: [] }),
			isPinned: vi.fn().mockReturnValue(false),
			getAllTiles: vi.fn().mockResolvedValue([]),
			getTile: vi.fn().mockResolvedValue(null),
			putTile: vi.fn().mockResolvedValue(undefined),
			removeTile: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
			pinTile: vi.fn().mockResolvedValue(1),
			_list: [],
			_cache: [],
			_ready: false,
		};
		(globalThis as any).Background = {
			getBackground: vi.fn().mockResolvedValue(null),
			setBackground: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).Prefs = {
			init: vi.fn().mockResolvedValue(undefined),
			version: -1,
			rows: 3,
			columns: 3,
		};
		(globalThis as any).Blocked = { _list: [] };
		(globalThis as any).Filters = { _list: Object.create(null) };
		(globalThis as any).NeverCapture = {
			_list: [] as string[],
			matches: vi.fn().mockReturnValue(false),
			matchingEntry: vi.fn().mockReturnValue(undefined),
			hostMatchesPattern: vi.fn().mockReturnValue(false),
		};
		(globalThis as any).makeZip = vi.fn().mockResolvedValue(new Blob(['zip-data']));
		(globalThis as any).readZip = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).compareVersions = vi.fn().mockReturnValue(0);

		// --- Mock DB (IndexedDB) ---
		thumbnailStore = {
			put: vi.fn(),
			get: vi.fn(),
			delete: vi.fn(),
			openCursor: vi.fn(() => mockCursorIteration([])),
			index: vi.fn(() => ({ openCursor: vi.fn(() => mockCursorIteration([])) })),
		};
		const stores: Record<string, unknown> = {
			tiles: {
				put: vi.fn(), get: vi.fn(), getAll: vi.fn(),
				openCursor: vi.fn(() => mockCursorIteration([])), createIndex: vi.fn(),
				indexNames: { contains: () => true },
			},
			thumbnails: thumbnailStore,
			background: { put: vi.fn(), get: vi.fn() },
		};
		mockDB = {
			objectStoreNames: { contains: (n: string) => n in stores },
			transaction: vi.fn(() => ({ objectStore: vi.fn((n: string) => stores[n]) })),
			createObjectStore: vi.fn(),
			// Real onversionchange handlers call db.close() before clearing db.
			close: vi.fn(),
		};

		installControllableIndexedDB();
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		// --- Browser / Chrome API gaps (mirrors background-messages.test.ts) ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn(
			(p: string) => `moz-extension://test-uuid/${p}`,
		);
		(globalThis as any).chrome.management = {
			getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }),
		};
		(globalThis as any).browser.menus = {
			create: vi.fn((_props: unknown, cb?: Function) => {
				if (cb) { cb(); }
			}),
			update: vi.fn(),
			refresh: vi.fn(),
			onShown: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.idle = {
			onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		};
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({});
		// Default mock (jest-webextension-mock) resolves with `[{}]`, whose
		// missing `.url` throws inside the top-level `new URL(tab.url)` check —
		// override to the empty-tabs case used by the other background.js tests.
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };

		// --- Load background.js (script-mode, runs in global scope) ---
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const code = fs.readFileSync(BACKGROUND_PATH, 'utf8');
		vm.runInThisContext(code, { filename: 'background.js' });

		// Flush microtasks so the init Promise.all (Prefs.init + waitForDB) resolves.
		await new Promise(resolve => setTimeout(resolve, 0));
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	// ======================== 1. Duplicate-tolerant menus ========================

	describe('menus.create — duplicate-tolerant (respawn hygiene)', () => {
		it('registers all five context menu items with unchanged ids/titles/contexts', () => {
			const calls = ((globalThis as any).browser.menus.create as ReturnType<typeof vi.fn>).mock.calls;
			expect(calls.map(c => c[0])).toEqual([
				{ id: 'edit', title: 'contextmenu_edit', contexts: ['link'] },
				{ id: 'pin', title: 'contextmenu_pin', contexts: ['link'] },
				{ id: 'unpin', title: 'contextmenu_unpin', contexts: ['link'] },
				{ id: 'block', title: 'contextmenu_block', contexts: ['link'] },
				{ id: 'options', title: 'contextmenu_options', contexts: ['page'] },
			]);
		});

		it('passes a callback to every create() call', () => {
			const calls = ((globalThis as any).browser.menus.create as ReturnType<typeof vi.fn>).mock.calls;
			expect(calls).toHaveLength(5);
			for (const call of calls) {
				expect(typeof call[1]).toBe('function');
			}
		});

		it('does not throw or log when the create callback reports a duplicate-id lastError', () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			(globalThis as any).browser.runtime.lastError = { message: 'The menu id "edit" already exists' };

			const createMenuTolerant = (globalThis as any).createMenuTolerant as Function;
			expect(() => createMenuTolerant({ id: 'edit', title: 'x', contexts: ['link'] })).not.toThrow();

			delete (globalThis as any).browser.runtime.lastError;
			expect(consoleErrorSpy).not.toHaveBeenCalled();
			consoleErrorSpy.mockRestore();
		});
	});

	// ======================== 2. IndexedDB reconnect ========================

	describe('IndexedDB reconnect', () => {
		beforeEach(async () => {
			openQueue = [];
			// Normalize starting state: db must be connected before each test's
			// disconnect scenario (a prior test may have left it disconnected).
			if (!(globalThis as any).db) {
				await (globalThis as any).waitForDB();
			}
		});

		it('attaches onclose/onversionchange handlers after a successful open', () => {
			const db = (globalThis as any).db;
			expect(db).toBe(mockDB);
			expect(typeof db.onclose).toBe('function');
			expect(typeof db.onversionchange).toBe('function');
		});

		it('reopens the connection after onclose fires, resolving waitForDB() again', async () => {
			const callsBefore = openMock.mock.calls.length;
			(globalThis as any).db.onclose();
			expect((globalThis as any).db).toBeUndefined();

			const waitForDB = (globalThis as any).waitForDB as Function;
			await waitForDB();

			expect(openMock.mock.calls.length).toBe(callsBefore + 1);
			expect((globalThis as any).db).toBe(mockDB);
		});

		it('reopens the connection after onversionchange fires (closes then clears db)', async () => {
			const callsBefore = openMock.mock.calls.length;
			(globalThis as any).db.onversionchange();
			expect((globalThis as any).db).toBeUndefined();

			const waitForDB = (globalThis as any).waitForDB as Function;
			await waitForDB();

			expect(openMock.mock.calls.length).toBe(callsBefore + 1);
			expect((globalThis as any).db).toBe(mockDB);
		});

		it('dedupes concurrent callers onto a single in-flight initDB() call', async () => {
			(globalThis as any).db.onclose();
			const callsBefore = openMock.mock.calls.length;

			const waitForDB = (globalThis as any).waitForDB as Function;
			const p1 = waitForDB();
			const p2 = waitForDB();

			// Both calls happened before the mocked open() resolved (still
			// microtask-pending) — only one new indexedDB.open() call should
			// have been made for the pair.
			expect(openMock.mock.calls.length).toBe(callsBefore + 1);

			await Promise.all([p1, p2]);
			expect((globalThis as any).db).toBe(mockDB);
		});

		it('rejects current callers on open failure, then a later call retries and resolves', async () => {
			(globalThis as any).db.onclose();
			openQueue.push('error');

			const waitForDB = (globalThis as any).waitForDB as Function;
			await expect(waitForDB()).rejects.toBeDefined();
			expect((globalThis as any).db).toBeUndefined();

			// A LATER call (after the failed one settled) retries from scratch —
			// queue is empty now, so the mock defaults to success.
			const callsBefore = openMock.mock.calls.length;
			await waitForDB();

			expect(openMock.mock.calls.length).toBe(callsBefore + 1);
			expect((globalThis as any).db).toBe(mockDB);
		});
	});

	// ======================== 3. Idle-cleanup guard ========================

	describe('idle-cleanup: cleanupThumbnails runs at most once per day', () => {
		let idleListener: Function;

		beforeEach(async () => {
			// Ensure db is connected (the IndexedDB describe block above may
			// have left it disconnected on a shared background.js load).
			if (!(globalThis as any).db) {
				await (globalThis as any).waitForDB();
			}
			await (globalThis as any).chrome.storage.local.clear();
			thumbnailStore.index.mockClear();
			idleListener = (globalThis as any).idleListener;
		});

		it('runs cleanupThumbnails and records today on the first idle transition with no prior run', async () => {
			idleListener('idle');
			// idleListener now reads storage.local via the promise-based
			// `browser.storage.local.get` (Slice C of the MV3 migration) — the
			// cleanup decision lands a microtask later than the old callback form.
			await Promise.resolve();
			expect(thumbnailStore.index).toHaveBeenCalledTimes(1);

			const stored = await (globalThis as any).chrome.storage.local.get('thumbnailCleanupLastRun');
			expect(typeof stored.thumbnailCleanupLastRun).toBe('string');
		});

		it('skips cleanupThumbnails on a second idle transition claiming the same day (next respawn)', async () => {
			idleListener('idle');
			await Promise.resolve();
			expect(thumbnailStore.index).toHaveBeenCalledTimes(1);
			thumbnailStore.index.mockClear();

			// Simulate the next MV3 respawn: the listener re-arms and fires again
			// the same day — cleanupThumbnails must not run a second time.
			idleListener('idle');
			await Promise.resolve();
			expect(thumbnailStore.index).not.toHaveBeenCalled();
		});

		it('runs again once the stored last-run date is an earlier day', async () => {
			await (globalThis as any).chrome.storage.local.set({ thumbnailCleanupLastRun: '2000-01-01' });
			idleListener('idle');
			await Promise.resolve();
			expect(thumbnailStore.index).toHaveBeenCalledTimes(1);
		});

		it('calls chrome.idle.onStateChanged.removeListener on every idle transition (one-shot per respawn, unchanged)', () => {
			const removeListenerMock = (globalThis as any).chrome.idle.onStateChanged.removeListener as ReturnType<typeof vi.fn>;
			removeListenerMock.mockClear();
			idleListener('idle');
			expect(removeListenerMock).toHaveBeenCalledWith(idleListener);
		});

		it('does nothing for non-idle states', () => {
			idleListener('active');
			expect(thumbnailStore.index).not.toHaveBeenCalled();
		});
	});
});
