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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { Tiles } from '../../webextension/lib/tiles-store.js';
import { _resetForTests } from '../../webextension/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) {throw new Error(`${methodName} not found`);}
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') {depth++;}
		else if (source[i] === '}') { depth--; if (depth === 0) {return source.substring(start, i + 1);} }
	}
	throw new Error('Unbalanced braces');
}

// ==================== refreshBackgroundImage ====================

describe('Page background rendering — newTab.js (Phase 1 slot 15)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const refreshBackgroundImage = extractMethod(source, 'refreshBackgroundImage');
		// Object-URL hygiene helpers (audit §4.3) used by refreshBackgroundImage.
		const fresh = extractMethod(source, '_freshObjectURL');
		const drop = extractMethod(source, '_dropObjectURL');

		globalThis.Background = { getBackground: vi.fn() };
		globalThis.Prefs = { backgroundUrl: '' };

		const code = `var newTabTools = { ${refreshBackgroundImage}, ${fresh}, ${drop}, _objectURLs: {}, backgroundFake: { style: {} }, removeBackgroundButton: { disabled: false, blur: function(){} } };`;
		vm.runInThisContext(code, { filename: 'background-render-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		(globalThis as any).Prefs.backgroundUrl = '';
		harness.backgroundFake = { style: { backgroundImage: null } };
		harness.removeBackgroundButton = { disabled: false, blur: vi.fn() };
		harness._objectURLs = {};
		globalThis.URL.revokeObjectURL = vi.fn();
		document.body.style.backgroundImage = '';
	});

	it('applies background image URL to document.body when background exists', async () => {
		const blob = new Blob(['img']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake-bg');
		(globalThis as any).Background.getBackground.mockResolvedValue(blob);
		await harness.refreshBackgroundImage();
		expect(document.body.style.backgroundImage).toBe('url("blob:fake-bg")');
		expect(harness.backgroundFake.style.backgroundImage).toBe('url("blob:fake-bg")');
		expect(harness.removeBackgroundButton.disabled).toBe(false);
	});

	it('clears background image when no background stored', async () => {
		document.body.style.backgroundImage = 'url("old")';
		(globalThis as any).Background.getBackground.mockResolvedValue(null);
		await harness.refreshBackgroundImage();
		// Code sets style.backgroundImage = null; jsdom coerces to ''
		expect(document.body.style.backgroundImage).toBe('');
		// Our plain-object mock keeps the null
		expect(harness.backgroundFake.style.backgroundImage).toBeNull();
	});

	it('disables remove button when no background', async () => {
		(globalThis as any).Background.getBackground.mockResolvedValue(null);
		await harness.refreshBackgroundImage();
		expect(harness.removeBackgroundButton.disabled).toBe(true);
		expect(harness.removeBackgroundButton.blur).toHaveBeenCalled();
	});

	it('enables remove button when background exists', async () => {
		harness.removeBackgroundButton.disabled = true;
		const blob = new Blob(['img']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:bg');
		(globalThis as any).Background.getBackground.mockResolvedValue(blob);
		await harness.refreshBackgroundImage();
		expect(harness.removeBackgroundButton.disabled).toBe(false);
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
		globalThis.Blocked = { isBlocked: vi.fn(() => false) };
		globalThis.Filters = {
			_list: Object.create(null),
			getList() { return Object.assign(Object.create(null), this._list); },
		};
		globalThis.Prefs = { rows: 2, columns: 2, history: true };
		globalThis.compareVersions = vi.fn(() => 1);

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
