/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: Layout tab control bindings (Phase 3-1).
 *
 * Extracts `drawerOnClick`, `drawerOnChange`, and the layout-specific
 * branches of `updateUI` from newTab.js. Exercises the new form atoms:
 *   - Segmented buttons (columns, rows, recent, statType, actionIconSize)
 *   - Snap sliders for `spacing`, `margin`, `tileRadius` (indices 0/1/2 →
 *     small/medium/large enum)
 *   - Toggle switches for titleBar* prefs, titleSize (hidden↔small),
 *     tileActions
 *   - updateUI reflects Prefs onto aria-checked / range value / slider
 *     label text
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

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

const PANEL_HTML = `
	<section data-drawer-panel="page">
		<div class="ntt-form-group">
			<div class="ntt-segmented" role="radiogroup" data-pref="columns">
				<button type="button" role="radio" data-value="3">3</button>
				<button type="button" role="radio" data-value="4">4</button>
				<button type="button" role="radio" data-value="5">5</button>
				<button type="button" role="radio" data-value="6">6</button>
				<button type="button" role="radio" data-value="7">7</button>
			</div>
			<div class="ntt-segmented" role="radiogroup" data-pref="rows">
				<button type="button" role="radio" data-value="2">2</button>
				<button type="button" role="radio" data-value="3">3</button>
				<button type="button" role="radio" data-value="4">4</button>
				<button type="button" role="radio" data-value="5">5</button>
			</div>
		</div>
		<div class="ntt-form-group">
			<div class="ntt-slider-snap" data-pref="spacing">
				<div class="ntt-slider-head"><span>Tile gap</span><span class="ntt-slider-value"></span></div>
				<input type="range" min="0" max="2" step="1" data-pref="spacing" />
			</div>
			<div class="ntt-slider-snap" data-pref="margin">
				<div class="ntt-slider-head"><span>Outer padding</span><span class="ntt-slider-value"></span></div>
				<input type="range" min="0" max="2" step="1" data-pref="margin" />
			</div>
			<div class="ntt-slider-snap" data-pref="tileRadius">
				<div class="ntt-slider-head"><span>Corner radius</span><span class="ntt-slider-value"></span></div>
				<input type="range" min="0" max="2" step="1" data-pref="tileRadius" />
			</div>
		</div>
		<div class="ntt-form-group">
			<div class="ntt-toggle-row" data-pref="recent"><span class="ntt-toggle-label">Recently closed</span><button type="button" role="switch" class="ntt-toggle" data-pref="recent" aria-checked="true"></button></div>
			<div class="ntt-toggle-row" data-pref="titleBarSearch"><span class="ntt-toggle-label">Search <span class="ntt-toggle-kbd">/</span></span><button type="button" role="switch" class="ntt-toggle" data-pref="titleBarSearch" aria-checked="false"></button></div>
		</div>
		<div class="ntt-form-group">
			<div class="ntt-toggle-row" data-pref="titleSize"><button type="button" role="switch" class="ntt-toggle" data-pref="titleSize" aria-checked="true"></button></div>
			<div class="ntt-toggle-row" data-pref="tileActions"><button type="button" role="switch" class="ntt-toggle" data-pref="tileActions" aria-checked="true"></button></div>
		</div>
		<div class="ntt-form-group">
			<div class="ntt-segmented" role="radiogroup" data-pref="statType">
				<button type="button" role="radio" data-value="none">None</button>
				<button type="button" role="radio" data-value="last">Last</button>
				<button type="button" role="radio" data-value="visits">Visits</button>
				<button type="button" role="radio" data-value="trend">Trend</button>
			</div>
		</div>
		<div class="ntt-form-group">
			<div class="ntt-segmented" role="radiogroup" data-pref="actionIconSize">
				<button type="button" role="radio" data-value="small">S</button>
				<button type="button" role="radio" data-value="medium">M</button>
				<button type="button" role="radio" data-value="large">L</button>
			</div>
		</div>
	</section>
`;

describe('Drawer Layout tab — drawerOnClick (Phase 3-1)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const drawerOnClick = extractMethod(source, 'drawerOnClick');

		const code = `var _layoutHarness = { ${drawerOnClick}, _ensureHistoryPermission() {} };`;
		vm.runInThisContext(code, { filename: 'drawer-layout-harness.js' });
		harness = (globalThis as any)._layoutHarness;
	});

	beforeEach(() => {
		document.body.innerHTML = PANEL_HTML;
		(globalThis as any).Prefs = {
			columns: 3, rows: 3,
			spacing: 'small', margin: ['small', 'small', 'small', 'small'],
			tileRadius: 'medium',
			recent: true, history: true,
			titleBarSearch: false,
			titleBarStatus: true,
			titleSize: 'small', tileActions: true,
			statType: 'none', actionIconSize: 'medium',
		};
	});

	it('clicking a segmented button writes the integer value (rows/columns)', () => {
		const btn = document.querySelector('.ntt-segmented[data-pref="columns"] [data-value="5"]') as HTMLElement;
		harness.drawerOnClick({ target: btn });
		expect((globalThis as any).Prefs.columns).toBe(5);
	});

	it('clicking a segmented string-value button writes the string', () => {
		const btn = document.querySelector('.ntt-segmented[data-pref="statType"] [data-value="visits"]') as HTMLElement;
		harness.drawerOnClick({ target: btn });
		expect((globalThis as any).Prefs.statType).toBe('visits');
	});

	it('clicking the recent toggle flips the boolean pref', () => {
		// recent starts true (Prefs.recent = true in beforeEach); the toggle now
		// lives in the Title Bar group as a plain on/off switch.
		const toggle = document.querySelector('.ntt-toggle[data-pref="recent"]') as HTMLElement;
		harness.drawerOnClick({ target: toggle });
		expect((globalThis as any).Prefs.recent).toBe(false);
	});

	it('clicking a toggle switch flips the boolean pref', () => {
		const toggle = document.querySelector('.ntt-toggle[data-pref="titleBarSearch"]') as HTMLElement;
		harness.drawerOnClick({ target: toggle });
		expect((globalThis as any).Prefs.titleBarSearch).toBe(true);
	});

	it('clicking the titleSize toggle flips between hidden and small', () => {
		(globalThis as any).Prefs.titleSize = 'small';
		const toggle = document.querySelector('.ntt-toggle[data-pref="titleSize"]') as HTMLElement;
		harness.drawerOnClick({ target: toggle });
		expect((globalThis as any).Prefs.titleSize).toBe('hidden');
		harness.drawerOnClick({ target: toggle });
		expect((globalThis as any).Prefs.titleSize).toBe('small');
	});

	it('ignores clicks that fall outside any bound control (no throw, no pref change)', () => {
		const before = JSON.stringify((globalThis as any).Prefs);
		expect(() => harness.drawerOnClick({ target: document.body })).not.toThrow();
		expect(JSON.stringify((globalThis as any).Prefs)).toBe(before);
	});

	// --- Regressions caught during Phase 3-1 review ---

	it('regression: clicking the toggle row label flips the pref (not just the button)', () => {
		// We started by only handling clicks where target == .ntt-toggle.
		// In practice users click the row label, so the handler must delegate
		// via `.closest(".ntt-toggle-row[data-pref]")`.
		const label = document.querySelector('.ntt-toggle-row[data-pref="recent"] .ntt-toggle-label') as HTMLElement;
		harness.drawerOnClick({ target: label });
		expect((globalThis as any).Prefs.recent).toBe(false);
	});

	it('regression: clicking the kbd hint inside a toggle row label still flips the pref', () => {
		// Deeper children must also bubble — `.ntt-toggle-kbd` is a
		// grandchild of `.ntt-toggle-row`.
		const kbd = document.querySelector('.ntt-toggle-row[data-pref="titleBarSearch"] .ntt-toggle-kbd') as HTMLElement;
		harness.drawerOnClick({ target: kbd });
		expect((globalThis as any).Prefs.titleBarSearch).toBe(true);
	});

	it('regression: statType="visits" requests history permission via the gesture-safe path', () => {
		// The original `_ensureHistoryPermission` called `permissions.contains`
		// first and `permissions.request` inside its callback, which broke
		// the user-gesture chain in Firefox. The handler must call our
		// `_ensureHistoryPermission` directly so we know the request happens
		// from the click.
		const spy = vi.fn();
		(harness as any)._ensureHistoryPermission = spy;
		const btn = document.querySelector('.ntt-segmented[data-pref="statType"] [data-value="visits"]') as HTMLElement;
		harness.drawerOnClick({ target: btn });
		expect(spy).toHaveBeenCalledTimes(1);
		(harness as any)._ensureHistoryPermission = () => {};
	});

	it('regression: statType="none" does NOT request history permission', () => {
		const spy = vi.fn();
		(harness as any)._ensureHistoryPermission = spy;
		const btn = document.querySelector('.ntt-segmented[data-pref="statType"] [data-value="none"]') as HTMLElement;
		harness.drawerOnClick({ target: btn });
		expect(spy).not.toHaveBeenCalled();
		(harness as any)._ensureHistoryPermission = () => {};
	});
});

describe('Drawer Layout tab — drawerOnChange (Phase 3-1)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const drawerOnChange = extractMethod(source, 'drawerOnChange');

		// `optionsOnChange` is stubbed (not extracted) — the harness only
		// needs to record whether the slider branch fell through to it.
		const code = `var _layoutChangeHarness = { ${drawerOnChange}, optionsOnChange(event) { this._optionsOnChangeCalled = true; } };`;
		vm.runInThisContext(code, { filename: 'drawer-layout-change-harness.js' });
		harness = (globalThis as any)._layoutChangeHarness;
	});

	beforeEach(() => {
		document.body.innerHTML = PANEL_HTML;
		(globalThis as any).Prefs = {
			columns: 3, rows: 3,
			spacing: 'small', margin: ['small', 'small', 'small', 'small'],
			tileRadius: 'medium',
		};
		harness._optionsOnChangeCalled = false;
	});

	it('slider index 0 maps spacing to "small"', () => {
		const slider = document.querySelector('input[type="range"][data-pref="spacing"]') as HTMLInputElement;
		slider.value = '0';
		harness.drawerOnChange({ target: slider });
		expect((globalThis as any).Prefs.spacing).toBe('small');
	});

	it('slider index 1 maps spacing to "medium"', () => {
		const slider = document.querySelector('input[type="range"][data-pref="spacing"]') as HTMLInputElement;
		slider.value = '1';
		harness.drawerOnChange({ target: slider });
		expect((globalThis as any).Prefs.spacing).toBe('medium');
	});

	it('slider index 2 maps spacing to "large"', () => {
		const slider = document.querySelector('input[type="range"][data-pref="spacing"]') as HTMLInputElement;
		slider.value = '2';
		harness.drawerOnChange({ target: slider });
		expect((globalThis as any).Prefs.spacing).toBe('large');
	});

	it('margin slider writes a 4-tuple of the same size', () => {
		const slider = document.querySelector('input[type="range"][data-pref="margin"]') as HTMLInputElement;
		slider.value = '2';
		harness.drawerOnChange({ target: slider });
		expect((globalThis as any).Prefs.margin).toEqual(['large', 'large', 'large', 'large']);
	});

	it('tileRadius slider writes the enum', () => {
		const slider = document.querySelector('input[type="range"][data-pref="tileRadius"]') as HTMLInputElement;
		slider.value = '0';
		harness.drawerOnChange({ target: slider });
		expect((globalThis as any).Prefs.tileRadius).toBe('small');
	});

	// --- Regressions caught during Phase 3-1 review ---

	it('regression: dispatches on `target.type === "range"`, not `tagName` — a range-type target with a non-INPUT tagName still writes the pref', () => {
		// `drawerOnChange` (newTab.js:1636) dispatches on `target.type ===
		// 'range'` — it never reads `tagName` at all (that was true even
		// before Stage H2; the old `Element.tagName` case-trap this test used
		// to guard against lived in the pin-URL autocomplete handler, not
		// here — see pin-url-autocomplete-click.test.ts). A plain object
		// stands in for the event target: `type: 'range'` but a `tagName`
		// that is deliberately NOT 'INPUT', so a tagName-based gate — if ever
		// reintroduced — would fail this test by falling through instead.
		const fakeTarget = {
			type: 'range', tagName: 'SPAN', value: '1',
			dataset: { pref: 'spacing' },
			closest: () => null,
		};
		harness.drawerOnChange({ target: fakeTarget });
		expect((globalThis as any).Prefs.spacing).toBe('medium');
		expect(harness._optionsOnChangeCalled).toBe(false);
	});

	it('regression: a non-range target with the same data-pref does NOT hit the slider branch (falls through to optionsOnChange)', () => {
		// Confirms the dispatch is genuinely conditional on `type === 'range'`
		// rather than on `dataset.pref` alone.
		const fakeTarget = {
			type: 'text', tagName: 'INPUT', value: '1',
			dataset: { pref: 'spacing' },
			closest: () => null,
		};
		harness.drawerOnChange({ target: fakeTarget });
		expect((globalThis as any).Prefs.spacing).toBe('small'); // unchanged from beforeEach default
		expect(harness._optionsOnChangeCalled).toBe(true);
	});

	it('regression: updates the slider px label synchronously (no storage round-trip)', () => {
		// Without realtime feedback the label stayed "stuck" at the initial
		// pref value because it only updated via the async storage →
		// updateUI cycle. The handler must update the label inline.
		const slider = document.querySelector('input[type="range"][data-pref="spacing"]') as HTMLInputElement;
		const label = document.querySelector('.ntt-slider-snap[data-pref="spacing"] .ntt-slider-value') as HTMLElement;
		slider.value = '2';
		harness.drawerOnChange({ target: slider });
		expect(label.textContent).toBe('28px');
		slider.value = '0';
		harness.drawerOnChange({ target: slider });
		expect(label.textContent).toBe('10px');
	});

	it('regression: tileRadius slider uses its own px scale (4/10/18), not the spacing scale', () => {
		const slider = document.querySelector('input[type="range"][data-pref="tileRadius"]') as HTMLInputElement;
		const label = document.querySelector('.ntt-slider-snap[data-pref="tileRadius"] .ntt-slider-value') as HTMLElement;
		slider.value = '0';
		harness.drawerOnChange({ target: slider });
		expect(label.textContent).toBe('4px');
		slider.value = '2';
		harness.drawerOnChange({ target: slider });
		expect(label.textContent).toBe('18px');
	});
});

describe('Drawer Layout tab — updateUI reflection (Phase 3-1)', () => {
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
		// Stand-in for the extracted updateUI body's bare `Grid` reads —
		// chrome-prep C3d dropped the `'Grid' in window` sniffs that made it
		// optional in this vm harness (C3a guard-removal fallout pattern).
		(globalThis as any).Grid = { sites: [] };
		// chrome-prep C4d (CHROME_PREP.md): `updateThemeColours`/
		// `refreshBackgroundImage`/`refreshRecent`/`fillNeverCaptureUI` moved to
		// theme.js/wallpaper.js/titlebar.js/filters-ui.js — `updateUI`'s extracted
		// body now calls them as bare identifiers, so they must be exposed on
		// the shared `globalThis` (the `isValidURL`/`el` pattern) rather than
		// declared as harness object-literal methods.
		(globalThis as any).updateThemeColours = vi.fn();
		(globalThis as any).refreshBackgroundImage = vi.fn();
		(globalThis as any).refreshRecent = vi.fn();
		(globalThis as any).fillNeverCaptureUI = vi.fn();

		const code = `var newTabTools = { ${updateUI}, ${syncSeg}, ${syncToggle}, ${syncSlider}, resizeOptionsThumbnail() {}, applyTileAspect() {}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} } };`;
		vm.runInThisContext(code, { filename: 'drawer-layout-updateUI-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		document.body.innerHTML = PANEL_HTML + `
			<input name="theme" type="radio" value="system" />
			<input name="opacity" type="range" />
			<input name="margin" />
			<select name="tileAspect"><option value="fill"></option></select>
			<input name="history" type="checkbox" />
			<input name="locked" type="checkbox" />
			<button id="historytiles-filter"></button>
			<div id="ntt-statusbar"></div>
			<div id="newtab-margin-top"></div>
			<div id="newtab-margin-bottom"></div>
			<div class="newtab-margin-left"></div>
			<div class="newtab-margin-right"></div>
			<div id="ntt-titlebar"></div>
		`;
		(globalThis as any).Prefs = {
			theme: 'light', locked: false,
			rows: 3, columns: 5, opacity: 80,
			margin: ['medium', 'medium', 'medium', 'medium'],
			spacing: 'large', titleSize: 'small', tileAspect: 'fill',
			tileRadius: 'small', tileActions: false,
			statType: 'visits', actionIconSize: 'large',
			history: true, recent: false,
			titleBarSearch: true,
		};
		document.documentElement.removeAttribute('drawer-open');
		document.documentElement.removeAttribute('locked');
	});

	it('sets aria-checked on the active segmented buttons (columns)', () => {
		harness.updateUI(['columns']);
		const active = document.querySelector('.ntt-segmented[data-pref="columns"] [data-value="5"]') as HTMLElement;
		expect(active.getAttribute('aria-checked')).toBe('true');
		const inactive = document.querySelector('.ntt-segmented[data-pref="columns"] [data-value="3"]') as HTMLElement;
		expect(inactive.getAttribute('aria-checked')).toBe('false');
	});

	it('sets the slider range index from spacing pref', () => {
		harness.updateUI(['spacing']);
		const slider = document.querySelector('input[type="range"][data-pref="spacing"]') as HTMLInputElement;
		expect(slider.value).toBe('2');
	});

	it('updates the slider label with the px value', () => {
		harness.updateUI(['spacing']);
		const label = document.querySelector('.ntt-slider-snap[data-pref="spacing"] .ntt-slider-value') as HTMLElement;
		expect(label.textContent).toContain('28');
	});

	it('reflects titleBarSearch toggle state via aria-checked', () => {
		harness.updateUI(['titleBarSearch']);
		expect((document.querySelector('.ntt-toggle[data-pref="titleBarSearch"]') as HTMLElement).getAttribute('aria-checked')).toBe('true');
	});

	it('reflects titleSize as toggle (small → on, hidden → off)', () => {
		(globalThis as any).Prefs.titleSize = 'hidden';
		harness.updateUI(['titleSize']);
		expect((document.querySelector('.ntt-toggle[data-pref="titleSize"]') as HTMLElement).getAttribute('aria-checked')).toBe('false');
		(globalThis as any).Prefs.titleSize = 'small';
		harness.updateUI(['titleSize']);
		expect((document.querySelector('.ntt-toggle[data-pref="titleSize"]') as HTMLElement).getAttribute('aria-checked')).toBe('true');
	});

	it('reflects recent boolean on the toggle switch', () => {
		(globalThis as any).Prefs.recent = true;
		harness.updateUI(['recent']);
		const toggle = document.querySelector('.ntt-toggle[data-pref="recent"]') as HTMLElement;
		expect(toggle.getAttribute('aria-checked')).toBe('true');
		(globalThis as any).Prefs.recent = false;
		harness.updateUI(['recent']);
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	it('reflects statType and actionIconSize on the segmented controls', () => {
		harness.updateUI(['statType', 'actionIconSize']);
		const statActive = document.querySelector('.ntt-segmented[data-pref="statType"] [data-value="visits"]') as HTMLElement;
		const sizeActive = document.querySelector('.ntt-segmented[data-pref="actionIconSize"] [data-value="large"]') as HTMLElement;
		expect(statActive.getAttribute('aria-checked')).toBe('true');
		expect(sizeActive.getAttribute('aria-checked')).toBe('true');
	});

	it('sets --ntt-action-btn-size + --ntt-action-icon-size for actionIconSize', () => {
		document.documentElement.style.setProperty = vi.fn();
		harness.updateUI(['actionIconSize']);
		const calls = (document.documentElement.style.setProperty as any).mock.calls;
		const props = calls.map((c: any[]) => c[0]);
		expect(props).toContain('--ntt-action-btn-size');
		expect(props).toContain('--ntt-action-icon-size');
	});

	it('sets --ntt-radius for tileRadius', () => {
		document.documentElement.style.setProperty = vi.fn();
		harness.updateUI(['tileRadius']);
		const calls = (document.documentElement.style.setProperty as any).mock.calls;
		const props = calls.map((c: any[]) => c[0]);
		expect(props).toContain('--ntt-radius');
	});
});
