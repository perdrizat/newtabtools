/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: settings panel persistence (Prefs, Blocked, Filters).
 * Phase 1 slot 7 of the migration plan (MIGRATION.md).
 *
 * Loads the real `prefs.js` via `vm.runInThisContext` with mocked
 * `chrome.storage.local`. Characterizes:
 *   - Prefs.init: dynamic getter/setter wiring, storage read, change listener
 *   - Prefs.parsePrefs: validation for every pref key (valid, invalid, missing)
 *   - Prefs.prefsChanged: change propagation via parsePrefs
 *   - Prefs setter → chrome.storage.local.set
 *   - Blocked: block, unblock, isBlocked, clear, persistence
 *   - Filters: setFilter, getList, clear, persistence
 *
 * E2E note: settings panel open/close is covered by tests/e2e/settings-panel.test.js.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Prefs/Blocked/Filters — prefs.js (Phase 1 slot 7)', () => {
	let Prefs: any;
	let Blocked: any;
	let Filters: any;
	let storageData: Record<string, unknown>;
	let onChangedListeners: Array<(changes: Record<string, { newValue: unknown; oldValue: unknown }>) => void>;

	beforeAll(() => {
		// Load prefs.js — defines Prefs, Blocked, Filters on globalThis
		const src = fs.readFileSync(PREFS_PATH, 'utf8');
		vm.runInThisContext(src, { filename: 'prefs.js' });

		Prefs = (globalThis as any).Prefs;
		Blocked = (globalThis as any).Blocked;
		Filters = (globalThis as any).Filters;
	});

	beforeEach(() => {
		storageData = {};
		onChangedListeners = [];

		// Mock chrome.storage.local
		chrome.storage.local.get = vi.fn((cb: (data: Record<string, unknown>) => void) => {
			cb({ ...storageData });
		}) as any;
		chrome.storage.local.set = vi.fn((obj: Record<string, unknown>, cb?: () => void) => {
			Object.assign(storageData, obj);
			if (cb) {cb();}
		}) as any;
		chrome.storage.local.remove = vi.fn() as any;

		// Mock chrome.storage.onChanged
		chrome.storage.onChanged.addListener = vi.fn((listener: any) => {
			onChangedListeners.push(listener);
		}) as any;

		// Reset Prefs internal state to defaults
		Prefs._theme = 'light';
		Prefs._themeAuto = false;
		Prefs._opacity = 80;
		Prefs._rows = 3;
		Prefs._columns = 3;
		Prefs._margin = ['small', 'small', 'small', 'small'];
		Prefs._spacing = 'small';
		Prefs._titleSize = 'small';
		Prefs._locked = false;
		Prefs._history = true;
		Prefs._recent = true;
		Prefs._thumbnailSize = 600;
		Prefs._version = -1;
		Prefs._versionLastUpdate = new Date(0);
		Prefs._versionLastAck = new Date(0);

		Blocked._list = [];
		Filters._list = Object.create(null);
	});

	// ==================== Prefs.init ====================

	it('init removes toolbarIcon from storage', async () => {
		await Prefs.init();
		expect(chrome.storage.local.remove).toHaveBeenCalledWith(['toolbarIcon']);
	});

	it('init reads prefs from chrome.storage.local', async () => {
		storageData = { theme: 'dark', rows: 5 };
		await Prefs.init();
		expect(Prefs._theme).toBe('dark');
		expect(Prefs._rows).toBe(5);
	});

	it('init registers a chrome.storage.onChanged listener', async () => {
		await Prefs.init();
		expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
	});

	it('init wires dynamic getters that read _field', async () => {
		await Prefs.init();
		Prefs._theme = 'dark';
		expect(Prefs.theme).toBe('dark');
		Prefs._rows = 7;
		expect(Prefs.rows).toBe(7);
	});

	it('init wires dynamic setters that call chrome.storage.local.set', async () => {
		await Prefs.init();
		Prefs.theme = 'dark';
		expect(chrome.storage.local.set).toHaveBeenCalledWith({ theme: 'dark' });
	});

	// ==================== parsePrefs — valid values ====================

	it('parsePrefs accepts valid theme', () => {
		Prefs.parsePrefs({ theme: 'dark' });
		expect(Prefs._theme).toBe('dark');
		Prefs.parsePrefs({ theme: 'light' });
		expect(Prefs._theme).toBe('light');
	});

	it('parsePrefs accepts valid themeAuto', () => {
		Prefs.parsePrefs({ themeAuto: true });
		expect(Prefs._themeAuto).toBe(true);
	});

	it('parsePrefs accepts valid opacity (0–100 integer)', () => {
		Prefs.parsePrefs({ opacity: 0 });
		expect(Prefs._opacity).toBe(0);
		Prefs.parsePrefs({ opacity: 100 });
		expect(Prefs._opacity).toBe(100);
		Prefs.parsePrefs({ opacity: 50 });
		expect(Prefs._opacity).toBe(50);
	});

	it('parsePrefs accepts valid rows (1–20 integer)', () => {
		Prefs.parsePrefs({ rows: 1 });
		expect(Prefs._rows).toBe(1);
		Prefs.parsePrefs({ rows: 20 });
		expect(Prefs._rows).toBe(20);
	});

	it('parsePrefs accepts valid columns (1–20 integer)', () => {
		Prefs.parsePrefs({ columns: 1 });
		expect(Prefs._columns).toBe(1);
		Prefs.parsePrefs({ columns: 20 });
		expect(Prefs._columns).toBe(20);
	});

	it('parsePrefs accepts valid margin (4-element array)', () => {
		const m = ['large', 'large', 'large', 'large'];
		Prefs.parsePrefs({ margin: m });
		expect(Prefs._margin).toEqual(m);
	});

	it('parsePrefs accepts valid spacing', () => {
		for (const v of ['small', 'medium', 'large']) {
			Prefs.parsePrefs({ spacing: v });
			expect(Prefs._spacing).toBe(v);
		}
	});

	it('parsePrefs accepts valid titleSize', () => {
		for (const v of ['hidden', 'small', 'medium', 'large']) {
			Prefs.parsePrefs({ titleSize: v });
			expect(Prefs._titleSize).toBe(v);
		}
	});

	it('parsePrefs accepts valid locked', () => {
		Prefs.parsePrefs({ locked: true });
		expect(Prefs._locked).toBe(true);
	});

	it('parsePrefs accepts valid history', () => {
		Prefs.parsePrefs({ history: false });
		expect(Prefs._history).toBe(false);
	});

	it('parsePrefs accepts valid recent', () => {
		Prefs.parsePrefs({ recent: false });
		expect(Prefs._recent).toBe(false);
	});

	it('parsePrefs accepts valid thumbnailSize', () => {
		Prefs.parsePrefs({ thumbnailSize: 1200 });
		expect(Prefs._thumbnailSize).toBe(1200);
	});

	it('parsePrefs accepts numeric and string version', () => {
		Prefs.parsePrefs({ version: 42 });
		expect(Prefs._version).toBe(42);
		Prefs.parsePrefs({ version: '2.0' });
		expect(Prefs._version).toBe('2.0');
	});

	it('parsePrefs accepts versionLastUpdate and versionLastAck as date strings', () => {
		const dateStr = '2026-01-15T00:00:00.000Z';
		Prefs.parsePrefs({ versionLastUpdate: dateStr, versionLastAck: dateStr });
		expect(Prefs._versionLastUpdate.toISOString()).toBe(dateStr);
		expect(Prefs._versionLastAck.toISOString()).toBe(dateStr);
	});

	// ==================== parsePrefs — invalid/missing values ====================

	it('parsePrefs rejects invalid theme (keeps default)', () => {
		Prefs.parsePrefs({ theme: 'neon' });
		expect(Prefs._theme).toBe('light');
	});

	it('parsePrefs rejects out-of-range opacity', () => {
		Prefs.parsePrefs({ opacity: -1 });
		expect(Prefs._opacity).toBe(80);
		Prefs.parsePrefs({ opacity: 101 });
		expect(Prefs._opacity).toBe(80);
		Prefs.parsePrefs({ opacity: 3.5 });
		expect(Prefs._opacity).toBe(80);
	});

	it('parsePrefs rejects out-of-range rows', () => {
		Prefs.parsePrefs({ rows: 0 });
		expect(Prefs._rows).toBe(3);
		Prefs.parsePrefs({ rows: 21 });
		expect(Prefs._rows).toBe(3);
	});

	it('parsePrefs rejects out-of-range columns', () => {
		Prefs.parsePrefs({ columns: 0 });
		expect(Prefs._columns).toBe(3);
		Prefs.parsePrefs({ columns: 21 });
		expect(Prefs._columns).toBe(3);
	});

	it('parsePrefs rejects margin with wrong length', () => {
		Prefs.parsePrefs({ margin: ['small', 'small'] });
		expect(Prefs._margin).toEqual(['small', 'small', 'small', 'small']);
	});

	it('parsePrefs rejects invalid spacing', () => {
		Prefs.parsePrefs({ spacing: 'huge' });
		expect(Prefs._spacing).toBe('small');
	});

	it('parsePrefs rejects invalid titleSize', () => {
		Prefs.parsePrefs({ titleSize: 'tiny' });
		expect(Prefs._titleSize).toBe('small');
	});

	it('parsePrefs coerces locked to strict boolean', () => {
		Prefs.parsePrefs({ locked: 'yes' });
		expect(Prefs._locked).toBe(false);
	});

	it('parsePrefs ignores unknown keys (characterization — §2.5 noted in audit)', () => {
		Prefs.parsePrefs({ unknownKey: 'evil', rows: 5 });
		expect(Prefs._rows).toBe(5);
		// unknownKey is silently ignored by parsePrefs — but the audit notes
		// that restore writes raw prefs to storage, so unknown keys end up
		// persisted even though parsePrefs doesn't read them.
		expect((Prefs as any)._unknownKey).toBeUndefined();
	});

	// ==================== parsePrefs — Blocked and Filters ====================

	it('parsePrefs loads blocked list', () => {
		Prefs.parsePrefs({ blocked: ['https://evil.com'] });
		expect(Blocked._list).toEqual(['https://evil.com']);
	});

	it('parsePrefs loads filters object', () => {
		Prefs.parsePrefs({ filters: { 'example.com': 3 } });
		expect(Filters._list).toEqual({ 'example.com': 3 });
	});

	// ==================== prefsChanged ====================

	it('prefsChanged applies new values via parsePrefs', async () => {
		await Prefs.init();
		const listener = onChangedListeners[0];
		listener({ rows: { newValue: 7, oldValue: 3 } });
		expect(Prefs._rows).toBe(7);
	});

	it('prefsChanged ignores changes where newValue == oldValue', async () => {
		await Prefs.init();
		Prefs._rows = 3;
		const listener = onChangedListeners[0];
		listener({ rows: { newValue: 3, oldValue: 3 } });
		expect(Prefs._rows).toBe(3);
	});

	it('prefsChanged skips UI update for thumbnailSize-only change', async () => {
		await Prefs.init();
		// prefsChanged checks for window.newTabTools — in our env it doesn't exist,
		// so the UI branch is not taken. This test verifies it doesn't throw.
		const listener = onChangedListeners[0];
		expect(() => {
			listener({ thumbnailSize: { newValue: 800, oldValue: 600 } });
		}).not.toThrow();
		expect(Prefs._thumbnailSize).toBe(800);
	});

	// ==================== Prefs version setters ====================

	it('versionLastAck setter writes JSON date to storage', () => {
		const d = new Date('2026-06-01T00:00:00.000Z');
		Prefs.versionLastAck = d;
		expect(chrome.storage.local.set).toHaveBeenCalledWith({
			versionLastAck: d.toJSON(),
		});
	});

	it('versionLastUpdate setter writes JSON date and updates internal field', () => {
		const d = new Date('2026-06-01T00:00:00.000Z');
		Prefs.versionLastUpdate = d;
		expect(Prefs._versionLastUpdate).toBe(d);
		expect(chrome.storage.local.set).toHaveBeenCalledWith({
			versionLastUpdate: d.toJSON(),
		});
	});

	// ==================== Blocked ====================

	it('block adds URL and persists to storage', async () => {
		await Blocked.block('https://evil.com');
		expect(Blocked._list).toContain('https://evil.com');
		expect(chrome.storage.local.set).toHaveBeenCalledWith(
			{ blocked: ['https://evil.com'] },
			expect.any(Function),
		);
	});

	it('unblock removes URL and persists to storage', async () => {
		Blocked._list = ['https://a.com', 'https://b.com'];
		await Blocked.unblock('https://a.com');
		expect(Blocked._list).toEqual(['https://b.com']);
	});

	it('unblock is a no-op for unknown URL', async () => {
		Blocked._list = ['https://a.com'];
		await Blocked.unblock('https://unknown.com');
		expect(Blocked._list).toEqual(['https://a.com']);
	});

	it('isBlocked returns correct membership', () => {
		Blocked._list = ['https://evil.com'];
		expect(Blocked.isBlocked('https://evil.com')).toBe(true);
		expect(Blocked.isBlocked('https://good.com')).toBe(false);
	});

	it('clear empties list and persists', async () => {
		Blocked._list = ['https://a.com', 'https://b.com'];
		await Blocked.clear();
		expect(Blocked._list).toHaveLength(0);
		expect(chrome.storage.local.set).toHaveBeenCalledWith(
			{ blocked: [] },
			expect.any(Function),
		);
	});

	// ==================== Filters ====================

	it('setFilter adds host filter and persists', () => {
		Filters.setFilter('example.com', 5);
		expect(Filters._list['example.com']).toBe(5);
		expect(chrome.storage.local.set).toHaveBeenCalledWith({
			filters: expect.objectContaining({ 'example.com': 5 }),
		});
	});

	it('setFilter with limit -1 removes the filter', () => {
		Filters._list['example.com'] = 5;
		Filters.setFilter('example.com', -1);
		expect('example.com' in Filters._list).toBe(false);
	});

	it('getList returns a copy (mutations do not affect internal state)', () => {
		Filters._list['example.com'] = 3;
		const copy = Filters.getList();
		copy['example.com'] = 99;
		expect(Filters._list['example.com']).toBe(3);
	});

	it('clear empties filters and persists', () => {
		Filters._list['example.com'] = 3;
		Filters.clear();
		expect(Object.keys(Filters._list)).toHaveLength(0);
		expect(chrome.storage.local.set).toHaveBeenCalledWith({
			filters: expect.any(Object),
		});
	});
});
