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
 * Two layers:
 *   1. Behavioral — dispatch each of the 19 documented names through the
 *      real `chrome.runtime.onMessage` listener (loaded from the real
 *      background.js, script-mode via vm.runInThisContext — same idiom as
 *      background-messages.test.ts) with its dependencies mocked, and
 *      assert the listener's return value (true = async, keeps the
 *      response channel open; false = synchronous / fire-and-forget)
 *      matches the documented table. A name that fell through to the
 *      dispatcher's default `return false` when the table says `true`
 *      (or vice versa) means the case was renamed or removed.
 *   2. Structural completeness — greps the `case '<name>':` labels out of
 *      background.js and asserts the set is *exactly* these 19 names, no
 *      more, no fewer. Catches a 20th case added without updating this
 *      file (the behavioral loop above only proves the 19 it knows about
 *      still work, not that nothing new appeared).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { withStore } from '../../webextension/lib/db.js';
import { SAFE_PROTOCOLS } from '../../webextension/lib/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND_PATH = path.resolve(__dirname, '../../webextension/background.js');
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

describe('background.js — frozen message contract (MODERNIZATION.md Decision 3)', () => {
	let listener: (message: unknown, sender: unknown, sendResponse: any) => boolean;
	const validSender = { id: EXTENSION_ID };

	beforeAll(async () => {
		// --- Dependencies background.js expects on globalThis (mocked wholesale
		// — crib: event-page-resilience.test.ts. This test only exercises the
		// dispatcher's control flow / return values, not Tiles/Prefs/etc.'s own
		// behavior, so plain mocks are enough.) ---
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
			_ready: true,
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

		// --- Mock DB (only Thumbnails.purgeHost's waitForDB()-then-transaction
		// path and cleanupThumbnails' index scan touch it at all here) ---
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

		// M2: bridge the real lib/db.js withStore() onto globalThis (background.js
		// is still bridge-mode — see db-wake-race.test.ts for the canonical
		// explanation of this pattern).
		(globalThis as any).withStore = withStore;
		(globalThis as any).SAFE_PROTOCOLS = SAFE_PROTOCOLS;

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

		// --- Load the real background.js (script-mode) ---
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const code = fs.readFileSync(BACKGROUND_PATH, 'utf8');
		vm.runInThisContext(code, { filename: 'background.js' });
		await new Promise(resolve => setTimeout(resolve, 0));

		const calls = ((globalThis as any).chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls.length).toBe(1);
		listener = calls[0][0];
	});

	describe('behavioral — every documented name is handled with the documented return value', () => {
		CONTRACT.forEach(({ name, async: isAsync, message }) => {
			it(`'${name}' → listener returns ${isAsync}`, () => {
				const sendResponse = vi.fn();
				let result: boolean | undefined;
				expect(() => {
					result = listener({ name, ...message }, validSender, sendResponse);
				}).not.toThrow();
				expect(result).toBe(isAsync);
			});
		});
	});

	describe('structural completeness — no undocumented case added or removed', () => {
		it('background.js\'s switch has exactly these 19 case labels, no more, no fewer', () => {
			// eslint-disable-next-line ntt/no-source-grep -- structural contract check, not behavioral coverage (paired with the behavioral loop above)
			const code = fs.readFileSync(BACKGROUND_PATH, 'utf8');
			const found = [...code.matchAll(/case '([^']+)':/g)].map(m => m[1]);
			expect(found).toHaveLength(19);
			expect(new Set(found)).toEqual(new Set(CONTRACT.map(c => c.name)));
		});

		it('the CONTRACT table itself lists exactly 19 unique names (guards the guard)', () => {
			expect(CONTRACT).toHaveLength(19);
			expect(new Set(CONTRACT.map(c => c.name)).size).toBe(19);
		});
	});
});
