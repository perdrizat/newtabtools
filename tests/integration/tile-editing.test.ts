/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: per-tile custom title, custom URL, saved thumbnail,
 * and background color editing via optionsOnClick in newTab.js.
 * Phase 1 slot 8 of the migration plan (MIGRATION.md).
 *
 * Extracts only `optionsOnClick` from the real `newTab.js` via
 * `vm.runInThisContext` and exercises the tile-editing switch cases
 * with mock `selectedSite`, `Tiles.putTile`, and input elements.
 *
 * E2E note: no E2E yet for tile editing — these are small, isolated
 * UI features best covered at the Integration tier.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { isValidURL } from '../../webextension/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t${methodName}\\(`, 'm');
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

function makeEvent(id: string) {
	return { target: { id, disabled: false, classList: { contains: vi.fn(() => false) } } };
}

describe('Tile editing — optionsOnClick cases (Phase 1 slot 8)', () => {
	let harness: any;
	let selectedSite: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'optionsOnClick');
		const normalizePinURL = extractMethod(source, 'normalizePinURL');
		// `isValidURL` (newTab.js) is now a one-line delegate to common.js's
		// real `isValidURL` export (P2-P5 review finding 1, revised
		// remediation, 2026-07-10) — vm.runInThisContext shares this file's
		// real globalThis, so the delegate's bare-identifier call resolves as
		// long as the real function is exposed there first (below).
		const isValidURLBody = extractMethod(source, 'isValidURL');
		const historyTitleFor = extractMethod(source, 'historyTitleFor');

		globalThis.Tiles = { putTile: vi.fn().mockResolvedValue(1), getTile: vi.fn() };
		globalThis.Prefs = { rows: 3, columns: 3 };
		globalThis.Filters = { setFilter: vi.fn() };
		globalThis.Updater = { updateGrid: vi.fn() };
		globalThis.Background = { setBackground: vi.fn().mockResolvedValue(undefined) };
		globalThis.Grid = { cells: [{ index: 0, containsPinnedSite: () => false }] };
		(globalThis as any).isValidURL = isValidURL;
		// chrome.history.search is needed by historyTitleFor — return [] so
		// it resolves to null and the url-set flow continues synchronously.
		(globalThis as any).chrome = (globalThis as any).chrome || {};
		(globalThis as any).chrome.history = { search: vi.fn((_q: any, cb: any) => cb([])) };

		// chrome-prep C5a (CHROME_PREP.md): `optionsOnClick`/`historyTitleFor`'s
		// extracted bodies now read the module-level `api` namespace leaf
		// instead of a bare `chrome.*` reference — declared here as a
		// live-resolving stand-in (mirrors webextension/api.js's own Proxy) so
		// the shared `globalThis.chrome` mock still takes effect at call time.
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var newTabTools = { ${body}, ${normalizePinURL}, ${isValidURLBody}, ${historyTitleFor}, hideOptions() {}, showOptionsExtra() {}, fillFilterUI() {}, refreshBackgroundImage() { return Promise.resolve(); }, setPinURLInputValue() {}, autocomplete() {} };`;
		vm.runInThisContext(code, { filename: 'tile-editing-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		selectedSite = {
			link: { url: 'https://example.com', title: 'Example' },
			addTitle: vi.fn(),
			thumbnail: { style: {} },
		};
		harness.selectedSite = selectedSite;
		harness.siteURLInput = { value: '' };
		harness.setTitleInput = { value: '' };
		harness.setSavedThumbInput = { files: [] };
		harness.setBgColourInput = { value: '', click: vi.fn() };
		harness.setBgColourDisplay = { style: {} };
		harness.setBgColourButton = { disabled: false };
		harness.resetBgColourButton = { disabled: false };
		harness.saveCurrentThumbButton = { disabled: false };
		harness.removeSavedThumbButton = { disabled: false };
		harness.siteThumbnail = { style: {} };
		harness.setBackgroundInput = { files: [] };
		harness.updateNotice = { hidden: false, dataset: { version: '1.0' } };
		harness.optionsPane = { querySelector: vi.fn() };
		harness.optionsFilterHost = { value: '', focus: vi.fn() };
		harness.optionsFilterCount = { value: '' };
		harness.optionsFilterSet = { disabled: false };
		harness.pinURLInput = { checkValidity: vi.fn(() => true), value: '', focus: vi.fn() };
		harness.pinURLBlocked = { hidden: false };
		harness._selectedSiteIndex = 0;
		harness.setThumbnail = vi.fn();
		harness.removeThumbnail = vi.fn();
	});

	// ==================== disabled guard ====================

	it('returns early when event target is disabled', () => {
		harness.optionsOnClick({ target: { id: 'options-title-set', disabled: true } });
		expect(Tiles.putTile).not.toHaveBeenCalled();
	});

	// ==================== custom title ====================

	it('options-title-set writes title to link and calls putTile', () => {
		harness.setTitleInput.value = 'New Title';
		harness.optionsOnClick(makeEvent('options-title-set'));
		expect(selectedSite.link.title).toBe('New Title');
		expect(selectedSite.addTitle).toHaveBeenCalled();
		expect(Tiles.putTile).toHaveBeenCalledWith(selectedSite.link);
	});

	// ==================== custom URL ====================

	it('options-url-set writes URL to link and calls putTile', async () => {
		harness.siteURLInput.value = 'https://new-url.com';
		harness.siteURL = { textContent: '' };
		harness.optionsOnClick(makeEvent('options-url-set'));
		// Title refresh + putTile happen inside historyTitleFor().then(...).
		// Flush the microtask + history.search callback chain.
		await new Promise(r => setTimeout(r, 0));
		expect(selectedSite.link.url).toBe('https://new-url.com');
		expect(selectedSite.addTitle).toHaveBeenCalled();
		expect(Tiles.putTile).toHaveBeenCalledWith(selectedSite.link);
	});

	// ==================== saved thumbnail ====================

	it('options-savedthumb-set calls setThumbnail with object URL', () => {
		const fakeFile = new Blob(['img']);
		harness.setSavedThumbInput.files = [fakeFile];
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
		harness.optionsOnClick(makeEvent('options-savedthumb-set'));
		expect(harness.setThumbnail).toHaveBeenCalledWith(selectedSite, 'blob:fake');
		expect(harness.removeSavedThumbButton.disabled).toBe(false);
	});

	it('options-savedthumb-remove calls removeThumbnail', () => {
		harness.optionsOnClick(makeEvent('options-savedthumb-remove'));
		expect(harness.removeThumbnail).toHaveBeenCalledWith(selectedSite);
		expect(harness.removeSavedThumbButton.disabled).toBe(true);
	});

	// ==================== save current thumbnail ====================

	it('options-savethumb sends Thumbnails.get message', () => {
		chrome.runtime.sendMessage.mockImplementation(() => {});
		harness.optionsOnClick(makeEvent('options-savethumb'));
		expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.get', urls: ['https://example.com'] }),
			expect.any(Function),
		);
	});

	it('options-savethumb stores image on link when thumbnail found', () => {
		const thumbMap = new Map([['https://example.com', 'blob-data']]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));
		harness.optionsOnClick(makeEvent('options-savethumb'));
		expect(selectedSite.link.image).toBe('blob-data');
		expect(selectedSite.link.imageIsThumbnail).toBe(true);
		expect(Tiles.putTile).toHaveBeenCalledWith(selectedSite.link);
	});

	it('options-savethumb does not write when no thumbnail available', () => {
		const thumbMap = new Map();
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));
		harness.optionsOnClick(makeEvent('options-savethumb'));
		expect(Tiles.putTile).not.toHaveBeenCalled();
	});

	// CHROME.md D3 slice 3 finding (2026-07-16, real Chrome): a `Map` sent as
	// a `Thumbnails.get` response degrades to a plain `{}` object over
	// `chrome.runtime.sendMessage` on Chrome (unlike Firefox, where structured
	// clone preserves the real Map) — `thumbs.get(...)` then throws
	// `TypeError: thumbs.get is not a function`. This pins the fix: the
	// call site must read a plain-object response too, not just a real Map.
	it('options-savethumb stores image on link when thumbnail found (plain-object response, Chrome)', () => {
		const thumbObject = { 'https://example.com': 'blob-data' };
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbObject));
		expect(() => harness.optionsOnClick(makeEvent('options-savethumb'))).not.toThrow();
		expect(selectedSite.link.image).toBe('blob-data');
		expect(selectedSite.link.imageIsThumbnail).toBe(true);
		expect(Tiles.putTile).toHaveBeenCalledWith(selectedSite.link);
	});

	// ==================== background color ====================

	it('options-bgcolor-set writes backgroundColor to link and putTile', () => {
		harness.setBgColourInput.value = '#ff0000';
		harness.optionsOnClick(makeEvent('options-bgcolor-set'));
		expect(selectedSite.link.backgroundColor).toBe('#ff0000');
		expect(Tiles.putTile).toHaveBeenCalledWith(selectedSite.link);
		expect(harness.resetBgColourButton.disabled).toBe(false);
	});

	it('options-bgcolor-reset deletes backgroundColor and putTile', () => {
		selectedSite.link.backgroundColor = '#ff0000';
		harness.optionsOnClick(makeEvent('options-bgcolor-reset'));
		expect('backgroundColor' in selectedSite.link).toBe(false);
		expect(Tiles.putTile).toHaveBeenCalledWith(selectedSite.link);
		expect(harness.resetBgColourButton.disabled).toBe(true);
		expect(harness.setBgColourButton.disabled).toBe(true);
	});

	it('options-bgcolor-display opens color picker', () => {
		harness.optionsOnClick(makeEvent('options-bgcolor-display'));
		expect(harness.setBgColourInput.click).toHaveBeenCalled();
	});

	// ==================== page background ====================

	it('options-wallpaper-btn calls openWallpaperPicker', () => {
		// chrome-prep C4d (CHROME_PREP.md): `openWallpaperPicker`/`resetWallpaper`
		// moved to wallpaper.js — `optionsOnClick`'s extracted body now calls
		// them as bare identifiers, so they're exposed on the shared
		// `globalThis` (the `isValidURL`/`el` pattern) instead of harness
		// `this.X` stubs.
		(globalThis as any).openWallpaperPicker = vi.fn();
		harness.optionsOnClick(makeEvent('options-wallpaper-btn'));
		expect((globalThis as any).openWallpaperPicker).toHaveBeenCalled();
	});

	it('options-bg-remove calls resetWallpaper', () => {
		(globalThis as any).resetWallpaper = vi.fn();
		harness.optionsOnClick(makeEvent('options-bg-remove'));
		expect((globalThis as any).resetWallpaper).toHaveBeenCalled();
	});
});
