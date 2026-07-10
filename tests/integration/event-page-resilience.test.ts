/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: event-page respawn resilience (MV3 migration Slice B,
 * see MV3_MIGRATION.md "Event-page respawn hygiene" / "IndexedDB").
 *
 * Under MV3 the background becomes an event page torn down after ~30s idle
 * and respawned by events — top-level code re-runs on every respawn. This
 * file characterizes two of the three respawn-safety mechanisms:
 *
 *   1. `browser.menus.create` is duplicate-tolerant (a respawn re-creating
 *      an existing menu id must not throw or log) — lib/platform.js's
 *      `createMenuTolerant()`, a real export now imported directly.
 *   2. The one-shot idle-cleanup listener re-arms per respawn, but
 *      `cleanupThumbnails()` itself is guarded to run at most once a day.
 *
 * The THIRD mechanism — IndexedDB reconnect (onclose/onversionchange +
 * dedup + retry) — is tested via native `import` against lib/db.js directly
 * (tests/integration/db-wake-race.test.ts), since that logic is module-
 * private there, not something this file could poke.
 *
 * MODERNIZATION.md slice M5 dissolves the former webextension/background.js:
 * both mechanisms under test here now live in lib/background-main.js's own
 * top level (menus creation + the idle listener registration) — reaching
 * them means natively importing the real entry point, which side-effect-
 * imports the REAL common.js/prefs.js (Decision 2's dual-scope bridge files
 * stay bridge-mode permanently). `idleListener` itself is not exported (a
 * background-main.js-private top-level function), so it's captured the same
 * way production reaches it — from `chrome.idle.onStateChanged.addListener`'s
 * mock call args — matching this file's pre-M5 convention.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMenuTolerant } from '../../webextension/lib/platform.js';
import { Prefs } from '../../webextension/prefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const EXTENSION_ID = 'newtabtools@symlink.ch';

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

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

describe('lib/background-main.js — event-page respawn resilience (Slice B)', () => {
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

		// --- Browser / Chrome API gaps (background-main.js's top-level
		// registrations need these to exist or import() throws synchronously) ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn((p: string) => `moz-extension://test-uuid/${p}`);
		(globalThis as any).chrome.management = { getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }) };
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
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({});
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n.getMessage = vi.fn((k: string) => k);
		(globalThis as any).chrome.permissions.contains = vi.fn().mockResolvedValue(true);
		(globalThis as any).chrome.action = {
			enable: vi.fn().mockResolvedValue(undefined),
			disable: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).browser.runtime.onStartup = { addListener: vi.fn() };

		// --- Native import() of the real background entry point ---
		await import(/* @vite-ignore */ webext('lib/background-main.js'));

		// Flush the top-level Prefs.init() chain. `Prefs` is a real,
		// statically-imported binding now (chrome-prep C3d retired the
		// `globalThis` bridge) — same module instance
		// lib/background-main.js's own import resolves to.
		await vi.waitFor(() => expect(typeof Prefs.init).toBe('function'));
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
			const calls = ((globalThis as any).chrome.idle.onStateChanged.addListener as ReturnType<typeof vi.fn>).mock.calls;
			idleListener = calls[calls.length - 1][0];
		});

		it('runs cleanupThumbnails and records today on the first idle transition with no prior run', async () => {
			idleListener('idle');
			// idleListener reads storage.local via the promise-based
			// `browser.storage.local.get`, and cleanupThumbnails() itself goes
			// through withStore() (M2) — each adds a variable number of
			// microtask hops (withStore's includes the lazy indexedDB.open() on
			// this file's first call), so poll for the eventual call instead of
			// counting ticks.
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
