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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
// chrome-prep C4d (CHROME_PREP.md): `formatRelativeTime`/
// `_renderAutoSavedIndicator`/`_markAutoSaved`/`_initAutoSaveIndicator` are
// real autosave-indicator.js exports now (moved verbatim out of newTab.js)
// — imported directly instead of vm-extracted from newTab.js source (C4a/
// b/c "import from the new specifier" precedent). `getString` (common.js)
// is imported for real by autosave-indicator.js too, so its bare-key mock
// (`tests/setup.js`: `chrome.i18n.getMessage = (key) => key`, dropping the
// substitution argument) replaces the old harness's `getString(name,
// ...args) { return name + ':' + args[0]; }` stub — assertions below check
// for the bare message key, not a `key:value` string.
import {
	formatRelativeTime,
	_renderAutoSavedIndicator,
	_markAutoSaved,
	_initAutoSaveIndicator,
} from '../../webextension/autosave-indicator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

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
		// chrome-prep C5a (CHROME_PREP.md): `resetAllSettings` now reads the
		// module-level `api` namespace leaf instead of a bare `chrome.*`
		// reference — declared here as a live-resolving stand-in (mirrors
		// webextension/api.js's own Proxy) so the `globalThis.chrome` override
		// below still takes effect at call time.
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var _resetHarness = { ${body}, getString(name) { return name; } };`;
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
		// chrome-prep C5a (CHROME_PREP.md): `api` resolves `globalThis.browser ??
		// chrome` — `browser` must mirror this override or `api.storage`/
		// `api.runtime` would resolve to a stale, untouched mock.
		(globalThis as any).browser = (globalThis as any).chrome;
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
	let realGetMessage: typeof chrome.i18n.getMessage;

	beforeAll(() => {
		// The shared `chrome.i18n.getMessage` mock (tests/setup.js) returns
		// the bare key, dropping substitutions — too coarse to prove the
		// minutes/hours VALUE reaches `getString`. Override it locally
		// (restoring after) to reproduce the original stub's `key:value`
		// shape instead, so the assertions below stay exactly as precise as
		// the old vm-harness's own `getString` stub. Defensive against the
		// earlier `resetAllSettings` describe's `(globalThis as any).chrome =
		// {...}` wholesale replacement (unrelated to chrome-prep C4d, not
		// this file's to fix) — reinstate `chrome.i18n` first if that
		// clobbered it.
		(globalThis as any).chrome = (globalThis as any).chrome || {};
		(globalThis as any).chrome.i18n = (globalThis as any).chrome.i18n || {};
		realGetMessage = chrome.i18n.getMessage;
		(chrome.i18n as any).getMessage = (name: string, substitutions?: string[]) =>
			name + ':' + ((substitutions && substitutions[0]) || '');
	});

	afterAll(() => {
		chrome.i18n.getMessage = realGetMessage;
	});

	it('elapsed < 60s → "just now" key', () => {
		expect(formatRelativeTime(0)).toBe('autosaved_relative_now:');
		expect(formatRelativeTime(59999)).toBe('autosaved_relative_now:');
	});

	it('elapsed 60s-1h → "Nm ago" key with the minutes value', () => {
		expect(formatRelativeTime(60000)).toBe('autosaved_relative_minutes:1');
		expect(formatRelativeTime(120000)).toBe('autosaved_relative_minutes:2');
		expect(formatRelativeTime(59 * 60000)).toBe('autosaved_relative_minutes:59');
	});

	it('elapsed >= 1h → "Nh ago" key with the hours value', () => {
		expect(formatRelativeTime(60 * 60000)).toBe('autosaved_relative_hours:1');
		expect(formatRelativeTime(3 * 60 * 60000)).toBe('autosaved_relative_hours:3');
	});
});

describe('Auto-save indicator — hidden until the first real save', () => {
	// `_autoSaveTickInterval` is autosave-indicator.js's own module-private
	// state now (chrome-prep C4d) — there's no `harness._autoSaveTickInterval`
	// left to `clearInterval()` between tests. Fake timers sidestep the
	// question entirely: `_initAutoSaveIndicator`'s `setInterval` call never
	// creates a real OS timer, so there's nothing to leak regardless of
	// which test ran last.
	beforeEach(() => {
		vi.useFakeTimers();
		document.body.innerHTML = '<div id="ntt-drawer-footer-msg"></div>';
		// Defensive against the earlier `resetAllSettings` describe's
		// `(globalThis as any).chrome = {...}` wholesale replacement
		// (unrelated to chrome-prep C4d) — reinstate the bare-key
		// `chrome.i18n.getMessage` mock (tests/setup.js) if that clobbered it.
		(globalThis as any).chrome = (globalThis as any).chrome || {};
		(globalThis as any).chrome.i18n = (globalThis as any).chrome.i18n || {};
		if (typeof (globalThis as any).chrome.i18n.getMessage !== 'function') {
			(globalThis as any).chrome.i18n.getMessage = (key: string) => key;
		}
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('on init, the indicator is hidden and shows no text (no save has happened yet)', () => {
		_initAutoSaveIndicator();
		const el = document.getElementById('ntt-drawer-footer-msg') as HTMLElement;
		expect(el.hidden).toBe(true);
		expect(el.textContent).toBe('');
	});

	it('after `_markAutoSaved` the indicator becomes visible with localised "just now"', () => {
		_initAutoSaveIndicator();
		_markAutoSaved();
		const el = document.getElementById('ntt-drawer-footer-msg') as HTMLElement;
		expect(el.hidden).toBe(false);
		// `options_autosaved · just now` (the shared `chrome.i18n.getMessage`
		// mock returns the bare key).
		expect(el.textContent).toContain('options_autosaved');
		expect(el.textContent).toContain('autosaved_relative_now');
	});

	it('opening the drawer alone does NOT cause the indicator to appear', () => {
		// Simulated by just calling _renderAutoSavedIndicator twice with no
		// intervening _markAutoSaved. The element must stay hidden.
		_initAutoSaveIndicator();
		_renderAutoSavedIndicator();
		_renderAutoSavedIndicator();
		const el = document.getElementById('ntt-drawer-footer-msg') as HTMLElement;
		expect(el.hidden).toBe(true);
	});
});

describe('page-main.js\'s Prefs.onChange seam calls _markAutoSaved on the newTabTools singleton', () => {
	// PAGE_MODULES.md P3: prefs.js's `prefsChanged` no longer calls
	// `newTabTools._markAutoSaved()` directly (that branch moved to
	// page-main.js's `Prefs.onChange(...)` registration — see prefs.js's own
	// doc comment). The behavioral proof that the seam actually fires
	// `_markAutoSaved`/`updateUI`/`Grid.refresh`/`Updater.updateGrid` lives in
	// tests/integration/prefs-onchange-seam.test.ts (leaf-imports the real
	// page files + spies, rather than a source-string match here); this file
	// keeps only the plain wiring check for `_initAutoSaveIndicator`, which is
	// unrelated to the seam (it's `newTabTools.startup()`'s own `Prefs.init()
	// .then(...)` call, in newTab.js).
	it('`_initAutoSaveIndicator` is called during Prefs.init().then(...) startup', () => {
		// chrome-prep C4d (CHROME_PREP.md): `_initAutoSaveIndicator` moved to
		// autosave-indicator.js; newTab.js's `startup()` now calls it as a
		// bare identifier (the imported function reference), not
		// `newTabTools._initAutoSaveIndicator()`.
		// eslint-disable-next-line ntt/no-source-grep -- wiring check
		const newtab = fs.readFileSync(NEWTAB_PATH, 'utf8');
		expect(newtab).toContain('_initAutoSaveIndicator();');
	});
});
