/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: event-page respawn resilience (MV3 migration Slice B,
 * see MV3_MIGRATION.md "Event-page respawn hygiene" / "IndexedDB").
 *
 * Under MV3 the background becomes an event page torn down after ~30s idle
 * and respawned by events — top-level code re-runs on every respawn. This
 * file characterizes two of the three respawn-safety mechanisms added in
 * Slice B, loading the real `background.js` (script-mode) the same way
 * `background-messages.test.ts` does:
 *
 *   1. `browser.menus.create` is duplicate-tolerant (a respawn re-creating
 *      an existing menu id must not throw or log).
 *   2. The one-shot idle-cleanup listener re-arms per respawn, but
 *      `cleanupThumbnails()` itself is now guarded to run at most once a day.
 *
 * The THIRD mechanism — IndexedDB reconnect (onclose/onversionchange +
 * dedup + retry) — moved to tests/integration/db-connection.test.ts in M2
 * (MODERNIZATION.md): that logic now lives in lib/db.js as a real ES module
 * (`withStore`), not a `globalThis.db`/`globalThis.waitForDB()` pair this
 * file could poke directly, so it's tested via native `import` against
 * lib/db.js instead of through background.js's vm-loaded script scope.
 *
 * background.js is still a bridge-mode file (MODERNIZATION.md Decision 2 —
 * no `import` syntax until its own carve-up in M3/M5), so it reads
 * `withStore`/`SAFE_PROTOCOLS` as bare identifiers off `globalThis`. This
 * test file provides them the same way production's lib/background-main.js
 * does: a real `import` of the lib module, then a `globalThis.X = X`
 * assignment before vm-loading background.js. This pattern repeats in every
 * remaining test that still vm-loads background.js/export.js and will
 * repeat again in M3/M4 as more of the bridge surface grows.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { withStore } from '../../webextension/lib/db.js';
import { SAFE_PROTOCOLS } from '../../webextension/lib/constants.js';
import { getTZDateString, resetNetworkIdleTimer } from '../../webextension/lib/capture.js';

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
	let thumbnailStore: Record<string, ReturnType<typeof vi.fn>>;

	function installAutoResolvingIndexedDB() {
		const stores: Record<string, unknown> = {
			tiles: {
				put: vi.fn(), get: vi.fn(), getAll: vi.fn(),
				openCursor: vi.fn(() => mockCursorIteration([])), createIndex: vi.fn(),
				indexNames: { contains: () => true },
			},
			thumbnails: thumbnailStore,
			background: { put: vi.fn(), get: vi.fn() },
		};
		const mockDB = {
			objectStoreNames: { contains: (n: string) => n in stores },
			transaction: vi.fn(() => ({ objectStore: vi.fn((n: string) => stores[n]) })),
			createObjectStore: vi.fn(),
			close: vi.fn(),
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

	beforeAll(async () => {
		// --- Tiles / Background / Prefs / Blocked / Filters / NeverCapture ---
		(globalThis as any).Tiles = {
			ensureReady: vi.fn().mockResolvedValue({ cache: [], list: [] }),
			isPinned: vi.fn().mockReturnValue(false),
			getGridTiles: vi.fn().mockResolvedValue([]),
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
		installAutoResolvingIndexedDB();
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		// M2: bridge the real lib/db.js withStore() and lib/constants.js
		// SAFE_PROTOCOLS onto globalThis (see the file header comment).
		(globalThis as any).withStore = withStore;
		(globalThis as any).SAFE_PROTOCOLS = SAFE_PROTOCOLS;

		// M3: bridge lib/capture.js's exports background.js needs — the
		// webRequest listeners' resetNetworkIdleTimer closure at load time, and
		// getTZDateString (idleListener/cleanupThumbnails, both under test here).
		(globalThis as any).getTZDateString = getTZDateString;
		(globalThis as any).resetNetworkIdleTimer = resetNetworkIdleTimer;

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

		// Flush microtasks so the init Prefs.init() chain resolves.
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

	// ======================== 2. Idle-cleanup guard ========================

	describe('idle-cleanup: cleanupThumbnails runs at most once per day', () => {
		let idleListener: Function;

		beforeEach(async () => {
			await (globalThis as any).chrome.storage.local.clear();
			thumbnailStore.index.mockClear();
			idleListener = (globalThis as any).idleListener;
		});

		it('runs cleanupThumbnails and records today on the first idle transition with no prior run', async () => {
			idleListener('idle');
			// idleListener reads storage.local via the promise-based
			// `browser.storage.local.get` (Slice C of the MV3 migration), and
			// cleanupThumbnails() itself now goes through withStore() (M2) —
			// each adds a variable number of microtask hops (withStore's
			// includes the lazy indexedDB.open() on this file's first call),
			// so poll for the eventual call instead of counting ticks.
			await vi.waitFor(() => expect(thumbnailStore.index).toHaveBeenCalledTimes(1));

			const stored = await (globalThis as any).chrome.storage.local.get('thumbnailCleanupLastRun');
			expect(typeof stored.thumbnailCleanupLastRun).toBe('string');
		});

		it('skips cleanupThumbnails on a second idle transition claiming the same day (next respawn)', async () => {
			idleListener('idle');
			await vi.waitFor(() => expect(thumbnailStore.index).toHaveBeenCalledTimes(1));
			thumbnailStore.index.mockClear();

			// Simulate the next MV3 respawn: the listener re-arms and fires again
			// the same day — cleanupThumbnails must not run a second time.
			idleListener('idle');
			// Flush generously — there's nothing to poll FOR (we're asserting an
			// absence), so give any wrongly-scheduled call every chance to land.
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
			}
			expect(thumbnailStore.index).not.toHaveBeenCalled();
		});

		it('runs again once the stored last-run date is an earlier day', async () => {
			await (globalThis as any).chrome.storage.local.set({ thumbnailCleanupLastRun: '2000-01-01' });
			idleListener('idle');
			await vi.waitFor(() => expect(thumbnailStore.index).toHaveBeenCalledTimes(1));
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
