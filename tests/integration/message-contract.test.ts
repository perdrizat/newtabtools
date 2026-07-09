/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Frozen message-contract test (MODERNIZATION.md Decision 3).
 *
 * The 19 `runtime.onMessage` wire names (audit/2026-07-09-mv3-inventory.md
 * §1.8) are wire protocol between the background and every page/popup
 * client. Stage M may rename internals freely but must never rename,
 * add, or drop a wire message name without updating this list — this test
 * is the contract's regression guard and survives the whole modernization
 * arc (M and H alike).
 *
 * MODERNIZATION.md slice M5 dissolves the former webextension/background.js:
 * the dispatch switch this test drives is now `handleMessage`, a real export
 * of lib/messages.js, natively imported below instead of vm-loaded. Its
 * dependencies (Tiles/Background, withStore, makeZip/readZip,
 * purgeNeverCaptureHost) are real imports too — this file mutates the SAME
 * singleton `Tiles`/`Background` objects lib/messages.js imports (module
 * instances are cached/shared by import specifier, so replacing a method on
 * the imported object is visible through every other import of the same
 * module) rather than replacing a `globalThis` bridge. `makeZip`/`readZip`
 * are mocked via `vi.mock` since this test only cares about dispatch
 * plumbing, not the real zip/backup pipeline (covered by
 * backup-restore.test.ts).
 *
 * Two layers:
 *   1. Behavioral — dispatch each of the 19 documented names through the
 *      real `handleMessage` with its dependencies mocked, and assert the
 *      return value (true = async, keeps the response channel open; false =
 *      synchronous / fire-and-forget) matches the documented table.
 *   2. Structural completeness — greps the `case '<name>':` labels out of
 *      lib/messages.js and asserts the set is *exactly* these 19 names, no
 *      more, no fewer.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../../webextension/lib/backup.js', () => ({
	makeZip: vi.fn().mockResolvedValue(new Blob(['zip-data'])),
	readZip: vi.fn().mockResolvedValue(undefined),
}));

import { handleMessage } from '../../webextension/lib/messages.js';
import { Tiles, Background } from '../../webextension/lib/tiles-store.js';
import { makeZip, readZip } from '../../webextension/lib/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_PATH = path.resolve(__dirname, '../../webextension/lib/messages.js');
const EXTENSION_ID = 'newtabtools@symlink.ch';

// ---------------------------------------------------------------------------
// The frozen contract (audit §1.8 / MODERNIZATION.md Decision 3). `async:
// true` means the handler returns `true` (keeps the sendResponse channel
// open); `false` means it responds synchronously or is fire-and-forget.
// ---------------------------------------------------------------------------

const CONTRACT: Array<{ name: string; async: boolean; message: Record<string, unknown> }> = [
	{ name: 'Tiles.isPinned', async: true, message: { url: 'https://a.example.com' } },
	{ name: 'Tiles.getAllTiles', async: true, message: {} },
	{ name: 'Tiles.getTile', async: true, message: { url: 'https://a.example.com' } },
	{ name: 'Tiles.putTile', async: true, message: { tile: { url: 'https://a.example.com', title: 'A', position: 0 } } },
	{ name: 'Tiles.removeTile', async: true, message: { tile: { id: 1, url: 'https://a.example.com' } } },
	{ name: 'Tiles.clear', async: true, message: {} },
	{ name: 'Tiles.pinTile', async: true, message: { title: 'A', url: 'https://a.example.com' } },
	{ name: 'Background.getBackground', async: true, message: {} },
	{ name: 'Background.setBackground', async: true, message: { file: null } },
	{ name: 'Thumbnails.save', async: false, message: { url: 'https://a.example.com', image: 'data:image/png;base64,abc' } },
	{ name: 'Thumbnails.get', async: true, message: { urls: ['https://a.example.com'] } },
	{ name: 'Thumbnails.capture', async: false, message: {} },
	{ name: 'Thumbnails.getFavicons', async: true, message: { urls: ['https://a.example.com'] } },
	{ name: 'Thumbnails.getFaviconsByHost', async: true, message: { hosts: ['a.example.com'] } },
	{ name: 'Thumbnails.delete', async: false, message: { url: 'https://a.example.com' } },
	{ name: 'Thumbnails.purgeHost', async: true, message: { host: '.example.com' } },
	{ name: 'Thumbnails.clear', async: true, message: {} },
	{ name: 'Export:backup', async: true, message: {} },
	{ name: 'Import:restore', async: true, message: { file: new Blob(['x']) } },
];

describe('lib/messages.js — frozen message contract (MODERNIZATION.md Decision 3)', () => {
	const validSender = { id: EXTENSION_ID };

	beforeAll(async () => {
		// --- Mock DB (only Thumbnails.purgeHost's withStore()-then-transaction
		// path and Thumbnails.* cursor walks touch it at all here) ---
		const mockDB = {
			objectStoreNames: { contains: () => true },
			transaction: vi.fn(() => ({
				objectStore: vi.fn(() => ({
					put: vi.fn(),
					get: vi.fn(),
					getAll: vi.fn(),
					delete: vi.fn(),
					clear: vi.fn(() => ({ onsuccess: null })),
					openCursor: vi.fn(() => {
						const req: Record<string, unknown> = {};
						Object.defineProperty(req, 'onsuccess', {
							set(cb: Function) { Promise.resolve().then(() => cb.call({ result: null })); },
							configurable: true,
						});
						return req;
					}),
					createIndex: vi.fn(),
					indexNames: { contains: () => true },
				})),
			})),
			createObjectStore: vi.fn(),
			close: vi.fn(),
		};
		(globalThis as any).indexedDB = {
			open: vi.fn(() => {
				const req: Record<string, unknown> = { onsuccess: null };
				Promise.resolve().then(() => {
					const cb = req.onsuccess as Function | null;
					cb && cb.call({ result: mockDB });
				});
				return req;
			}),
		};
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		// --- Tiles / Background: mutate the REAL singletons lib/messages.js
		// imports, rather than replacing a globalThis bridge (there isn't one
		// anymore — see this file's header comment). ---
		Object.assign(Tiles, {
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
			_ready: true,
		});
		Object.assign(Background, {
			getBackground: vi.fn().mockResolvedValue(null),
			setBackground: vi.fn().mockResolvedValue(undefined),
		});

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

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.permissions = { contains: vi.fn().mockResolvedValue(true) };
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({ active: true, windowId: 1, incognito: false });
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.storage.session = {
			get: vi.fn().mockResolvedValue({}),
			set: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage.local = {
			get: vi.fn().mockResolvedValue({ thumbnailSize: 600 }),
			set: vi.fn().mockResolvedValue(undefined),
		};
	});

	describe('behavioral — every documented name is handled with the documented return value', () => {
		CONTRACT.forEach(({ name, async: isAsync, message }) => {
			it(`'${name}' → listener returns ${isAsync}`, () => {
				const sendResponse = vi.fn();
				let result: boolean | undefined;
				expect(() => {
					result = handleMessage({ name, ...message }, validSender, sendResponse);
				}).not.toThrow();
				expect(result).toBe(isAsync);
			});
		});
	});

	describe('structural completeness — no undocumented case added or removed', () => {
		it('lib/messages.js\'s switch has exactly these 19 case labels, no more, no fewer', () => {
			// eslint-disable-next-line ntt/no-source-grep -- structural contract check, not behavioral coverage (paired with the behavioral loop above)
			const code = fs.readFileSync(MESSAGES_PATH, 'utf8');
			const found = [...code.matchAll(/case '([^']+)':/g)].map(m => m[1]);
			expect(found).toHaveLength(19);
			expect(new Set(found)).toEqual(new Set(CONTRACT.map(c => c.name)));
		});

		it('the CONTRACT table itself lists exactly 19 unique names (guards the guard)', () => {
			expect(CONTRACT).toHaveLength(19);
			expect(new Set(CONTRACT.map(c => c.name)).size).toBe(19);
		});
	});

	// Guard against the mocked backup.js module going unused, and prove the
	// Export:backup/Import:restore cases really reach it.
	it('Export:backup calls the (mocked) makeZip', async () => {
		const sendResponse = vi.fn();
		handleMessage({ name: 'Export:backup' }, validSender, sendResponse);
		await vi.waitFor(() => expect(makeZip).toHaveBeenCalled());
	});

	it('Import:restore calls the (mocked) readZip with message.file', async () => {
		const sendResponse = vi.fn();
		const file = new Blob(['x']);
		handleMessage({ name: 'Import:restore', file }, validSender, sendResponse);
		await vi.waitFor(() => expect(readZip).toHaveBeenCalledWith(file));
	});
});
