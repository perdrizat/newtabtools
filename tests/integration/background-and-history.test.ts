/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: page background image rendering + hide history-derived tiles.
 * Phase 1 slot 15 of the migration plan (MIGRATION.md).
 *
 * Page background *set/remove* is already covered by slot 8 (tile-editing.test.ts).
 * This test covers the rendering side (`refreshBackgroundImage` in newTab.js)
 * and the "hide history" feature (Prefs.history toggle in tiles.js).
 *
 * Characterizes:
 *   - refreshBackgroundImage: applies background URL to document.body
 *   - refreshBackgroundImage: clears background when none stored
 *   - refreshBackgroundImage: enables/disables remove button
 *   - Prefs.history=false: getAllTiles skips topSites, returns only pinned
 *   - Prefs.history=true: getAllTiles fetches topSites and fills grid
 *   - updateUI('history'): disables historytiles-filter when history off
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Tiles } from '../../webextension/lib/tiles-store.js';
import { _resetForTests } from '../../webextension/lib/db.js';
import { Prefs, Blocked, Filters } from '../../webextension/prefs.js';
// chrome-prep C4d (CHROME_PREP.md): `refreshBackgroundImage` is a real
// wallpaper.js export now (moved verbatim out of newTab.js, alongside
// `_freshObjectURL`/`_dropObjectURL` to object-urls.js) — imported directly
// instead of vm-extracted from newTab.js source (C4a/b/c "import from the
// new specifier" precedent), and driven against the REAL `Background`/
// `uiRefs` singletons it reads (tiles-shim.js/ui-refs.js — a
// `globalThis.Background` stand-in no longer reaches it; same
// "second-order fallout" class _helpers.ts's `ensureSiteEnv` documents).
import { refreshBackgroundImage } from '../../webextension/wallpaper.js';
import { uiRefs } from '../../webextension/ui-refs.js';
import { Background } from '../../webextension/tiles-shim.js';

// ==================== refreshBackgroundImage ====================

describe('Page background rendering — newTab.js (Phase 1 slot 15)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Prefs.backgroundUrl = '';
		Prefs.backgroundColor = '';
		uiRefs.backgroundFake = { style: { backgroundImage: null } } as any;
		uiRefs.removeBackgroundButton = { disabled: false, blur: vi.fn() } as any;
		Background.getBackground = vi.fn();
		globalThis.URL.revokeObjectURL = vi.fn();
		document.body.style.backgroundImage = '';
	});

	it('applies background image URL to document.body when background exists', async () => {
		const blob = new Blob(['img']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake-bg');
		(Background.getBackground as any).mockResolvedValue(blob);
		await refreshBackgroundImage();
		expect(document.body.style.backgroundImage).toBe('url("blob:fake-bg")');
		expect(uiRefs.backgroundFake.style.backgroundImage).toBe('url("blob:fake-bg")');
		expect(uiRefs.removeBackgroundButton.disabled).toBe(false);
	});

	it('clears background image when no background stored', async () => {
		document.body.style.backgroundImage = 'url("old")';
		(Background.getBackground as any).mockResolvedValue(null);
		await refreshBackgroundImage();
		// Code sets style.backgroundImage = null; jsdom coerces to ''
		expect(document.body.style.backgroundImage).toBe('');
		// Our plain-object mock keeps the null
		expect(uiRefs.backgroundFake.style.backgroundImage).toBeNull();
	});

	it('disables remove button when no background', async () => {
		(Background.getBackground as any).mockResolvedValue(null);
		await refreshBackgroundImage();
		expect(uiRefs.removeBackgroundButton.disabled).toBe(true);
		expect(uiRefs.removeBackgroundButton.blur).toHaveBeenCalled();
	});

	it('enables remove button when background exists', async () => {
		uiRefs.removeBackgroundButton.disabled = true;
		const blob = new Blob(['img']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:bg');
		(Background.getBackground as any).mockResolvedValue(blob);
		await refreshBackgroundImage();
		expect(uiRefs.removeBackgroundButton.disabled).toBe(false);
	});
});

// ==================== hide history-derived tiles ====================

/**
 * MODERNIZATION.md slice M2: migrated from `vm.runInThisContext`-loading
 * tiles.js (with a directly-poked `globalThis.db` mock) to a native `import`
 * of the real lib/tiles-store.js (getGridTiles, the M2 rename of
 * getAllTiles) + lib/db.js. A mocked `indexedDB.open()` drives the
 * connection now; `_resetForTests()` gives each test a clean slate.
 */
describe('Hide history tiles — lib/tiles-store.js getGridTiles (Phase 1 slot 15)', () => {
	let stores: Record<string, any[]>;

	function installAutoResolvingIndexedDB() {
		stores = { tiles: [], background: [], thumbnails: [] };
		function makeOp<T>(resultFn: () => T) {
			const op = { result: undefined as T | undefined, onsuccess: null as ((this: any) => void) | null, onerror: null as ((e: unknown) => void) | null };
			Promise.resolve().then(() => { op.result = resultFn(); if (op.onsuccess) {op.onsuccess.call(op);} });
			return op;
		}
		function makeObjectStore(name: string) {
			return {
				getAll: vi.fn(() => makeOp(() => [...stores[name]])),
				get: vi.fn((key: any) => makeOp(() => stores[name].find((r: any) => r.id === key || r.url === key))),
				add: vi.fn((record: any) => makeOp(() => { stores[name].push(record); return record.id; })),
				put: vi.fn((record: any) => makeOp(() => { const idx = stores[name].findIndex((r: any) => r.id === record.id); if (idx >= 0) {stores[name][idx] = record;} else {stores[name].push(record);} return record.id; })),
				delete: vi.fn((key: any) => makeOp(() => { const idx = stores[name].findIndex((r: any) => r.id === key); if (idx >= 0) {stores[name].splice(idx, 1);} })),
				clear: vi.fn(() => makeOp(() => { stores[name].length = 0; })),
				index: vi.fn(() => ({ getAll: vi.fn(() => makeOp(() => [...stores[name]])) })),
			};
		}
		const mockDb = {
			objectStoreNames: { contains: () => true },
			createObjectStore: () => {},
			close: () => {},
			transaction: vi.fn((_storeNames: string | string[], _mode?: string) => ({
				objectStore: vi.fn((name: string) => makeObjectStore(name)),
			})),
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
				handlers.onsuccess && handlers.onsuccess.call({ result: mockDb });
			});
			return req;
		});
		(globalThis as any).indexedDB = { open: openMock };
	}

	beforeAll(() => {
		// PAGE_MODULES.md P3: lib/tiles-store.js now imports Prefs/Blocked/
		// Filters/compareVersions for real (rather than reading
		// getPrefs()/getBlocked()/getFilters()/getCompareVersions() off
		// globalThis at call time), so replacing `globalThis.X` with a fresh
		// stand-in object here would no longer reach it — mutate the real
		// prefs.js/common.js singletons in place instead. The real
		// `compareVersions('128.0', '63.0a1')` (see the mocked
		// `getBrowserInfo()` below) resolves the same way the old `() => 1`
		// stub did, so it needs no stubbing either.
		Blocked.isBlocked = vi.fn(() => false);
		Filters._list = Object.create(null);
		Prefs.rows = 2;
		Prefs.columns = 2;
		Prefs.history = true;

		(globalThis as any).browser = {
			runtime: { getBrowserInfo: vi.fn().mockResolvedValue({ version: '128.0' }) },
			topSites: { get: vi.fn() },
		};
	});

	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		installAutoResolvingIndexedDB();
		Tiles._cache = [];
		Tiles._ready = false;
		Tiles._list = [];
		Prefs.history = true;
		Prefs.rows = 2;
		Prefs.columns = 2;
	});

	it('Prefs.history=false skips topSites and returns only pinned tiles', async () => {
		Prefs.history = false;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		const result = await Tiles.getGridTiles();
		expect((globalThis as any).browser.topSites.get).not.toHaveBeenCalled();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).toContain('https://pinned.com');
	});

	it('Prefs.history=false returns only pinned positions (sparse slice)', async () => {
		Prefs.history = false;
		Prefs.rows = 2;
		Prefs.columns = 2;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		const result = await Tiles.getGridTiles();
		// links is sparse: only index 0 is set, so slice(0, 4) returns length 1
		expect(result[0].url).toBe('https://pinned.com');
		expect(result.filter((s: any) => s)).toHaveLength(1);
	});

	it('Prefs.history=true calls topSites.get and fills unpinned slots', async () => {
		Prefs.history = true;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		((globalThis as any).browser.topSites.get as any).mockResolvedValue([
			{ url: 'https://history1.com', title: 'H1' },
			{ url: 'https://history2.com', title: 'H2' },
		]);

		const result = await Tiles.getGridTiles();
		expect((globalThis as any).browser.topSites.get).toHaveBeenCalled();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).toContain('https://pinned.com');
		expect(urls).toContain('https://history1.com');
	});

	it('Prefs.history=false with no pinned tiles returns empty array', async () => {
		Prefs.history = false;
		Prefs.rows = 1;
		Prefs.columns = 2;

		const result = await Tiles.getGridTiles();
		// No pinned tiles → links is empty sparse array → slice returns []
		expect(result).toHaveLength(0);
		expect(result.filter((s: any) => s)).toHaveLength(0);
	});

	it('Prefs.history=true does not duplicate already-pinned URLs from topSites', async () => {
		Prefs.history = true;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		((globalThis as any).browser.topSites.get as any).mockResolvedValue([
			{ url: 'https://pinned.com', title: 'Same URL' }, // already pinned
			{ url: 'https://new.com', title: 'New' },
		]);

		const result = await Tiles.getGridTiles();
		const pinnedCount = result.filter((s: any) => s && s.url === 'https://pinned.com').length;
		expect(pinnedCount).toBe(1);
	});
});
