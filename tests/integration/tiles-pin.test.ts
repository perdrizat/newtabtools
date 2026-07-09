/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: pin/unpin tile logic in lib/tiles-store.js.
 * Phase 1 slot 6 of the migration plan (MIGRATION.md).
 *
 * MODERNIZATION.md slice M2: migrated from `vm.runInThisContext`-loading
 * tiles.js (script-mode, with a directly-poked `globalThis.db` mock) to a
 * native `import` of the real lib/tiles-store.js + lib/db.js modules —
 * tiles.js is now just a bridge shim (`import {Tiles, Background} from
 * './lib/tiles-store.js'; globalThis.Tiles = Tiles; …`) with no behavior of
 * its own left to vm-load. There is no `db` global to poke anymore: a mocked
 * `indexedDB.open()` (same shape lib/db.js's tests use elsewhere) drives the
 * connection, and `_resetForTests()` gives each test a clean slate.
 *
 * Characterizes:
 *   - pinTile: position assignment (first gap), duplicate rejection, IDB write
 *   - putTile: list tracking, IDB write
 *   - removeTile: list cleanup (including duplicates), IDB delete
 *   - isPinned: list membership check
 *   - getTile: IDB index lookup
 *   - ensureReady / getGridTiles: cache population, history-disabled path
 *   - clear: IDB clear + state
 *
 * E2E note: pin persistence is already covered by tests/e2e/pin-persists.test.js.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Tiles, Background } from '../../webextension/lib/tiles-store.js';
import { _resetForTests } from '../../webextension/lib/db.js';

// ---------------------------------------------------------------------------
// In-memory IndexedDB mock (tiles / background / thumbnails stores), driven
// through a mocked `indexedDB.open()` — same shape as db-connection.test.ts /
// module-scope.test.ts, since lib/tiles-store.js reaches the connection only
// via lib/db.js's withStore(), never directly.
// ---------------------------------------------------------------------------

interface TileRecord {
	id?: number;
	url: string;
	title?: string;
	position?: number;
	[key: string]: unknown;
}

function createMockDB() {
	let autoId = 1;
	const stores: Record<string, TileRecord[]> = {
		tiles: [],
		background: [],
		thumbnails: [],
	};

	function makeOp<T>(resultFn: () => T) {
		const op = {
			result: undefined as T | undefined,
			onsuccess: null as ((this: any) => void) | null,
			onerror: null as ((e: unknown) => void) | null,
		};
		// Simulate async IDB — fire onsuccess on next microtask
		Promise.resolve().then(() => {
			op.result = resultFn();
			if (op.onsuccess) {op.onsuccess.call(op);}
		});
		return op;
	}

	function makeObjectStore(name: string) {
		return {
			getAll() {
				return makeOp(() => [...stores[name]]);
			},
			get(id: number) {
				return makeOp(() => stores[name].find((r: TileRecord) => r.id === id) || null);
			},
			add(record: TileRecord) {
				record.id = autoId++;
				stores[name].push({ ...record });
				return makeOp(() => record.id!);
			},
			put(record: TileRecord) {
				if (record.id == null) {
					record.id = autoId++;
				} else {
					const idx = stores[name].findIndex((r: TileRecord) => r.id === record.id);
					if (idx >= 0) {stores[name].splice(idx, 1);}
				}
				stores[name].push({ ...record });
				return makeOp(() => record.id!);
			},
			delete(id: number) {
				stores[name] = stores[name].filter((r: TileRecord) => r.id !== id);
				return makeOp(() => undefined);
			},
			clear() {
				stores[name] = [];
				return makeOp(() => undefined);
			},
			index(indexName: string) {
				return {
					get(value: string) {
						return makeOp(() => {
							if (indexName === 'url') {
								return stores[name].find((r: TileRecord) => r.url === value) || null;
							}
							return null;
						});
					},
				};
			},
		};
	}

	return {
		objectStoreNames: { contains: () => true },
		createObjectStore: () => {},
		close: () => {},
		transaction(storeName: string) {
			return {
				objectStore(name: string) {
					if (name !== storeName) {throw new Error(`wrong store: ${name}`);}
					return makeObjectStore(name);
				},
			};
		},
		// Expose internals for test assertions
		_stores: stores,
	};
}

function installAutoResolvingIndexedDB(mockDb: ReturnType<typeof createMockDB>) {
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
			handlers.onsuccess && handlers.onsuccess.call({ result: mockDb });
		});
		return req;
	});
	(globalThis as any).indexedDB = { open: openMock };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Tiles pin/unpin — lib/tiles-store.js (Phase 1 slot 6)', () => {
	let mockDb: ReturnType<typeof createMockDB>;

	beforeAll(() => {
		// Globals lib/tiles-store.js expects (Prefs/Blocked/Filters —
		// MODERNIZATION.md Decision 2 interim bridge; compareVersions is
		// pulled from common.js in production, mocked here since getGridTiles
		// only calls it on the Prefs.history=true path).
		globalThis.Prefs = { rows: 3, columns: 3, history: false } as any;
		globalThis.Blocked = { isBlocked: vi.fn(() => false) } as any;
		globalThis.Filters = { getList: vi.fn(() => ({})) } as any;
		globalThis.compareVersions = vi.fn(() => 1) as any;
	});

	beforeEach(() => {
		_resetForTests();
		mockDb = createMockDB();
		installAutoResolvingIndexedDB(mockDb);
		// Reset Tiles internal state
		Tiles._ready = false;
		Tiles._cache = [];
		Tiles._list = [];
	});

	// ==================== isPinned ====================

	it('isPinned returns false for unknown URL', () => {
		expect(Tiles.isPinned('https://example.com')).toBe(false);
	});

	it('isPinned returns true after URL is added to _list', () => {
		Tiles._list.push('https://example.com');
		expect(Tiles.isPinned('https://example.com')).toBe(true);
	});

	// ==================== putTile ====================

	it('putTile adds URL to _list and writes to IDB', async () => {
		const tile = { url: 'https://example.com', title: 'Ex', position: 0 };
		await Tiles.putTile(tile);
		expect(Tiles._list).toContain('https://example.com');
		expect(mockDb._stores.tiles).toHaveLength(1);
		expect(mockDb._stores.tiles[0].url).toBe('https://example.com');
	});

	it('putTile does not duplicate URL in _list', async () => {
		Tiles._list.push('https://example.com');
		await Tiles.putTile({ url: 'https://example.com', title: 'Ex', position: 0 });
		expect(Tiles._list.filter((u: string) => u === 'https://example.com')).toHaveLength(1);
	});

	// ==================== removeTile ====================

	it('removeTile removes URL from _list and deletes from IDB', async () => {
		Tiles._list.push('https://example.com');
		mockDb._stores.tiles.push({ id: 1, url: 'https://example.com', position: 0 });
		await Tiles.removeTile({ id: 1, url: 'https://example.com' });
		expect(Tiles._list).not.toContain('https://example.com');
		expect(mockDb._stores.tiles).toHaveLength(0);
	});

	it('removeTile removes all occurrences of URL from _list (dedup cleanup)', async () => {
		Tiles._list.push('https://example.com', 'https://other.com', 'https://example.com');
		mockDb._stores.tiles.push({ id: 1, url: 'https://example.com', position: 0 });
		await Tiles.removeTile({ id: 1, url: 'https://example.com' });
		expect(Tiles._list).toEqual(['https://other.com']);
	});

	// ==================== pinTile ====================

	it('pinTile assigns position 0 when grid is empty', async () => {
		await Tiles.pinTile('Example', 'https://example.com');
		const stored = mockDb._stores.tiles[0];
		expect(stored.position).toBe(0);
		expect(stored.title).toBe('Example');
		expect(stored.url).toBe('https://example.com');
	});

	it('pinTile assigns first gap position in existing tiles', async () => {
		// Pre-populate positions 0 and 1, leave gap at 2
		mockDb._stores.tiles.push(
			{ id: 1, url: 'https://a.com', title: 'A', position: 0 },
			{ id: 2, url: 'https://b.com', title: 'B', position: 1 },
			{ id: 3, url: 'https://c.com', title: 'C', position: 3 },
		);
		await Tiles.pinTile('New', 'https://new.com');
		const newTile = mockDb._stores.tiles.find((t: TileRecord) => t.url === 'https://new.com');
		expect(newTile!.position).toBe(2);
	});

	it('pinTile resolves immediately for already-pinned URL', async () => {
		Tiles._list.push('https://example.com');
		await Tiles.pinTile('Example', 'https://example.com');
		// No new tile written to IDB
		expect(mockDb._stores.tiles).toHaveLength(0);
	});

	it('pinTile adds URL to _list via putTile', async () => {
		await Tiles.pinTile('Example', 'https://example.com');
		expect(Tiles.isPinned('https://example.com')).toBe(true);
	});

	// ==================== getTile ====================

	it('getTile returns tile by URL index', async () => {
		mockDb._stores.tiles.push({ id: 1, url: 'https://example.com', title: 'Ex', position: 0 });
		const tile = await Tiles.getTile('https://example.com');
		expect(tile).not.toBeNull();
		expect(tile!.url).toBe('https://example.com');
	});

	it('getTile returns null for unknown URL', async () => {
		const tile = await Tiles.getTile('https://nonexistent.com');
		expect(tile).toBeNull();
	});

	// ==================== ensureReady / getGridTiles ====================

	it('getGridTiles populates _cache and returns tiles up to rows*columns', async () => {
		mockDb._stores.tiles.push(
			{ id: 1, url: 'https://a.com', title: 'A', position: 0 },
			{ id: 2, url: 'https://b.com', title: 'B', position: 1 },
		);
		(globalThis as any).Prefs.rows = 2;
		(globalThis as any).Prefs.columns = 2;
		(globalThis as any).Prefs.history = false;

		const result = await Tiles.getGridTiles();
		expect(result).toHaveLength(2);
		expect(Tiles._cache).toEqual(['https://a.com', 'https://b.com']);
		expect(Tiles._list).toEqual(['https://a.com', 'https://b.com']);
	});

	it('getGridTiles skips duplicate URLs and logs error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockDb._stores.tiles.push(
			{ id: 1, url: 'https://a.com', title: 'A', position: 0 },
			{ id: 2, url: 'https://a.com', title: 'A dup', position: 1 },
		);
		(globalThis as any).Prefs.history = false;

		const result = await Tiles.getGridTiles();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('appears twice'));
		expect(result).toHaveLength(1);
		consoleSpy.mockRestore();
	});

	it('getGridTiles truncates to rows*columns', async () => {
		for (let i = 0; i < 20; i++) {
			mockDb._stores.tiles.push({ id: i + 1, url: `https://${i}.com`, title: `${i}`, position: i });
		}
		(globalThis as any).Prefs.rows = 2;
		(globalThis as any).Prefs.columns = 2;
		(globalThis as any).Prefs.history = false;

		const result = await Tiles.getGridTiles();
		expect(result).toHaveLength(4);
	});

	it('ensureReady returns cache and list', async () => {
		mockDb._stores.tiles.push(
			{ id: 1, url: 'https://a.com', title: 'A', position: 0 },
		);
		(globalThis as any).Prefs.history = false;

		const { cache, list } = await Tiles.ensureReady();
		expect(cache).toEqual(['https://a.com']);
		expect(list).toEqual(['https://a.com']);
	});

	it('ensureReady resolves from cache on second call without re-querying IDB', async () => {
		(globalThis as any).Prefs.history = false;
		await Tiles.ensureReady();
		// Mutate the store — should NOT be picked up
		mockDb._stores.tiles.push({ id: 99, url: 'https://late.com', title: 'Late', position: 0 });
		const { cache } = await Tiles.ensureReady();
		expect(cache).not.toContain('https://late.com');
	});

	// ==================== clear ====================

	it('clear empties the IDB tiles store', async () => {
		mockDb._stores.tiles.push({ id: 1, url: 'https://a.com', title: 'A', position: 0 });
		await Tiles.clear();
		expect(mockDb._stores.tiles).toHaveLength(0);
	});

	// ==================== Background ====================

	it('Background.getBackground resolves null when no background stored', async () => {
		const result = await Background.getBackground();
		expect(result).toBeNull();
	});

	it('Background.setBackground stores and then getBackground retrieves it', async () => {
		await Background.setBackground({ color: '#fff', file: 'blob' } as any);
		const result = await Background.getBackground();
		expect(result).not.toBeNull();
	});

	it('Background.setBackground(null) clears the background', async () => {
		mockDb._stores.background.push({ id: 1, color: '#fff' } as any);
		await Background.setBackground(null);
		expect(mockDb._stores.background).toHaveLength(0);
	});
});
