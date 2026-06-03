/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: layout features in newTab.js — rows, columns, opacity,
 * margin, spacing, titleSize, lock-grid.
 * Phase 1 slot 11 of the migration plan (MIGRATION.md).
 *
 * Extracts `updateUI` and `optionsOnChange` from the real `newTab.js` via
 * `vm.runInThisContext` and exercises the layout-related branches with
 * mock DOM and Prefs.
 *
 * Characterizes:
 *   - optionsOnChange: rows/columns/opacity parse to int, margin splits,
 *     spacing/titleSize as string, locked as checked boolean
 *   - updateUI('rows'/'columns'): sets input value from Prefs
 *   - updateUI('opacity'): sets input value + CSS custom property
 *   - updateUI('margin'): sets input value + applies CSS classes
 *   - updateUI('spacing'/'titleSize'): sets input value + attribute
 *   - updateUI('locked'): sets checkbox, attribute, themed icon
 *   - updateUI(null): applies all branches (full refresh)
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

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

describe('Layout features — newTab.js (Phase 1 slot 11)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateUI = extractMethod(source, 'updateUI');
		const optionsOnChange = extractMethod(source, 'optionsOnChange');
		const getThemedImageURL = extractMethod(source, 'getThemedImageURL');
		const syncSeg = extractMethod(source, '_syncDrawerSegmented');
		const syncToggle = extractMethod(source, '_syncDrawerToggle');
		const syncSlider = extractMethod(source, '_syncDrawerSlider');

		globalThis.Prefs = {
			theme: 'light', locked: false,
			rows: 3, columns: 3, opacity: 80,
			margin: ['small', 'small', 'small', 'small'],
			spacing: 'small', titleSize: 'small',
			tileAspect: 'fill',
			history: true, recent: true,
		};
		globalThis.Filters = { getList: vi.fn(() => ({})) };

		(globalThis as any).browser = {
			theme: {
				getCurrent: vi.fn().mockResolvedValue({ colors: {} }),
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			extension: { getURL: vi.fn((p: string) => `moz-extension://fake/${p}`) },
		};

		const code = `var newTabTools = { ${updateUI}, ${optionsOnChange}, ${getThemedImageURL}, ${syncSeg}, ${syncToggle}, ${syncSlider}, updateThemeColours() {}, resizeOptionsThumbnail() {}, refreshRecent() {}, applyTileAspect() {}, refreshBackgroundImage() {}, _updateThemeToggleIcon() {}, _updateStatusBar() {}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} }, _theme: null };`;
		vm.runInThisContext(code, { filename: 'layout-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Prefs.rows = 3;
		Prefs.columns = 3;
		Prefs.opacity = 80;
		Prefs.margin = ['small', 'small', 'small', 'small'];
		Prefs.spacing = 'small';
		Prefs.titleSize = 'small';
		Prefs.tileAspect = 'fill';
		Prefs.locked = false;
		Prefs.theme = 'light';
		Prefs.history = true;
		Prefs.recent = true;
		harness.lockedToggleButton = { style: {} };

		// Default querySelector mock — returns an object with common properties.
		// Drawer-specific selectors return null so `_syncDrawer*` helpers
		// early-return (this suite tests the legacy form elements, not the
		// new drawer atoms).
		document.querySelector = vi.fn((sel: string) => {
			if (typeof sel === 'string' && (sel.startsWith('.ntt-segmented') || sel.startsWith('.ntt-toggle') || sel.startsWith('.ntt-slider'))) {
				return null;
			}
			return { checked: false, value: '', style: {}, disabled: false };
		}) as any;
		document.querySelectorAll = vi.fn(() => []) as any;
		document.getElementById = vi.fn(() => ({ disabled: false })) as any;
		document.documentElement.setAttribute = vi.fn();
		document.documentElement.removeAttribute = vi.fn();
		document.documentElement.style.setProperty = vi.fn();
		document.documentElement.style.getPropertyValue = vi.fn(() => '');
		document.documentElement.hasAttribute = vi.fn(() => true); // options-hidden = true to skip resizeOptionsThumbnail
	});

	// ==================== optionsOnChange — layout pref writes ====================

	it('optionsOnChange parses rows as integer', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'rows', value: '5', checked: false } });
		expect(Prefs.rows).toBe(5);
	});

	it('optionsOnChange parses columns as integer', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'columns', value: '7', checked: false } });
		expect(Prefs.columns).toBe(7);
	});

	it('optionsOnChange parses opacity as integer', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'opacity', value: '60', checked: false } });
		expect(Prefs.opacity).toBe(60);
	});

	it('optionsOnChange splits margin into 4-element array', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'margin', value: 'large medium small large', checked: false } });
		expect(Prefs.margin).toEqual(['large', 'medium', 'small', 'large']);
	});

	it('optionsOnChange sets spacing as string', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'spacing', value: 'large', checked: false } });
		expect(Prefs.spacing).toBe('large');
	});

	it('optionsOnChange sets titleSize as string', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'titleSize', value: 'hidden', checked: false } });
		expect(Prefs.titleSize).toBe('hidden');
	});

	it('optionsOnChange sets tileAspect as string', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'tileAspect', value: '16-9', checked: false } });
		expect(Prefs.tileAspect).toBe('16-9');
	});

	it('optionsOnChange sets locked from checked boolean', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'locked', value: '', checked: true } });
		expect(Prefs.locked).toBe(true);
	});

	// ==================== updateUI('rows') ====================

	it('updateUI sets rows input value from Prefs', () => {
		Prefs.rows = 7;
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['rows']);
		expect(mockInput.value).toBe(7);
	});

	// ==================== updateUI('columns') ====================

	it('updateUI sets columns input value from Prefs', () => {
		Prefs.columns = 5;
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['columns']);
		expect(mockInput.value).toBe(5);
	});

	// ==================== updateUI('opacity') ====================

	it('updateUI sets opacity input value from Prefs', () => {
		Prefs.opacity = 60;
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['opacity']);
		expect(mockInput.value).toBe(60);
	});

	it('updateUI sets --opacity CSS custom property as fraction', () => {
		Prefs.opacity = 60;
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['opacity']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--opacity', 0.6);
	});

	// ==================== updateUI('titleSize') ====================

	it('updateUI sets titleSize input value and attribute', () => {
		Prefs.titleSize = 'large';
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['titleSize']);
		expect(mockInput.value).toBe('large');
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('titlesize', 'large');
	});

	// ==================== updateUI('spacing') ====================

	it('updateUI sets spacing input value and attribute', () => {
		Prefs.spacing = 'medium';
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['spacing']);
		expect(mockInput.value).toBe('medium');
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('spacing', 'medium');
	});

	// ==================== updateUI('tileAspect') ====================

	it('updateUI sets tileAspect input value and attribute', () => {
		Prefs.tileAspect = '3-4';
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['tileAspect']);
		expect(mockInput.value).toBe('3-4');
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('tileaspect', '3-4');
	});

	// ==================== updateUI('margin') ====================

	it('updateUI sets margin input value as joined string', () => {
		Prefs.margin = ['large', 'medium', 'small', 'large'];
		const mockInput = { value: '' };
		document.querySelector = vi.fn(() => mockInput) as any;
		harness.updateUI(['margin']);
		expect(mockInput.value).toBe('large medium small large');
	});

	it('updateUI applies margin CSS classes to margin elements', () => {
		Prefs.margin = ['large', 'medium', 'small', 'large'];
		const mockInput = { value: '' };
		const mockElement = { classList: { remove: vi.fn(), add: vi.fn() } };
		document.querySelector = vi.fn(() => mockInput) as any;
		document.querySelectorAll = vi.fn(() => [mockElement]) as any;
		harness.updateUI(['margin']);
		// Each margin piece element gets remove('medium'), remove('large'), then add(size) if applicable
		expect(mockElement.classList.remove).toHaveBeenCalledWith('medium');
		expect(mockElement.classList.remove).toHaveBeenCalledWith('large');
	});

	// ==================== updateUI('locked') ====================

	it('updateUI sets locked attribute when Prefs.locked is true', () => {
		Prefs.locked = true;
		const mockCheckbox = { checked: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['locked']);
		expect(mockCheckbox.checked).toBe(true);
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('locked', 'true');
	});

	it('updateUI removes locked attribute when Prefs.locked is false', () => {
		Prefs.locked = false;
		const mockCheckbox = { checked: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['locked']);
		expect(document.documentElement.removeAttribute).toHaveBeenCalledWith('locked');
	});

	it('updateUI calls getThemedImageURL for lock icon', () => {
		Prefs.locked = true;
		const mockCheckbox = { checked: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['locked']);
		expect(harness.getThemedImageURL).toHaveBeenCalledWith('locked');
	});

	it('updateUI calls getThemedImageURL for unlock icon when not locked', () => {
		Prefs.locked = false;
		const mockCheckbox = { checked: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['locked']);
		expect(harness.getThemedImageURL).toHaveBeenCalledWith('unlocked');
	});

	// ==================== updateUI('history') ====================

	it('updateUI sets history checkbox and filter disabled state', () => {
		Prefs.history = false;
		const mockCheckbox = { checked: true };
		const mockFilter = { disabled: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		document.getElementById = vi.fn(() => mockFilter) as any;
		harness.updateUI(['history']);
		expect(mockCheckbox.checked).toBe(false);
		expect(mockFilter.disabled).toBe(true);
	});

	// ==================== updateUI(null) — full refresh ====================

	it('updateUI with null keys applies all branches without error', () => {
		const mockEl = { checked: false, value: '', style: {}, disabled: false, classList: { remove: vi.fn(), add: vi.fn() } };
		document.querySelector = vi.fn(() => mockEl) as any;
		document.querySelectorAll = vi.fn(() => [mockEl]) as any;
		document.getElementById = vi.fn(() => mockEl) as any;
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		expect(() => harness.updateUI(null)).not.toThrow();
	});
});
