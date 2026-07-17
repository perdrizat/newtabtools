/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: runtime.onMessage boundary characterization.
 * Phase 1 slot 1 of the migration plan (MIGRATION.md).
 *
 * MODERNIZATION.md slice M5 dissolves the former webextension/background.js:
 * this test now drives the real `handleMessage` export of lib/messages.js
 * directly (native import, no vm.runInThisContext — lib/messages.js has real
 * `import` syntax and can't be script-mode-parsed). Its dependencies
 * (Tiles/Background, withStore) are real imports in lib/messages.js itself;
 * this test mutates the SAME singleton `Tiles`/`Background` objects it
 * imports (module instances are shared by resolved path, so replacing a
 * method on the imported object is visible through lib/messages.js's own
 * import of the same module) instead of replacing a `globalThis` bridge.
 * `makeZip`/`readZip` (lib/backup.js) are mocked via `vi.mock` — this test
 * only cares about dispatch plumbing, not the real zip/backup pipeline
 * (covered by backup-restore.test.ts); the mock also transparently covers
 * lib/messages.js's `Export:backup`/`Import:restore` cases now reaching them
 * via a dynamic `import('./backup.js')` instead of a static one (2026-07-09
 * review, adjudicated: keeps the vendored zip ESM tree out of the static
 * import graph), since `vi.mock` intercepts a specifier regardless of
 * whether the importing code uses static or dynamic `import`. `withStore`
 * (lib/db.js) is the REAL implementation, driven by the controllable
 * `indexedDB.open()` mock below — same pattern the rest of this test suite
 * has always used.
 *
 * Mocking strategy:
 *   - jest-webextension-mock (via tests/setup.js) provides chrome/browser stubs
 *   - Tiles/Background have their methods replaced with vi.fn() stubs
 *   - indexedDB.open is mocked to resolve synchronously
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../webextension/lib/backup.js', () => ({
	makeZip: vi.fn().mockResolvedValue(new Blob(['zip-data'])),
	readZip: vi.fn().mockResolvedValue(undefined),
}));

import { handleMessage } from '../../webextension/lib/messages.js';
import { Tiles, Background } from '../../webextension/lib/tiles-store.js';
import { makeZip, readZip } from '../../webextension/lib/backup.js';

const EXTENSION_ID = 'newtabtools@symlink.ch';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Simulates an IDB cursor iteration. When the returned request's `onsuccess`
 * is set, it fires the handler once per entry (with a cursor), then once
 * more with `null` (end of iteration). Synchronous — the entire iteration
 * completes inside the setter call.
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

describe('lib/messages.js — runtime.onMessage boundary (Phase 1 slot 1)', () => {
	let sendResponse: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

	// Shared mock objects (set in beforeAll, referenced in tests)
	let thumbnailStore: Record<string, ReturnType<typeof vi.fn>>;
	let tilesStore: Record<string, ReturnType<typeof vi.fn>>;
	let mockDB: Record<string, unknown>;

	// Senders
	const validSender = { id: EXTENSION_ID };
	const invalidSender = { id: 'evil@example.com' };
	const noIdSender = { url: 'https://evil.example.com' };

	beforeAll(async () => {
		// --- Tiles / Background: mutate the REAL singletons lib/messages.js
		// imports (there is no globalThis bridge to replace anymore). ---
		Object.assign(Tiles, {
			ensureReady: vi.fn().mockResolvedValue({ cache: [], list: [] }),
			isPinned: vi.fn().mockReturnValue(false),
			getGridTiles: vi.fn().mockResolvedValue([]),
			getTile: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' }),
			putTile: vi.fn().mockResolvedValue(undefined),
			removeTile: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
			pinTile: vi.fn().mockResolvedValue(42),
			_list: ['https://pinned.example.com'],
			_cache: [],
			_ready: false,
		});
		Object.assign(Background, {
			getBackground: vi.fn().mockResolvedValue({ data: 'bg-data' }),
			setBackground: vi.fn().mockResolvedValue(undefined),
		});

		// --- Prefs / Blocked / Filters / NeverCapture (dual-scope bridge
		// globals, read via lib/platform.js's accessors inside lib/messages.js
		// and lib/capture.js) ---
		(globalThis as any).Prefs = {
			init: vi.fn().mockResolvedValue(undefined),
			version: -1,
			rows: 3,
			columns: 3,
		};
		(globalThis as any).Blocked = { _list: [] };
		(globalThis as any).Filters = { _list: Object.create(null) };
		// NeverCapture default: list is empty (no URLs blocked from capture).
		// Tests that need a listed host set NeverCapture._list or stub .matches.
		(globalThis as any).NeverCapture = {
			_list: [] as string[],
			matches(url: string) {
				try {
					const host = new URL(url).host;
					return this.matchingEntry(host) !== undefined;
				} catch { return false; }
			},
			matchingEntry(host: string) {
				const dots = this._list.filter((e: string) => e.startsWith('.'));
				return this._list.includes(host) ? host : dots.find(
					(e: string) => host === e.substring(1) || host.endsWith(e)
				);
			},
			hostMatchesPattern(host: string, pattern: string) {
				if (pattern.startsWith('.')) {
					return host === pattern.substring(1) || host.endsWith(pattern);
				}
				return host === pattern;
			},
		};

		// --- Mock DB (IndexedDB) ---
		thumbnailStore = {
			put: vi.fn(),
			get: vi.fn(),
			openCursor: vi.fn(() => mockCursorIteration([])),
			index: vi.fn(() => ({ openCursor: vi.fn(() => mockCursorIteration([])) })),
		};
		tilesStore = {
			put: vi.fn(), get: vi.fn(), getAll: vi.fn(),
			openCursor: vi.fn(() => mockCursorIteration([])), createIndex: vi.fn(),
			indexNames: { contains: () => true } as unknown as ReturnType<typeof vi.fn>,
		};
		const stores: Record<string, unknown> = {
			tiles: tilesStore,
			thumbnails: thumbnailStore,
			background: { put: vi.fn(), get: vi.fn() },
		};
		mockDB = {
			objectStoreNames: { contains: (n: string) => n in stores },
			transaction: vi.fn(() => ({ objectStore: vi.fn((n: string) => stores[n]) })),
			createObjectStore: vi.fn(),
		};

		// Mock indexedDB.open → fires onsuccess synchronously so lib/db.js's
		// initDB resolves.
		const dbReq: Record<string, unknown> = {};
		for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
			Object.defineProperty(dbReq, prop, {
				set: prop === 'onsuccess'
					? function (cb: Function) { cb.call({ result: mockDB }); }
					: function () { /* no-op */ },
				configurable: true,
			});
		}
		(globalThis as any).indexedDB = { open: vi.fn(() => dbReq) };

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.permissions = { contains: vi.fn().mockResolvedValue(true) };
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({ active: true, windowId: 1, incognito: false });
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
	});

	beforeEach(() => {
		sendResponse = vi.fn();
	});

	// ======================== SENDER VALIDATION ========================

	describe('sender validation (audit §2.4 wiring)', () => {
		it('rejects sender with wrong extension id', () => {
			const result = handleMessage({ name: 'Tiles.isPinned', url: 'https://x.com' }, invalidSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('rejects sender with no id (web page)', () => {
			const result = handleMessage({ name: 'Tiles.isPinned' }, noIdSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('rejects null sender', () => {
			const result = handleMessage({ name: 'Tiles.isPinned' }, null, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('rejects undefined sender', () => {
			const result = handleMessage({ name: 'Tiles.isPinned' }, undefined, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('accepts the extension\'s own pages (sender.id matches)', async () => {
			const result = handleMessage({ name: 'Tiles.isPinned', url: 'https://example.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});
	});

	// ======================== TILES HANDLERS ========================

	describe('Tiles handlers', () => {
		it('Tiles.isPinned — sends true for a pinned URL', async () => {
			(Tiles.isPinned as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
			const result = handleMessage({ name: 'Tiles.isPinned', url: 'https://pinned.example.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(true));
		});

		it('Tiles.isPinned — sends false for an unpinned URL', async () => {
			(Tiles.isPinned as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
			const result = handleMessage({ name: 'Tiles.isPinned', url: 'https://nope.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(false));
		});

		it('Tiles.getAllTiles — sends { tiles, list } on success', async () => {
			const fakeTiles = [{ id: 1, url: 'https://a.com' }];
			(Tiles.getGridTiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeTiles);
			Tiles._list = ['https://a.com'];

			const result = handleMessage({ name: 'Tiles.getAllTiles' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() =>
				expect(sendResponse).toHaveBeenCalledWith({ tiles: fakeTiles, list: ['https://a.com'] }),
			);
		});

		it('Tiles.getAllTiles — sends null on error', async () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			(Tiles.getGridTiles as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'));
			const result = handleMessage({ name: 'Tiles.getAllTiles' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			spy.mockRestore();
		});

		it('Tiles.getTile — delegates with message.url', async () => {
			const tile = { url: 'https://b.com', title: 'B' };
			(Tiles.getTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(tile);
			const result = handleMessage({ name: 'Tiles.getTile', url: 'https://b.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(tile));
		});

		it('Tiles.putTile — delegates with message.tile', async () => {
			(Tiles.putTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = handleMessage({ name: 'Tiles.putTile', tile: { url: 'https://c.com' } }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});

		it('Tiles.removeTile — delegates with message.tile', async () => {
			(Tiles.removeTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = handleMessage({ name: 'Tiles.removeTile', tile: { url: 'https://d.com' } }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});

		it('Tiles.clear — calls Tiles.clear() and sends response', async () => {
			(Tiles.clear as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = handleMessage({ name: 'Tiles.clear' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => {
				expect(Tiles.clear).toHaveBeenCalled();
				expect(sendResponse).toHaveBeenCalled();
			});
		});

		it('Tiles.pinTile — sends the new tile id and broadcasts Page.updateGrid', async () => {
			// Slice A (MV3_MIGRATION.md): the getViews() loop is gone; open
			// new-tab pages are told to re-render via a runtime broadcast.
			(Tiles.pinTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(99);
			const result = handleMessage(
				{ name: 'Tiles.pinTile', title: 'My Page', url: 'https://e.com' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => {
				expect(sendResponse).toHaveBeenCalledWith(99);
				expect((globalThis as any).browser.runtime.sendMessage)
					.toHaveBeenCalledWith({ name: 'Page.updateGrid' });
			});
		});

		it('Tiles.pinTile — still responds when no page is open (broadcast rejects)', async () => {
			// With no new-tab page open, runtime.sendMessage rejects with
			// "Receiving end does not exist" — the handler must swallow that
			// and still deliver the pinTile response.
			((globalThis as any).browser.runtime.sendMessage as ReturnType<typeof vi.fn>)
				.mockImplementationOnce(() => Promise.reject(new Error('Receiving end does not exist')));
			(Tiles.pinTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(100);

			handleMessage({ name: 'Tiles.pinTile', title: 'X', url: 'https://x.com' }, validSender, sendResponse);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(100));
		});
	});

	// ======================== BACKGROUND HANDLERS ========================

	describe('Background handlers', () => {
		it('Background.getBackground — sends background data', async () => {
			(Background.getBackground as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: 'image-data' });
			const result = handleMessage({ name: 'Background.getBackground' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ data: 'image-data' }));
		});

		it('Background.getBackground — sends null on error', async () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			(Background.getBackground as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
			const result = handleMessage({ name: 'Background.getBackground' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			spy.mockRestore();
		});

		it('Background.setBackground — delegates with message.file', async () => {
			(Background.setBackground as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = handleMessage({ name: 'Background.setBackground', file: 'blob:...' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});
	});

	// ======================== THUMBNAILS HANDLERS ========================

	describe('Thumbnails handlers', () => {
		beforeEach(() => {
			(mockDB.transaction as ReturnType<typeof vi.fn>).mockClear();
			thumbnailStore.put.mockClear();
			thumbnailStore.openCursor.mockClear();
		});

		it('Thumbnails.save — writes to IDB when url and image are present', async () => {
			const result = handleMessage(
				{ name: 'Thumbnails.save', url: 'https://f.com', image: 'data:image/png;base64,abc' },
				validSender, sendResponse,
			);
			expect(result).toBe(false); // synchronous handler
			await vi.waitFor(() => {
				expect(mockDB.transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('thumbnails', 'readwrite');
				expect(thumbnailStore.put).toHaveBeenCalledWith(
					expect.objectContaining({ url: 'https://f.com', image: 'data:image/png;base64,abc' }),
				);
			});
		});

		it('Thumbnails.save — skips write when url is missing', () => {
			const result = handleMessage(
				{ name: 'Thumbnails.save', image: 'data:image/png;base64,abc' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			expect(mockDB.transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		});

		it('Thumbnails.save — skips write when image is missing', () => {
			const result = handleMessage(
				{ name: 'Thumbnails.save', url: 'https://g.com' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			expect(mockDB.transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		});

		it('Thumbnails.get — sends empty Map when no thumbnails exist', async () => {
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration([]));
			const result = handleMessage(
				{ name: 'Thumbnails.get', urls: ['https://h.com'] },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const sentMap: Map<string, string> = sendResponse.mock.calls[0][0];
			expect(sentMap).toBeInstanceOf(Map);
			expect(sentMap.size).toBe(0);
		});

		it('Thumbnails.get — sends matching thumbnails, omits non-matching', async () => {
			const entries = [
				{ url: 'https://match.com', image: 'data:img1', used: '2026-05-01' },
				{ url: 'https://nomatch.com', image: 'data:img2', used: '2026-05-01' },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));
			const result = handleMessage(
				{ name: 'Thumbnails.get', urls: ['https://match.com'] },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const sentMap: Map<string, string> = sendResponse.mock.calls[0][0];
			expect(sentMap.get('https://match.com')).toBe('data:img1');
			expect(sentMap.has('https://nomatch.com')).toBe(false);
		});
	});

	// ======================== THUMBNAILS.GET/GETFAVICONS — non-array urls guard ========================

	// audit 2026-07-16 m2: both handlers called `message.urls.includes(...)`
	// inside the IDB cursor callback with no Array guard. On a real browser a
	// non-array `urls` (number / plain object / absent — anything lacking
	// `.includes`) threw THERE, aborting the transaction so `sendResponse` never
	// fired and the caller's promise hung forever. The fix guards before the
	// cursor walk: respond with an empty Map and never open a cursor. (The real
	// hang isn't reproducible in this synchronous mock — a throw in the cursor
	// callback rejects the promise here — so the discriminating assertion is
	// "no cursor opened", which directly encodes the guard-before-walk fix.)
	describe('Thumbnails.get / getFavicons — non-array urls guard (m2)', () => {
		beforeEach(() => {
			thumbnailStore.openCursor.mockClear();
		});

		const badPayloads: Array<[string, unknown]> = [
			['a number', 123],
			['a plain object', {}],
			['absent', undefined],
		];

		for (const [label, urls] of badPayloads) {
			it(`Thumbnails.get responds with an empty Map and opens no cursor when urls is ${label}`, async () => {
				const result = handleMessage({ name: 'Thumbnails.get', urls }, validSender, sendResponse);
				expect(result).toBe(true);
				await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
				const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
				expect(map).toBeInstanceOf(Map);
				expect(map.size).toBe(0);
				expect(thumbnailStore.openCursor).not.toHaveBeenCalled();
			});

			it(`Thumbnails.getFavicons responds with an empty Map and opens no cursor when urls is ${label}`, async () => {
				const result = handleMessage({ name: 'Thumbnails.getFavicons', urls }, validSender, sendResponse);
				expect(result).toBe(true);
				await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
				const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
				expect(map).toBeInstanceOf(Map);
				expect(map.size).toBe(0);
				expect(thumbnailStore.openCursor).not.toHaveBeenCalled();
			});
		}
	});

	// ======================== THUMBNAILS.GETFAVICONS ========================

	describe('Thumbnails.getFavicons', () => {
		beforeEach(() => {
			thumbnailStore.openCursor.mockClear();
		});

		it('returns a favicon Blob for a matching url with a cached favicon', async () => {
			const favicon = new Blob(['fav']);
			const entries = [
				{ url: 'https://match.com', favicon },
				{ url: 'https://other.com', favicon: new Blob(['other']) },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			const result = handleMessage(
				{ name: 'Thumbnails.getFavicons', urls: ['https://match.com'] },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.get('https://match.com')).toBe(favicon);
			expect(map.has('https://other.com')).toBe(false);
		});

		it('returns the faviconUrl string when there is no cached favicon Blob', async () => {
			const entries = [
				{ url: 'https://remote.com', faviconUrl: 'https://remote.com/favicon.ico' },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			handleMessage(
				{ name: 'Thumbnails.getFavicons', urls: ['https://remote.com'] },
				validSender, sendResponse,
			);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.get('https://remote.com')).toBe('https://remote.com/favicon.ico');
		});

		it('prefers a cached favicon Blob over faviconUrl when a record has both', async () => {
			const favicon = new Blob(['fav']);
			const entries = [
				{ url: 'https://both.com', favicon, faviconUrl: 'https://both.com/favicon.ico' },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			handleMessage(
				{ name: 'Thumbnails.getFavicons', urls: ['https://both.com'] },
				validSender, sendResponse,
			);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.get('https://both.com')).toBe(favicon);
		});

		it('omits a matching record with neither favicon nor faviconUrl', async () => {
			const entries = [{ url: 'https://bare.com' }];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			handleMessage(
				{ name: 'Thumbnails.getFavicons', urls: ['https://bare.com'] },
				validSender, sendResponse,
			);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.has('https://bare.com')).toBe(false);
		});
	});

	// ======================== THUMBNAILS.GETFAVICONSBYHOST ========================

	describe('Thumbnails.getFaviconsByHost', () => {
		beforeEach(() => {
			thumbnailStore.openCursor.mockClear();
		});

		it('matches by hostname and strips a leading www.', async () => {
			const favicon = new Blob(['fav']);
			const entries = [
				{ url: 'https://www.example.com/page', favicon },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			handleMessage(
				{ name: 'Thumbnails.getFaviconsByHost', hosts: ['example.com'] },
				validSender, sendResponse,
			);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.get('example.com')).toBe(favicon);
		});

		it('first matching record for a host wins; a later record for the same host is ignored', async () => {
			const firstFavicon = new Blob(['first']);
			const secondFavicon = new Blob(['second']);
			const entries = [
				{ url: 'https://example.com/a', favicon: firstFavicon },
				{ url: 'https://example.com/b', favicon: secondFavicon },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			handleMessage(
				{ name: 'Thumbnails.getFaviconsByHost', hosts: ['example.com'] },
				validSender, sendResponse,
			);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.get('example.com')).toBe(firstFavicon);
		});

		it('skips a record with an unparseable url instead of throwing', async () => {
			const entries = [
				{ url: 'not a url', favicon: new Blob(['bad']) },
				{ url: 'https://example.com/x', favicon: new Blob(['good']) },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			expect(() => handleMessage(
				{ name: 'Thumbnails.getFaviconsByHost', hosts: ['example.com'] },
				validSender, sendResponse,
			)).not.toThrow();
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.get('example.com')).toBeInstanceOf(Blob);
			expect(map.size).toBe(1);
		});

		it('omits hosts not in the requested set', async () => {
			const entries = [
				{ url: 'https://notwanted.com/x', favicon: new Blob(['x']) },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(entries));

			handleMessage(
				{ name: 'Thumbnails.getFaviconsByHost', hosts: ['example.com'] },
				validSender, sendResponse,
			);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
			const map: Map<string, unknown> = sendResponse.mock.calls[0][0];
			expect(map.size).toBe(0);
		});
	});

	// ======================== EXPORT / IMPORT HANDLERS ========================

	describe('Export/Import handlers', () => {
		beforeEach(() => {
			(makeZip as ReturnType<typeof vi.fn>).mockClear();
			(readZip as ReturnType<typeof vi.fn>).mockClear();
		});

		it('Export:backup — calls sendResponse with makeZip result', async () => {
			const zipResult = { blob: 'fake-zip-blob' };
			(makeZip as ReturnType<typeof vi.fn>).mockResolvedValueOnce(zipResult);
			const result = handleMessage({ name: 'Export:backup' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(makeZip).toHaveBeenCalled());
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(zipResult));
		});

		it('Export:backup — calls sendResponse(null) instead of hanging when makeZip rejects (audit "also noted" fix)', async () => {
			// Previously `makeZip().then(sendResponse)` had no `.catch` — if
			// the optional `downloads` permission wasn't granted, makeZip()
			// rejected and sendResponse was never called, hanging the export
			// UI. Mirrors the same console.error + sendResponse(null) shape
			// every other rejection-handled case in this dispatcher uses (e.g.
			// 'Background.getBackground').
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			(makeZip as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('downloads permission not granted'));

			const result = handleMessage({ name: 'Export:backup' }, validSender, sendResponse);

			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			expect(consoleErrorSpy).toHaveBeenCalled();

			consoleErrorSpy.mockRestore();
		});

		it('Import:restore — responds { ok: true } on success', async () => {
			(readZip as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = handleMessage(
				{ name: 'Import:restore', file: 'fake-zip-data' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			// readZip is reached via a dynamic import('./backup.js') now (lazy-
			// load, 2026-07-09 review) — one extra microtask hop before it's
			// actually called, so this can no longer be a synchronous assertion.
			await vi.waitFor(() => expect(readZip).toHaveBeenCalledWith('fake-zip-data'));
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
		});

		it('Import:restore — surfaces the error instead of swallowing it on failure', async () => {
			// A malformed backup makes readZip reject. The handler must report the
			// failure (not leave the message hanging / fail silently).
			(readZip as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad zip'));
			const result = handleMessage(
				{ name: 'Import:restore', file: 'corrupt-zip' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(
				expect.objectContaining({ ok: false, error: expect.stringContaining('bad zip') }),
			));
		});
	});

	// ======================== UNKNOWN / EDGE CASES ========================

	describe('unknown and edge-case messages', () => {
		it('returns false for an unknown message name', () => {
			const result = handleMessage({ name: 'NoSuchHandler' }, validSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('returns false when message has no name property', () => {
			const result = handleMessage({}, validSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('returns false for undefined message name', () => {
			const result = handleMessage({ name: undefined }, validSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});
	});

	// ======================== THUMBNAILS.SAVE — NeverCapture guard ========================

	describe('Thumbnails.save — NeverCapture guard', () => {
		beforeEach(() => {
			(mockDB.transaction as ReturnType<typeof vi.fn>).mockClear();
			thumbnailStore.put.mockClear();
			// Reset NeverCapture list
			(globalThis as any).NeverCapture._list = [];
		});

		it('skips IDB write when the url host is in the never-capture list', () => {
			(globalThis as any).NeverCapture._list = ['f.com'];
			const result = handleMessage(
				{ name: 'Thumbnails.save', url: 'https://f.com', image: 'data:image/png;base64,abc' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			expect(thumbnailStore.put).not.toHaveBeenCalled();
		});

		it('still writes when the url host is NOT in the never-capture list', async () => {
			(globalThis as any).NeverCapture._list = ['other.com'];
			const result = handleMessage(
				{ name: 'Thumbnails.save', url: 'https://f.com', image: 'data:image/png;base64,abc' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			await vi.waitFor(() => expect(thumbnailStore.put).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://f.com' }),
			));
		});
	});

	// ======================== THUMBNAILS.PURGEHOST ========================

	describe('Thumbnails.purgeHost', () => {
		beforeEach(() => {
			(mockDB.transaction as ReturnType<typeof vi.fn>).mockClear();
			thumbnailStore.put.mockClear();
			thumbnailStore.openCursor.mockClear();
			tilesStore.openCursor.mockClear();
			// Reset NeverCapture list
			(globalThis as any).NeverCapture._list = [];
		});

		it('invalid host (missing) → responds null, opens no cursor', async () => {
			const result = handleMessage(
				{ name: 'Thumbnails.purgeHost' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			expect(thumbnailStore.openCursor).not.toHaveBeenCalled();
		});

		it('empty host string → responds null, opens no cursor', async () => {
			const result = handleMessage(
				{ name: 'Thumbnails.purgeHost', host: '' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			expect(thumbnailStore.openCursor).not.toHaveBeenCalled();
		});

		it('non-string host → responds null', async () => {
			const result = handleMessage(
				{ name: 'Thumbnails.purgeHost', host: 42 },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
		});

		it('deletes matching thumbnail records and keeps non-matching', async () => {
			const thumbEntries = [
				{ url: 'https://example.com/a', image: new Blob(['a']) },
				{ url: 'https://sub.example.com/b', image: new Blob(['b']) },
				{ url: 'https://other.com/', image: new Blob(['c']) },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(thumbEntries));
			// Tiles pass: empty
			tilesStore.openCursor.mockReturnValueOnce(mockCursorIteration([]));

			const result = handleMessage(
				{ name: 'Thumbnails.purgeHost', host: '.example.com' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
			const response = sendResponse.mock.calls[0][0];
			// 2 matching thumbnails deleted
			expect(response.thumbnails).toBe(2);
			expect(response.tiles).toBe(0);
		});

		it('tiles pass: removes image+imageIsThumbnail from matching tiles with auto-thumbnail', async () => {
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration([]));
			const tileEntries = [
				{ url: 'https://example.com/a', image: new Blob(['img']), imageIsThumbnail: true },
				{ url: 'https://other.com/', image: new Blob(['custom']) }, // no imageIsThumbnail
				{ url: 'https://example.com/b', image: new Blob(['img2']), imageIsThumbnail: true },
			];
			tilesStore.openCursor.mockReturnValueOnce(mockCursorIteration(tileEntries));

			const result = handleMessage(
				{ name: 'Thumbnails.purgeHost', host: '.example.com' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
			const response = sendResponse.mock.calls[0][0];
			expect(response.thumbnails).toBe(0);
			// 2 tiles with imageIsThumbnail updated (image fields stripped)
			expect(response.tiles).toBe(2);
		});

		it('tiles with custom image (no imageIsThumbnail) are untouched', async () => {
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration([]));
			const tileEntries = [
				{ url: 'https://example.com/page', image: new Blob(['custom']) },
				// No imageIsThumbnail → must NOT be updated
			];
			const cursorReq = mockCursorIteration(tileEntries);
			tilesStore.openCursor.mockReturnValueOnce(cursorReq);

			handleMessage(
				{ name: 'Thumbnails.purgeHost', host: '.example.com' },
				validSender, sendResponse,
			);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
			const response = sendResponse.mock.calls[0][0];
			// Custom image → not counted as purged
			expect(response.tiles).toBe(0);
		});

		it('responds with {thumbnails, tiles} counts on success', async () => {
			const thumbEntries = [
				{ url: 'https://example.com/x', image: new Blob(['x']) },
			];
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration(thumbEntries));
			const tileEntries = [
				{ url: 'https://example.com/y', image: new Blob(['y']), imageIsThumbnail: true },
			];
			tilesStore.openCursor.mockReturnValueOnce(mockCursorIteration(tileEntries));

			handleMessage(
				{ name: 'Thumbnails.purgeHost', host: '.example.com' },
				validSender, sendResponse,
			);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
			const response = sendResponse.mock.calls[0][0];
			expect(response).toMatchObject({ thumbnails: 1, tiles: 1 });
		});
	});
});
