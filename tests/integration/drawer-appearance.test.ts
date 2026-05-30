/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: Appearance tab theme cards + `contrast` theme value
 * (Phase 3-2).
 *
 * Covers:
 *   - prefs.js validates `theme` ∈ {system, light, dark, contrast}
 *   - drawerOnClick writes `Prefs.theme` from `.ntt-theme-card` selections
 *   - updateUI reflects active card via aria-checked
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

const APPEARANCE_HTML = `
	<section data-drawer-panel="page">
		<div class="ntt-theme-cards" role="radiogroup" data-pref="theme">
			<button type="button" role="radio" class="ntt-theme-card" data-value="system" aria-checked="true">Inherit Firefox</button>
			<button type="button" role="radio" class="ntt-theme-card" data-value="light" aria-checked="false">Pure white</button>
			<button type="button" role="radio" class="ntt-theme-card" data-value="dark" aria-checked="false">Deep black</button>
			<button type="button" role="radio" class="ntt-theme-card" data-value="contrast" aria-checked="false">High-contrast</button>
		</div>
	</section>
`;

describe('Theme pref accepts the "contrast" enum value (Phase 3-2)', () => {
	let parsePrefs: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading prefs.parsePrefs for behavioral test
		const source = fs.readFileSync(PREFS_PATH, 'utf8');
		const parsePrefsFn = extractMethod(source, 'parsePrefs');
		const code = `var _prefsHarness = { _theme: 'system', _opacity: 80, _rows: 3, _columns: 3, _margin: ['small','small','small','small'], _spacing: 'small', _titleSize: 'small', _tileAspect: 'fill', _statType: 'none', _titleBarSearch: false, _titleBarStatus: true, _actionIconSize: 'medium', _tileActions: true, _tileRadius: 'medium', _locked: false, _history: true, _recent: true, _thumbnailSize: 600, _backgroundUrl: '', _version: -1, ${parsePrefsFn} };`;
		// Stub Blocked / Filters that parsePrefs references.
		(globalThis as any).Blocked = { _list: [] };
		(globalThis as any).Filters = { _list: {} };
		vm.runInThisContext(code, { filename: 'prefs-theme-harness.js' });
		parsePrefs = (globalThis as any)._prefsHarness;
	});

	it('accepts theme="contrast"', () => {
		parsePrefs.parsePrefs({ theme: 'contrast' });
		expect(parsePrefs._theme).toBe('contrast');
	});

	it('still accepts the existing system/light/dark values', () => {
		parsePrefs.parsePrefs({ theme: 'system' });
		expect(parsePrefs._theme).toBe('system');
		parsePrefs.parsePrefs({ theme: 'light' });
		expect(parsePrefs._theme).toBe('light');
		parsePrefs.parsePrefs({ theme: 'dark' });
		expect(parsePrefs._theme).toBe('dark');
	});

	it('rejects unknown theme values (leaves _theme untouched)', () => {
		parsePrefs._theme = 'system';
		parsePrefs.parsePrefs({ theme: 'sepia' });
		expect(parsePrefs._theme).toBe('system');
	});
});

describe('Drawer Appearance tab — theme card clicks (Phase 3-2)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const drawerOnClick = extractMethod(source, 'drawerOnClick');
		const code = `var _appearanceHarness = { ${drawerOnClick}, _ensureHistoryPermission() {}, switchDrawerTab() {}, closeDrawer() {} };`;
		vm.runInThisContext(code, { filename: 'drawer-appearance-harness.js' });
		harness = (globalThis as any)._appearanceHarness;
	});

	beforeEach(() => {
		document.body.innerHTML = APPEARANCE_HTML;
		(globalThis as any).Prefs = { theme: 'system' };
	});

	it('clicking the "Pure white" card writes Prefs.theme = "light"', () => {
		const card = document.querySelector('.ntt-theme-card[data-value="light"]') as HTMLElement;
		harness.drawerOnClick({ target: card });
		expect((globalThis as any).Prefs.theme).toBe('light');
	});

	it('clicking the "Deep black" card writes Prefs.theme = "dark"', () => {
		const card = document.querySelector('.ntt-theme-card[data-value="dark"]') as HTMLElement;
		harness.drawerOnClick({ target: card });
		expect((globalThis as any).Prefs.theme).toBe('dark');
	});

	it('clicking the "High-contrast" card writes Prefs.theme = "contrast"', () => {
		const card = document.querySelector('.ntt-theme-card[data-value="contrast"]') as HTMLElement;
		harness.drawerOnClick({ target: card });
		expect((globalThis as any).Prefs.theme).toBe('contrast');
	});

	it('clicking the "Inherit Firefox" card writes Prefs.theme = "system"', () => {
		(globalThis as any).Prefs.theme = 'dark';
		const card = document.querySelector('.ntt-theme-card[data-value="system"]') as HTMLElement;
		harness.drawerOnClick({ target: card });
		expect((globalThis as any).Prefs.theme).toBe('system');
	});

	it('clicking a child of a theme card still selects (delegation works)', () => {
		// In the production XHTML the card contains a swatch + label spans;
		// the handler must walk up via `.closest`.
		const card = document.querySelector('.ntt-theme-card[data-value="dark"]') as HTMLElement;
		const child = document.createElement('span');
		card.appendChild(child);
		harness.drawerOnClick({ target: child });
		expect((globalThis as any).Prefs.theme).toBe('dark');
	});
});

describe('Drawer Appearance tab — updateUI reflects active theme card (Phase 3-2)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateUI = extractMethod(source, 'updateUI');
		const syncSeg = extractMethod(source, '_syncDrawerSegmented');
		const syncToggle = extractMethod(source, '_syncDrawerToggle');
		const syncSlider = extractMethod(source, '_syncDrawerSlider');

		(globalThis as any).browser = {
			theme: {
				getCurrent: vi.fn().mockResolvedValue({ colors: {} }),
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			extension: { getURL: vi.fn((p: string) => `moz-extension://fake/${p}`) },
		};

		const code = `var newTabTools = { ${updateUI}, ${syncSeg}, ${syncToggle}, ${syncSlider}, updateThemeColours() {}, resizeOptionsThumbnail() {}, refreshRecent() {}, applyTileAspect() {}, _updateThemeToggleIcon() {}, _updateStatusBar() {}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} } };`;
		vm.runInThisContext(code, { filename: 'appearance-updateUI-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		document.body.innerHTML = APPEARANCE_HTML + `
			<input name="theme" type="radio" value="system" />
			<div id="ntt-statusbar"></div>
			<div id="newtab-margin-top"></div>
			<div id="newtab-margin-bottom"></div>
			<div class="newtab-margin-left"></div>
			<div class="newtab-margin-right"></div>
			<div id="ntt-titlebar"></div>
		`;
		(globalThis as any).Prefs = {
			theme: 'contrast', locked: false,
			rows: 3, columns: 3, opacity: 80,
			margin: ['small', 'small', 'small', 'small'],
			spacing: 'small', titleSize: 'small', tileAspect: 'fill',
			tileRadius: 'medium', tileActions: true,
			statType: 'none', actionIconSize: 'medium',
			history: true, recent: true,
			titleBarSearch: false, titleBarStatus: true,
		};
	});

	it('aria-checked="true" on the active theme card, false on others', () => {
		harness.updateUI(['theme']);
		const active = document.querySelector('.ntt-theme-card[data-value="contrast"]') as HTMLElement;
		const inactive = document.querySelector('.ntt-theme-card[data-value="system"]') as HTMLElement;
		expect(active.getAttribute('aria-checked')).toBe('true');
		expect(inactive.getAttribute('aria-checked')).toBe('false');
	});

	it('contrast theme is mirrored onto <html theme="contrast">', () => {
		harness.updateUI(['theme']);
		expect(document.documentElement.getAttribute('theme')).toBe('contrast');
	});
});
