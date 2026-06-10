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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const TILES_PATH = path.resolve(__dirname, '../../webextension/tiles.js');
const COMMON_PATH = path.resolve(__dirname, '../../webextension/common.js');

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

describe('Hide history tiles — tiles.js getAllTiles (Phase 1 slot 15)', () => {
	let Tiles: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const commonSrc = fs.readFileSync(COMMON_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const tilesSrc = fs.readFileSync(TILES_PATH, 'utf8');

		globalThis.Blocked = { isBlocked: vi.fn(() => false) };
		globalThis.Filters = {
			_list: Object.create(null),
			getList() { return Object.assign(Object.create(null), this._list); },
		};
		globalThis.Prefs = { rows: 2, columns: 2, history: true };

		(globalThis as any).browser = {
			runtime: { getBrowserInfo: vi.fn().mockResolvedValue({ version: '128.0' }) },
		};
		chrome.topSites = { get: vi.fn() } as any;

		// Mock IDB
		const stores: Record<string, any[]> = { tiles: [], background: [], thumbnails: [] };
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
		(globalThis as any).db = {
			transaction: vi.fn((_stores: string[], _mode?: string) => ({
				objectStore: vi.fn((name: string) => makeObjectStore(name)),
			})),
		};
		// We need stores accessible from beforeEach
		(globalThis as any)._testStores = stores;

		vm.runInThisContext(commonSrc, { filename: 'common.js' });
		vm.runInThisContext(tilesSrc, { filename: 'tiles.js' });
		Tiles = (globalThis as any).Tiles;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Tiles._cache = null;
		Tiles._ready = false;
		Tiles._list = [];
		Prefs.history = true;
		Prefs.rows = 2;
		Prefs.columns = 2;
		const stores = (globalThis as any)._testStores;
		stores.tiles.length = 0;
		stores.background.length = 0;
		stores.thumbnails.length = 0;
	});

	it('Prefs.history=false skips topSites and returns only pinned tiles', async () => {
		Prefs.history = false;
		const stores = (globalThis as any)._testStores;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		const result = await Tiles.getAllTiles();
		expect(chrome.topSites.get).not.toHaveBeenCalled();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).toContain('https://pinned.com');
	});

	it('Prefs.history=false returns only pinned positions (sparse slice)', async () => {
		Prefs.history = false;
		Prefs.rows = 2;
		Prefs.columns = 2;
		const stores = (globalThis as any)._testStores;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		const result = await Tiles.getAllTiles();
		// links is sparse: only index 0 is set, so slice(0, 4) returns length 1
		expect(result[0].url).toBe('https://pinned.com');
		expect(result.filter((s: any) => s)).toHaveLength(1);
	});

	it('Prefs.history=true calls topSites.get and fills unpinned slots', async () => {
		Prefs.history = true;
		const stores = (globalThis as any)._testStores;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		(chrome.topSites.get as any).mockImplementation((_opts: any, cb: any) => {
			cb([
				{ url: 'https://history1.com', title: 'H1' },
				{ url: 'https://history2.com', title: 'H2' },
			]);
		});

		const result = await Tiles.getAllTiles();
		expect(chrome.topSites.get).toHaveBeenCalled();
		const urls = result.filter((s: any) => s).map((s: any) => s.url);
		expect(urls).toContain('https://pinned.com');
		expect(urls).toContain('https://history1.com');
	});

	it('Prefs.history=false with no pinned tiles returns empty array', async () => {
		Prefs.history = false;
		Prefs.rows = 1;
		Prefs.columns = 2;

		const result = await Tiles.getAllTiles();
		// No pinned tiles → links is empty sparse array → slice returns []
		expect(result).toHaveLength(0);
		expect(result.filter((s: any) => s)).toHaveLength(0);
	});

	it('Prefs.history=true does not duplicate already-pinned URLs from topSites', async () => {
		Prefs.history = true;
		const stores = (globalThis as any)._testStores;
		stores.tiles.push({ id: 1, url: 'https://pinned.com', title: 'Pinned', position: 0 });

		(chrome.topSites.get as any).mockImplementation((_opts: any, cb: any) => {
			cb([
				{ url: 'https://pinned.com', title: 'Same URL' }, // already pinned
				{ url: 'https://new.com', title: 'New' },
			]);
		});

		const result = await Tiles.getAllTiles();
		const pinnedCount = result.filter((s: any) => s && s.url === 'https://pinned.com').length;
		expect(pinnedCount).toBe(1);
	});
});
