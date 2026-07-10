/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: light/dark/auto theme switching in newTab.js.
 * Phase 1 slot 10 of the migration plan (MIGRATION.md).
 *
 * chrome-prep C4d (CHROME_PREP.md): `updateThemeColours`/`getThemedImageURL`/
 * `parseColour` are real theme.js exports now (moved verbatim out of
 * newTab.js) — imported directly instead of vm-extracted from newTab.js
 * source (C4a/b/c "import from the new specifier" precedent), and driven
 * against the REAL `Prefs` singleton (prefs.js — theme.js imports it for
 * real, so a `globalThis.Prefs` stand-in no longer reaches it; same
 * "second-order fallout" class _helpers.ts's `ensureSiteEnv` documents).
 * `optionsOnChange`/theme-related `updateUI` branches stay vm-extracted from
 * newTab.js (residual, unmoved) — their bodies now call `updateThemeColours`
 * as a bare identifier (real module-level function reference), so it's
 * exposed on the shared `globalThis` (the `isValidURL`/`el` pattern) for
 * those tests, instead of a harness `this.X` stub.
 *
 * Characterizes:
 *   - optionsOnChange: theme pref writes
 *   - updateThemeColours: CSS custom property computation from browser.theme
 *   - updateThemeColours: contrast detection (light vs dark foreground)
 *   - updateThemeColours: clears properties when theme is not 'system'
 *   - updateThemeColours: handles missing/null/invalid theme.colors gracefully
 *   - updateUI('theme'): sets theme attribute, toggles darkIcons, and
 *     registers/removes browser.theme.onUpdated listener based on system mode
 *   - getThemedImageURL: recolors SVG content and returns data URI
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { Prefs } from '../../webextension/prefs.js';
import { updateThemeColours, parseColour } from '../../webextension/theme.js';

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
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const optionsOnChange = extractMethod(source, 'optionsOnChange');
		const updateUI = extractMethod(source, 'updateUI');
		const syncSeg = extractMethod(source, '_syncDrawerSegmented');
		const syncToggle = extractMethod(source, '_syncDrawerToggle');
		const syncSlider = extractMethod(source, '_syncDrawerSlider');

		// `Prefs` is the REAL singleton (prefs.js) — aliased onto `globalThis`
		// so the vm-extracted `optionsOnChange`/`updateUI` bodies' bare
		// `Prefs` reads resolve to the SAME object theme.js's own `import {
		// Prefs }` binding points at (not a second, disconnected stand-in).
		(globalThis as any).Prefs = Prefs;
		globalThis.Filters = { getList: vi.fn(() => ({})) };
		// Stand-in for the extracted updateUI body's bare `Grid` reads --
		// chrome-prep C3d dropped the `'Grid' in window` sniffs that made it
		// optional in this vm harness (C3a guard-removal fallout pattern).
		(globalThis as any).Grid = { sites: [] };

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

		// Mock window.matchMedia
		(globalThis as any).window = {
			matchMedia: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }),
		};
		// chrome-prep C4d: `updateThemeColours`/`refreshBackgroundImage`/
		// `refreshRecent`/`fillNeverCaptureUI` moved to theme.js/wallpaper.js/
		// titlebar.js/filters-ui.js — `updateUI`'s extracted body calls them
		// as bare identifiers now.
		(globalThis as any).updateThemeColours = vi.fn();
		(globalThis as any).refreshBackgroundImage = vi.fn();
		(globalThis as any).refreshRecent = vi.fn();
		(globalThis as any).fillNeverCaptureUI = vi.fn();
		const code = `var newTabTools = { ${optionsOnChange}, ${updateUI}, ${syncSeg}, ${syncToggle}, ${syncSlider}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} }, resizeOptionsThumbnail() {}, applyTileAspect() {} };`;
		vm.runInThisContext(code, { filename: 'theme-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Prefs.theme = 'system';
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
		document.querySelectorAll = vi.fn(() => []) as any;
	});

	// ==================== optionsOnChange — theme pref writes ====================

	it('optionsOnChange sets Prefs.theme for theme radio', () => {
		harness.optionsOnChange({ target: { disabled: false, name: 'theme', value: 'dark', checked: false } });
		expect(Prefs.theme).toBe('dark');
	});

	it('optionsOnChange returns early when target is disabled', () => {
		harness.optionsOnChange({ target: { disabled: true, name: 'theme', value: 'dark' } });
		expect(Prefs.theme).toBe('system');
	});

	// ==================== updateThemeColours — non-system themes ====================

	it('updateThemeColours clears all CSS properties when theme is not "system"', async () => {
		Prefs.theme = 'light';
		await updateThemeColours();
		// All 7 properties should be cleared (set to null)
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--fore-opaque', null);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--page-background', null);
	});

	// ==================== updateThemeColours — system mode ====================

	it('updateThemeColours reads browser.theme.getCurrent when no updateInfo', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(30, 30, 30)', ntp_text: 'rgb(200, 200, 200)' },
		});
		await updateThemeColours();
		expect(browser.theme.getCurrent).toHaveBeenCalled();
	});

	it('updateThemeColours uses updateInfo.theme when provided', async () => {
		Prefs.theme = 'system';
		const theme = { colors: { ntp_background: 'rgb(10, 10, 10)', ntp_text: 'rgb(220, 220, 220)' } };
		await updateThemeColours({ theme });
		expect(browser.theme.getCurrent).not.toHaveBeenCalled();
	});

	it('updateThemeColours computes CSS custom properties from theme colors', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(30, 30, 30)', ntp_text: 'rgb(200, 200, 200)' },
		});
		await updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--back-opaque', 'rgb(30, 30, 30)',
		);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--fore-opaque', 'rgb(200, 200, 200)',
		);
	});

	it('updateThemeColours uses toolbar fallback when ntp_* colors missing', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { toolbar: 'rgb(50, 50, 50)', toolbar_text: 'rgb(180, 180, 180)' },
		});
		await updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--back-opaque', 'rgb(50, 50, 50)',
		);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--fore-opaque', 'rgb(180, 180, 180)',
		);
	});

	// ==================== updateThemeColours — contrast detection ====================

	it('updateThemeColours picks white contrast for dark foreground (brightness < 144)', async () => {
		Prefs.theme = 'system';
		// Dark foreground: rgb(50, 50, 50) → brightness = 0.299*50 + 0.587*50 + 0.114*50 = 50 < 144
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(240, 240, 240)', ntp_text: 'rgb(50, 50, 50)' },
		});
		await updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--contrast-opaque', 'rgb(255, 255, 255)',
		);
	});

	it('updateThemeColours picks black contrast for light foreground (brightness >= 144)', async () => {
		Prefs.theme = 'system';
		// Light foreground: rgb(200, 200, 200) → brightness = 200 > 144
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(30, 30, 30)', ntp_text: 'rgb(200, 200, 200)' },
		});
		await updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--contrast-opaque', 'rgb(0, 0, 0)',
		);
	});

	// ==================== updateThemeColours — error handling ====================

	it('updateThemeColours handles getCurrent rejection gracefully', async () => {
		const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockRejectedValue(new Error('no theme'));
		await expect(updateThemeColours()).resolves.not.toThrow();
		// Properties should still be cleared (null values)
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
		spy.mockRestore();
	});

	it('updateThemeColours handles theme with no parseable colors', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'not-a-color', ntp_text: 'also-bad' },
		});
		await expect(updateThemeColours()).resolves.not.toThrow();
	});

	// ==================== Default-Firefox-theme regression ====================

	it('updateThemeColours handles theme.colors === null without throwing', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({ colors: null });
		await expect(updateThemeColours()).resolves.not.toThrow();
		// All properties should be cleared (null) since there are no colors to apply
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--fore-opaque', null);
	});

	it('updateThemeColours handles theme with no colors key without throwing', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({});
		await expect(updateThemeColours()).resolves.not.toThrow();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
	});

	it('updateThemeColours handles updateInfo with null theme.colors', async () => {
		Prefs.theme = 'system';
		await expect(updateThemeColours({ theme: { colors: null } })).resolves.not.toThrow();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
	});

	// ==================== System theme merger ====================

	it('theme=system extracts browser theme colors when present', async () => {
		Prefs.theme = 'system';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(40, 40, 40)', ntp_text: 'rgb(210, 210, 210)' },
		});
		await updateThemeColours();
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--back-opaque', 'rgb(40, 40, 40)',
		);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
			'--fore-opaque', 'rgb(210, 210, 210)',
		);
	});

	it('theme=light does not call browser.theme.getCurrent', async () => {
		Prefs.theme = 'light';
		await updateThemeColours();
		expect(browser.theme.getCurrent).not.toHaveBeenCalled();
	});

	it('theme=dark does not call browser.theme.getCurrent', async () => {
		Prefs.theme = 'dark';
		await updateThemeColours();
		expect(browser.theme.getCurrent).not.toHaveBeenCalled();
	});

	it('theme=light leaves CSS custom properties at null (NTT palette applies)', async () => {
		Prefs.theme = 'light';
		(globalThis as any).browser.theme.getCurrent.mockResolvedValue({
			colors: { ntp_background: 'rgb(40, 40, 40)', ntp_text: 'rgb(210, 210, 210)' },
		});
		await updateThemeColours();
		// Should clear (null) — forced palette ignores browser theme
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--back-opaque', null);
	});

	// ==================== updateUI — theme branch ====================

	it('updateUI sets theme attribute on documentElement', () => {
		Prefs.theme = 'dark';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('theme', 'dark');
	});

	it('updateUI disables darkIcons when theme is light', () => {
		Prefs.theme = 'light';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(harness.darkIcons.disabled).toBe(true);
	});

	it('updateUI enables darkIcons when theme is dark', () => {
		Prefs.theme = 'dark';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(harness.darkIcons.disabled).toBe(false);
	});

	it('updateUI resolves system theme to dark when prefers-color-scheme is dark', () => {
		Prefs.theme = 'system';
		(globalThis as any).window.matchMedia.mockReturnValue({ matches: true });
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('theme', 'dark');
		expect(harness.darkIcons.disabled).toBe(false);
	});

	it('updateUI resolves system theme to light when prefers-color-scheme is light', () => {
		Prefs.theme = 'system';
		(globalThis as any).window.matchMedia.mockReturnValue({ matches: false });
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(document.documentElement.setAttribute).toHaveBeenCalledWith('theme', 'light');
		expect(harness.darkIcons.disabled).toBe(true);
	});

	// ==================== updateUI — theme branch listener registration ====================

	it('updateUI registers onUpdated listener when theme is system', () => {
		Prefs.theme = 'system';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(browser.theme.onUpdated.addListener).toHaveBeenCalledWith((globalThis as any).updateThemeColours);
	});

	it('updateUI removes onUpdated listener when theme is light', () => {
		Prefs.theme = 'light';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(browser.theme.onUpdated.removeListener).toHaveBeenCalledWith((globalThis as any).updateThemeColours);
	});

	it('updateUI removes onUpdated listener when theme is dark', () => {
		Prefs.theme = 'dark';
		const mockRadio = { checked: false };
		document.querySelector = vi.fn(() => mockRadio) as any;
		(globalThis as any).updateThemeColours = vi.fn();
		harness.updateUI(['theme']);
		expect(browser.theme.onUpdated.removeListener).toHaveBeenCalledWith((globalThis as any).updateThemeColours);
	});

	// ==================== parseColour ====================

	it('parseColour parses rgb() string', () => {
		const result = parseColour('rgb(100, 150, 200)');
		expect(result).toEqual({ r: 100, g: 150, b: 200 });
	});

	it('parseColour returns null for unparseable input', () => {
		expect(parseColour('not-a-color')).toBeNull();
	});
});
