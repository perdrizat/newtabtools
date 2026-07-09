/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: runtime.onMessage boundary characterization.
 * Phase 1 slot 1 of the migration plan (MIGRATION.md).
 *
 * Loads the real `background.js` (script-mode legacy code) via
 * `vm.runInThisContext` into a mocked environment and exercises every
 * message handler through the `chrome.runtime.onMessage` listener.
 * Pins current behaviour — including known bugs — before any rewrite
 * touches the message protocol.
 *
 * Mocking strategy:
 *   - jest-webextension-mock (via tests/setup.js) provides chrome/browser stubs
 *   - Tiles, Background, Prefs, etc. are vi.fn() stubs on globalThis
 *   - indexedDB.open is mocked to resolve initDB synchronously
 *   - The onMessage listener is captured from the mock after script load
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { withStore } from '../../webextension/lib/db.js';
import { SAFE_PROTOCOLS } from '../../webextension/lib/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKGROUND_PATH = path.resolve(__dirname, '../../webextension/background.js');

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

describe('background.js — runtime.onMessage boundary (Phase 1 slot 1)', () => {
	type MessageListener = (message: any, sender: any, sendResponse: any) => boolean | undefined | void;

	let listener: MessageListener;
	let sendResponse: ReturnType<typeof vi.fn>;

	// Shared mock objects (set in beforeAll, referenced in tests)
	let mockTiles: Record<string, ReturnType<typeof vi.fn> | unknown>;
	let mockBackground: Record<string, ReturnType<typeof vi.fn>>;
	let mockMakeZip: ReturnType<typeof vi.fn>;
	let mockReadZip: ReturnType<typeof vi.fn>;
	let thumbnailStore: Record<string, ReturnType<typeof vi.fn>>;
	let tilesStore: Record<string, ReturnType<typeof vi.fn>>;
	let mockDB: Record<string, unknown>;

	// Senders
	const validSender = { id: EXTENSION_ID };
	const invalidSender = { id: 'evil@example.com' };
	const noIdSender = { url: 'https://evil.example.com' };

	beforeAll(async () => {
		// --- Tiles ---
		mockTiles = {
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
		};
		(globalThis as any).Tiles = mockTiles;

		// --- Background ---
		mockBackground = {
			getBackground: vi.fn().mockResolvedValue({ data: 'bg-data' }),
			setBackground: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).Background = mockBackground;

		// --- Prefs (plain-object mock; init resolves immediately) ---
		(globalThis as any).Prefs = {
			init: vi.fn().mockResolvedValue(undefined),
			version: -1,
			rows: 3,
			columns: 3,
		};

		// --- Blocked / Filters / NeverCapture ---
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

		// --- makeZip / readZip ---
		mockMakeZip = vi.fn().mockResolvedValue(new Blob(['zip-data']));
		(globalThis as any).makeZip = mockMakeZip;
		mockReadZip = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).readZip = mockReadZip;

		// --- compareVersions ---
		(globalThis as any).compareVersions = vi.fn().mockReturnValue(0);

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

		// Mock indexedDB.open → fires onsuccess synchronously so initDB resolves
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

		// M2: background.js reads `withStore` off globalThis (it's still
		// bridge-mode — see lib/background-main.js) instead of touching a raw
		// `db` global. Bridge the real lib/db.js implementation here so it
		// drives the SAME indexedDB.open mock above (this pattern — real
		// import + globalThis bridge assignment in the test file itself —
		// repeats for every test that still vm-loads background.js; see
		// db-wake-race.test.ts / event-page-resilience.test.ts for the same
		// idiom).
		(globalThis as any).withStore = withStore;
		(globalThis as any).SAFE_PROTOCOLS = SAFE_PROTOCOLS;

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn(
			(p: string) => `moz-extension://test-uuid/${p}`,
		);
		(globalThis as any).chrome.management = {
			getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }),
		};
		(globalThis as any).browser.menus = {
			create: vi.fn(),
			update: vi.fn(),
			refresh: vi.fn(),
			onShown: { addListener: vi.fn() },
		};
		if (!(globalThis as any).chrome.idle?.onStateChanged) {
			(globalThis as any).chrome.idle = {
				onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() },
			};
		}
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };

		// --- Load background.js (script-mode, runs in global scope) ---
		(globalThis as any).chrome.runtime.onMessage.addListener.mockClear();
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const code = fs.readFileSync(BACKGROUND_PATH, 'utf8');
		vm.runInThisContext(code, { filename: 'background.js' });

		// Flush microtasks so the init Promise.all resolves
		await new Promise(resolve => setTimeout(resolve, 0));

		// --- Capture the listener ---
		const calls = (globalThis as any).chrome.runtime.onMessage.addListener.mock.calls;
		expect(calls.length).toBe(1);
		listener = calls[0][0] as MessageListener;
	});

	beforeEach(() => {
		sendResponse = vi.fn();
	});

	// ======================== SENDER VALIDATION ========================

	describe('sender validation (audit §2.4 wiring)', () => {
		it('rejects sender with wrong extension id', () => {
			const result = listener({ name: 'Tiles.isPinned', url: 'https://x.com' }, invalidSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('rejects sender with no id (web page)', () => {
			const result = listener({ name: 'Tiles.isPinned' }, noIdSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('rejects null sender', () => {
			const result = listener({ name: 'Tiles.isPinned' }, null, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('rejects undefined sender', () => {
			const result = listener({ name: 'Tiles.isPinned' }, undefined, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('accepts the extension\'s own pages (sender.id matches)', async () => {
			const result = listener({ name: 'Tiles.isPinned', url: 'https://example.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});
	});

	// ======================== TILES HANDLERS ========================

	describe('Tiles handlers', () => {
		it('Tiles.isPinned — sends true for a pinned URL', async () => {
			(mockTiles.isPinned as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
			const result = listener({ name: 'Tiles.isPinned', url: 'https://pinned.example.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(true));
		});

		it('Tiles.isPinned — sends false for an unpinned URL', async () => {
			(mockTiles.isPinned as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
			const result = listener({ name: 'Tiles.isPinned', url: 'https://nope.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(false));
		});

		it('Tiles.getAllTiles — sends { tiles, list } on success', async () => {
			const fakeTiles = [{ id: 1, url: 'https://a.com' }];
			(mockTiles.getGridTiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeTiles);
			mockTiles._list = ['https://a.com'];

			const result = listener({ name: 'Tiles.getAllTiles' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() =>
				expect(sendResponse).toHaveBeenCalledWith({ tiles: fakeTiles, list: ['https://a.com'] }),
			);
		});

		it('Tiles.getAllTiles — sends null on error', async () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			(mockTiles.getGridTiles as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'));
			const result = listener({ name: 'Tiles.getAllTiles' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			spy.mockRestore();
		});

		it('Tiles.getTile — delegates with message.url', async () => {
			const tile = { url: 'https://b.com', title: 'B' };
			(mockTiles.getTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(tile);
			const result = listener({ name: 'Tiles.getTile', url: 'https://b.com' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(tile));
		});

		it('Tiles.putTile — delegates with message.tile', async () => {
			(mockTiles.putTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = listener({ name: 'Tiles.putTile', tile: { url: 'https://c.com' } }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});

		it('Tiles.removeTile — delegates with message.tile', async () => {
			(mockTiles.removeTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = listener({ name: 'Tiles.removeTile', tile: { url: 'https://d.com' } }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		});

		it('Tiles.clear — calls Tiles.clear() and sends response', async () => {
			(mockTiles.clear as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
			const result = listener({ name: 'Tiles.clear' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => {
				expect(mockTiles.clear).toHaveBeenCalled();
				expect(sendResponse).toHaveBeenCalled();
			});
		});

		it('Tiles.pinTile — sends the new tile id and broadcasts Page.updateGrid', async () => {
			// Slice A (MV3_MIGRATION.md): the getViews() loop is gone; open
			// new-tab pages are told to re-render via a runtime broadcast.
			(mockTiles.pinTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(99);
			const result = listener(
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
			(mockTiles.pinTile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(100);

			listener({ name: 'Tiles.pinTile', title: 'X', url: 'https://x.com' }, validSender, sendResponse);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(100));
		});
	});

	// ======================== BACKGROUND HANDLERS ========================

	describe('Background handlers', () => {
		it('Background.getBackground — sends background data', async () => {
			mockBackground.getBackground.mockResolvedValueOnce({ data: 'image-data' });
			const result = listener({ name: 'Background.getBackground' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ data: 'image-data' }));
		});

		it('Background.getBackground — sends null on error', async () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockBackground.getBackground.mockRejectedValueOnce(new Error('nope'));
			const result = listener({ name: 'Background.getBackground' }, validSender, sendResponse);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			spy.mockRestore();
		});

		it('Background.setBackground — delegates with message.file', async () => {
			mockBackground.setBackground.mockResolvedValueOnce(undefined);
			const result = listener({ name: 'Background.setBackground', file: 'blob:...' }, validSender, sendResponse);
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
			// The write is wrapped in waitForDB() (audit §2.1) — the handler
			// itself still returns synchronously (fire-and-forget, no response
			// channel), but the actual db.transaction() call is now deferred a
			// microtask behind waitForDB().
			const result = listener(
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
			const result = listener(
				{ name: 'Thumbnails.save', image: 'data:image/png;base64,abc' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			expect(mockDB.transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		});

		it('Thumbnails.save — skips write when image is missing', () => {
			const result = listener(
				{ name: 'Thumbnails.save', url: 'https://g.com' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			expect(mockDB.transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		});

		it('Thumbnails.get — sends empty Map when no thumbnails exist', async () => {
			thumbnailStore.openCursor.mockReturnValueOnce(mockCursorIteration([]));
			const result = listener(
				{ name: 'Thumbnails.get', urls: ['https://h.com'] },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			// waitForDB() guard (audit §2.1) defers the cursor open a microtask.
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
			const result = listener(
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

	// ======================== EXPORT / IMPORT HANDLERS ========================

	describe('Export/Import handlers', () => {
		beforeEach(() => {
			mockMakeZip.mockClear();
			mockReadZip.mockClear();
		});

		it('Export:backup — calls sendResponse with makeZip result', async () => {
			const zipResult = { blob: 'fake-zip-blob' };
			mockMakeZip.mockResolvedValueOnce(zipResult);
			const result = listener({ name: 'Export:backup' }, validSender, sendResponse);
			expect(result).toBe(true);
			expect(mockMakeZip).toHaveBeenCalled();
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(zipResult));
		});

		it('Import:restore — responds { ok: true } on success', async () => {
			mockReadZip.mockResolvedValueOnce(undefined);
			const result = listener(
				{ name: 'Import:restore', file: 'fake-zip-data' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			expect(mockReadZip).toHaveBeenCalledWith('fake-zip-data');
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
		});

		it('Import:restore — surfaces the error instead of swallowing it on failure', async () => {
			// A malformed backup makes readZip reject. The handler must report the
			// failure (not leave the message hanging / fail silently).
			mockReadZip.mockRejectedValueOnce(new Error('bad zip'));
			const result = listener(
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
			const result = listener({ name: 'NoSuchHandler' }, validSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('returns false when message has no name property', () => {
			const result = listener({}, validSender, sendResponse);
			expect(result).toBe(false);
			expect(sendResponse).not.toHaveBeenCalled();
		});

		it('returns false for undefined message name', () => {
			const result = listener({ name: undefined }, validSender, sendResponse);
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
			const result = listener(
				{ name: 'Thumbnails.save', url: 'https://f.com', image: 'data:image/png;base64,abc' },
				validSender, sendResponse,
			);
			expect(result).toBe(false);
			expect(thumbnailStore.put).not.toHaveBeenCalled();
		});

		it('still writes when the url host is NOT in the never-capture list', async () => {
			(globalThis as any).NeverCapture._list = ['other.com'];
			const result = listener(
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
			const result = listener(
				{ name: 'Thumbnails.purgeHost' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			expect(thumbnailStore.openCursor).not.toHaveBeenCalled();
		});

		it('empty host string → responds null, opens no cursor', async () => {
			const result = listener(
				{ name: 'Thumbnails.purgeHost', host: '' },
				validSender, sendResponse,
			);
			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(null));
			expect(thumbnailStore.openCursor).not.toHaveBeenCalled();
		});

		it('non-string host → responds null', async () => {
			const result = listener(
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

			const result = listener(
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

			const result = listener(
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

			listener(
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

			listener(
				{ name: 'Thumbnails.purgeHost', host: '.example.com' },
				validSender, sendResponse,
			);

			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
			const response = sendResponse.mock.calls[0][0];
			expect(response).toMatchObject({ thumbnails: 1, tiles: 1 });
		});
	});
});
