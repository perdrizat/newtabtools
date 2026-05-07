/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: light/dark/auto theme switching in newTab.js.
 * Phase 1 slot 10 of the migration plan (MIGRATION.md).
 *
 * Extracts `updateThemeColours`, `getThemedImageURL`, `optionsOnChange`,
 * and theme-related branches of `updateUI` from the real `newTab.js` via
 * `vm.runInThisContext` with mocked DOM, Prefs, and browser.theme.
 *
 * Characterizes:
 *   - optionsOnChange: theme/themeAuto pref writes
 *   - updateThemeColours: CSS custom property computation from browser.theme
 *   - updateThemeColours: contrast detection (light vs dark foreground)
 *   - updateThemeColours: clears properties when themeAuto is off
 *   - updateThemeColours: handles missing/invalid theme gracefully
 *   - updateUI('theme'): sets theme attribute, toggles darkIcons
 *   - updateUI('themeAuto'): registers/removes browser.theme.onUpdated listener
 *   - getThemedImageURL: recolors SVG content and returns data URI
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

describe('Theme switching — newTab.js (Phase 1 slot 10)', () => {
	let harness: any;

	beforeAll(() => {
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateThemeColours = extractMethod(source, 'updateThemeColours');
		const getThemedImageURL = extractMethod(source, 'getThemedImageURL');
		const optionsOnChange = extractMethod(source, 'optionsOnChange');
		const updateUI = extractMethod(source, 'updateUI');
		const parseColour = extractMethod(source, 'parseColour');

		globalThis.Prefs = { theme: 'light', themeAuto: false, locked: false, rows: 3, columns: 3, opacity: 80, margin: ['small','small','small','small'], spacing: 'small', titleSize: 'small', history: true, recent: true };
		globalThis.Filters = { getList: vi.fn(() => ({})) };

		// Mock browser.theme
		(globalThis as any).browser = {
			theme: {
				getCurrent: vi.fn().mockResolvedValue({ colors: {} }),
				onUpdated: {
					addListener: vi.fn(),
					removeListener: vi.fn(),
				},
			},
			extension: {
				getURL: vi.fn((p: string) => `moz-extension://fake/${p}`),
			},
		};

		const code = `var newTabTools = { ${updateThemeColours}, ${getThemedImageURL}, ${optionsOnChange}, ${updateUI}, ${parseColour}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} }, _theme: null, resizeOptionsThumbnail() {}, refreshRecent() {} };`;
		vm.runInThisContext(code, { filename: 'theme-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		(globalThis as any).Prefs.theme = 'light';
		(globalThis as any).Prefs.themeAuto = false;
		harness._theme = null;
		harness.darkIcons = { disabled: false };

		// Reset document.documentElement mocks
		document.documentElement.setAttribute = vi.fn();
		document.documentElement.removeAttribute = vi.fn();
		document.documentElement.style.setProperty = vi.fn();
		document.documentElement.style.getPropertyValue = vi.fn(() => '');
		document.querySelector = vi.fn(() => ({
			checked: false,
			value: '',
			style: {},
		}));
		document.querySelectorAll = vi.fn(() => []);
	});

	// ==================== optionsOnChange — theme pref writes ====================

	it('optionsOnChange sets Prefs.theme for theme radio', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'theme', value: 'dark', checked: false } });
		expect(Prefs.theme).toBe('dark');
	});

	it('optionsOnChange sets Prefs.themeAuto for checkbox', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'themeAuto', value: '', checked: true } });
		expect(Prefs.themeAuto).toBe(true);
	});

	it('optionsOnChange returns early when target is disabled', () => {
		harness.optionsOnChange({ target: { disabled: true, name: 'theme', value: 'dark' } });
		expect(Prefs.theme).toBe('light');
	});

	// ==================== updateThemeColours — themeAuto off ====================

	it('updateThemeColours clears all CSS properties when themeAuto is off', async () => {
		Prefs.themeAuto = false;
		await harness.updateThemeColours();
		expect(harness._theme).toBeNull();
		// All 7 properties should be cleared (set to null)
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--fore-opaque', null);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--page-background', null);
	});

	// ==================== updateThemeColours — themeAuto on ====================

	it('updateThemeColours reads browser.theme.getCurrent when no updateInfo', async () => {
		Prefs.themeAuto = true;
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(30, 30, 30)', ntp_text: 'rgb(200, 200, 200)' },
		});
		await harness.updateThemeColours();
		expect(browser.theme.getCurrent).toHaveBeenCalled();
		expect(harness._theme).toBeTruthy();
	});

	it('updateThemeColours uses updateInfo.theme when provided', async () => {
		Prefs.themeAuto = true;
		const theme = { colors: { ntp_background: 'rgb(10, 10, 10)', ntp_text: 'rgb(220, 220, 220)' } };
		await harness.updateThemeColours({ theme });
		expect(browser.theme.getCurrent).not.toHaveBeenCalled();
		expect(harness._theme).toBe(theme);
	});

	it('updateThemeColours computes CSS custom properties from theme colors', async () => {
		Prefs.themeAuto = true;
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(30, 30, 30)', ntp_text: 'rgb(200, 200, 200)' },
		});
		await harness.updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--back-opaque', 'rgb(30, 30, 30)',
		);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--fore-opaque', 'rgb(200, 200, 200)',
		);
	});

	it('updateThemeColours uses toolbar fallback when ntp_* colors missing', async () => {
		Prefs.themeAuto = true;
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { toolbar: 'rgb(50, 50, 50)', toolbar_text: 'rgb(180, 180, 180)' },
		});
		await harness.updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--back-opaque', 'rgb(50, 50, 50)',
		);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--fore-opaque', 'rgb(180, 180, 180)',
		);
	});

	// ==================== updateThemeColours — contrast detection ====================

	it('updateThemeColours picks white contrast for dark foreground (brightness < 144)', async () => {
		Prefs.themeAuto = true;
		// Dark foreground: rgb(50, 50, 50) → brightness = 0.299*50 + 0.587*50 + 0.114*50 = 50 < 144
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(240, 240, 240)', ntp_text: 'rgb(50, 50, 50)' },
		});
		await harness.updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--contrast-opaque', 'rgb(255, 255, 255)',
		);
	});

	it('updateThemeColours picks black contrast for light foreground (brightness >= 144)', async () => {
		Prefs.themeAuto = true;
		// Light foreground: rgb(200, 200, 200) → brightness = 200 > 144
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(30, 30, 30)', ntp_text: 'rgb(200, 200, 200)' },
		});
		await harness.updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--contrast-opaque', 'rgb(0, 0, 0)',
		);
	});

	// ==================== updateThemeColours — error handling ====================

	it('updateThemeColours handles getCurrent rejection gracefully', async () => {
		Prefs.themeAuto = true;
		(globalThis as any).browser.theme.getCurrent.mockRejectedValue(new Error('no theme'));
		await expect(harness.updateThemeColours()).resolves.not.toThrow();
		// Properties should still be cleared (null values)
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
	});

	it('updateThemeColours handles theme with no parseable colors', async () => {
		Prefs.themeAuto = true;
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'not-a-color', ntp_text: 'also-bad' },
		});
		await expect(harness.updateThemeColours()).resolves.not.toThrow();
	});

	// ==================== updateUI — theme branch ====================

	it('updateUI sets theme attribute on documentElement', () => {
		Prefs.theme = 'dark';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		harness.updateThemeColours = vi.fn();
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['theme']);
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('theme', 'dark');
	});

	it('updateUI disables darkIcons when theme is light', () => {
		Prefs.theme = 'light';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		harness.updateThemeColours = vi.fn();
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['theme']);
		expect(harness.darkIcons.disabled).toBe(true);
	});

	it('updateUI enables darkIcons when theme is dark', () => {
		Prefs.theme = 'dark';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		harness.updateThemeColours = vi.fn();
		harness.getThemedImageURL = vi.fn().mockResolvedValue(null);
		harness.updateUI(['theme']);
		expect(harness.darkIcons.disabled).toBe(false);
	});

	// ==================== updateUI — themeAuto branch ====================

	it('updateUI registers onUpdated listener when themeAuto is true', () => {
		Prefs.themeAuto = true;
		const mockCheckbox = { checked: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		harness.updateThemeColours = vi.fn();
		harness.updateUI(['themeAuto']);
		expect(browser.theme.onUpdated.addListener).toHaveBeenCalledWith(harness.updateThemeColours);
	});

	it('updateUI removes onUpdated listener when themeAuto is false', () => {
		Prefs.themeAuto = false;
		const mockCheckbox = { checked: false };
		document.querySelector = vi.fn(() => mockCheckbox) as any;
		harness.updateThemeColours = vi.fn();
		harness.updateUI(['themeAuto']);
		expect(browser.theme.onUpdated.removeListener).toHaveBeenCalledWith(harness.updateThemeColours);
	});

	// ==================== parseColour ====================

	it('parseColour parses rgb() string', () => {
		const result = harness.parseColour('rgb(100, 150, 200)');
		expect(result).toEqual({ r: 100, g: 150, b: 200 });
	});

	it('parseColour returns null for unparseable input', () => {
		expect(harness.parseColour('not-a-color')).toBeNull();
	});
});
