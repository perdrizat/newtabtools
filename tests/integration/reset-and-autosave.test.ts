/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phase 3-3 polish:
 *   - `resetAllSettings()` performs a destructive reset (clears Tiles,
 *      Blocked, Filters, all chrome.storage prefs, then reloads). Confirmed
 *      via window.confirm — refuses to run if the user cancels.
 *   - `formatRelativeTime(ms)` returns the localised "just now" / "Nm ago"
 *      / "Nh ago" string for the auto-save indicator's relative timestamp.
 *   - `_markAutoSaved` is called from prefs.prefsChanged so each pref
 *      change ticks the indicator's `_autoSavedAt`.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) { throw new Error(`${methodName} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('resetAllSettings — destructive factory reset', () => {
	let harness: any;
	let originalLocation: Location;
	let reloadSpy: ReturnType<typeof vi.fn>;
	let storageClear: ReturnType<typeof vi.fn>;
	let tilesClear: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'resetAllSettings');
		const code = `var _resetHarness = { ${body}, getString(name) { return name; } };`;
		vm.runInThisContext(code, { filename: 'reset-harness.js' });
		harness = (globalThis as any)._resetHarness;

		originalLocation = window.location;
	});

	beforeEach(() => {
		reloadSpy = vi.fn();
		// Override location.reload only (keep other properties intact).
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: { ...originalLocation, reload: reloadSpy } as any,
		});

		storageClear = vi.fn((cb: any) => cb());
		// `Tiles.clear` lives in the background, not in tiles-shim. Reset
		// dispatches a `Tiles.clear` message to wipe IDB.
		tilesClear = vi.fn();
		const tilesClearFn = tilesClear;
		(globalThis as any).chrome = {
			storage: { local: { clear: storageClear } },
			runtime: {
				sendMessage: vi.fn((msg: any, cb: any) => {
					if (msg && msg.name === 'Tiles.clear') {
						(tilesClearFn as () => void)();
					}
					if (typeof cb === 'function') { cb(); }
				}),
			},
		};
		(globalThis as any).Blocked = { _list: ['https://blocked.example/'], _saveList: vi.fn() };
		(globalThis as any).Filters = { _list: { 'example.com': 2 }, _saveList: vi.fn() };
		(globalThis as any).NeverCapture = {
			_list: ['example.com'],
			clear: vi.fn(function(this: any) { this._list = []; return Promise.resolve(); }),
		};
	});

	it('runs without a window.confirm prompt — the inline Confirm row gates it now (§7)', async () => {
		// §7 replaced window.confirm with an inline Confirm/Cancel row (wired in
		// optionsOnClick, covered by advanced-tab.test.ts). resetAllSettings is
		// the post-confirm action, so it performs the reset unconditionally.
		(window as any).confirm = vi.fn();
		await harness.resetAllSettings();
		expect((window as any).confirm).not.toHaveBeenCalled();
		expect(tilesClear).toHaveBeenCalled();
	});

	it('regression: dispatches the `Tiles.clear` background message (page-side Tiles has no .clear method)', async () => {
		window.confirm = vi.fn().mockReturnValue(true);
		await harness.resetAllSettings();
		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Tiles.clear' }),
			expect.any(Function)
		);
		expect(tilesClear).toHaveBeenCalledTimes(1);
	});

	it('§1.4: also clears the Thumbnails + Background IDB stores (no leftover imagery)', async () => {
		window.confirm = vi.fn().mockReturnValue(true);
		await harness.resetAllSettings();
		const send = (globalThis as any).chrome.runtime.sendMessage;
		// Captured screenshots + cached favicons.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.clear' }),
			expect.any(Function)
		);
		// Uploaded wallpaper blob — setBackground(null) clears the store.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Background.setBackground', file: null }),
			expect.any(Function)
		);
	});

	it('clears in-memory Blocked + Filters + NeverCapture, then chrome.storage.local, then reloads', async () => {
		window.confirm = vi.fn().mockReturnValue(true);
		await harness.resetAllSettings();
		expect((globalThis as any).Blocked._list).toEqual([]);
		expect((globalThis as any).Filters._list).toEqual({});
		// Behavioral coverage for the resetAllSettings → NeverCapture.clear()
		// wiring: the real reset body runs clear() and empties the list (not a
		// source-string grep).
		expect((globalThis as any).NeverCapture.clear).toHaveBeenCalledTimes(1);
		expect((globalThis as any).NeverCapture._list).toEqual([]);
		expect(storageClear).toHaveBeenCalledTimes(1);
		expect(reloadSpy).toHaveBeenCalledTimes(1);
	});
});

describe('formatRelativeTime — auto-save indicator labels', () => {
	let harness: any;
	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'formatRelativeTime');
		const code = `var _relHarness = { ${body}, getString(name, ...args) { return name + ':' + (args[0] || ''); } };`;
		vm.runInThisContext(code, { filename: 'rel-harness.js' });
		harness = (globalThis as any)._relHarness;
	});

	it('elapsed < 60s → "just now" key', () => {
		expect(harness.formatRelativeTime(0)).toBe('autosaved_relative_now:');
		expect(harness.formatRelativeTime(59999)).toBe('autosaved_relative_now:');
	});

	it('elapsed 60s-1h → "Nm ago" key with the minutes value', () => {
		expect(harness.formatRelativeTime(60000)).toBe('autosaved_relative_minutes:1');
		expect(harness.formatRelativeTime(120000)).toBe('autosaved_relative_minutes:2');
		expect(harness.formatRelativeTime(59 * 60000)).toBe('autosaved_relative_minutes:59');
	});

	it('elapsed >= 1h → "Nh ago" key with the hours value', () => {
		expect(harness.formatRelativeTime(60 * 60000)).toBe('autosaved_relative_hours:1');
		expect(harness.formatRelativeTime(3 * 60 * 60000)).toBe('autosaved_relative_hours:3');
	});
});

describe('Auto-save indicator — hidden until the first real save', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const render = extractMethod(source, '_renderAutoSavedIndicator');
		const mark = extractMethod(source, '_markAutoSaved');
		const format = extractMethod(source, 'formatRelativeTime');
		const init = extractMethod(source, '_initAutoSaveIndicator');
		const code = `var _saveHarness = { ${render}, ${mark}, ${format}, ${init}, getString(name) { return name; }, _autoSavedAt: null };`;
		vm.runInThisContext(code, { filename: 'autosave-harness.js' });
		harness = (globalThis as any)._saveHarness;
	});

	beforeEach(() => {
		document.body.innerHTML = '<div id="ntt-drawer-footer-msg"></div>';
		harness._autoSavedAt = null;
		harness._autoSaveTickInterval = null;
	});

	it('on init, the indicator is hidden and shows no text (no save has happened yet)', () => {
		harness._initAutoSaveIndicator();
		const el = document.getElementById('ntt-drawer-footer-msg') as HTMLElement;
		expect(el.hidden).toBe(true);
		expect(el.textContent).toBe('');
		clearInterval(harness._autoSaveTickInterval);
	});

	it('after `_markAutoSaved` the indicator becomes visible with localised "just now"', () => {
		harness._initAutoSaveIndicator();
		harness._markAutoSaved();
		const el = document.getElementById('ntt-drawer-footer-msg') as HTMLElement;
		expect(el.hidden).toBe(false);
		// `options_autosaved · just now` (getString stub returns the key).
		expect(el.textContent).toContain('options_autosaved');
		expect(el.textContent).toContain('autosaved_relative_now');
		clearInterval(harness._autoSaveTickInterval);
	});

	it('opening the drawer alone does NOT cause the indicator to appear', () => {
		// Simulated by just calling _renderAutoSavedIndicator twice with no
		// intervening _markAutoSaved. The element must stay hidden.
		harness._initAutoSaveIndicator();
		harness._renderAutoSavedIndicator();
		harness._renderAutoSavedIndicator();
		const el = document.getElementById('ntt-drawer-footer-msg') as HTMLElement;
		expect(el.hidden).toBe(true);
		clearInterval(harness._autoSaveTickInterval);
	});
});

describe('prefs.prefsChanged calls _markAutoSaved on the newTabTools singleton', () => {
	let source: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: prefsChanged hook
		source = fs.readFileSync(PREFS_PATH, 'utf8');
	});

	it('prefsChanged invokes `_markAutoSaved` when the singleton exposes it', () => {
		// Defensive guard included so older harnesses without the helper
		// don't crash. Either form is acceptable as long as the call site
		// is present.
		expect(source).toMatch(/newTabTools\._markAutoSaved\(\)/);
	});

	it('`_initAutoSaveIndicator` is called during Prefs.init().then(...) startup', () => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check
		const newtab = fs.readFileSync(NEWTAB_PATH, 'utf8');
		expect(newtab).toMatch(/newTabTools\._initAutoSaveIndicator\(\)/);
	});
});
