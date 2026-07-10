/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: the "Recently closed" control is a plain on/off toggle in
 * the Page tab's Title Bar group, sitting as the FIRST item (above Search) —
 * not the old Off/Top segmented control in the Advanced tab.
 *
 *   - markup: a `.ntt-toggle-row[data-pref="recent"]` (role="switch") lives in
 *     the Title Bar group, before the `titleBarSearch` row; the Advanced tab no
 *     longer carries a `[data-pref="recent"]` segmented radiogroup.
 *   - behaviour: updateUI(['recent']) reflects Prefs.recent onto the toggle via
 *     aria-checked (the generic toggle path, like titleBarSearch), not a
 *     segmented sync.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { readNewTabHtml } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?(?:get\\s+)?${methodName}[\\(\\s]`, 'm');
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

describe('Recently-closed toggle — placement in the Page tab Title Bar group', () => {
	let html: string;

	beforeAll(() => {
		html = readNewTabHtml();
	});

	it('the recent control is a role="switch" toggle (not a segmented radio)', () => {
		expect(html).toMatch(/role="switch"[^>]*data-pref="recent"/);
		expect(html).toMatch(/class="ntt-toggle-row" data-pref="recent"/);
	});

	it('the recent toggle sits inside the Title Bar group', () => {
		const groupIdx = html.indexOf('data-group="titlebar"');
		const bgIdx = html.indexOf('id="options-bg-group"'); // next group after titlebar
		const recentIdx = html.indexOf('class="ntt-toggle-row" data-pref="recent"');
		expect(groupIdx).toBeGreaterThan(-1);
		expect(recentIdx).toBeGreaterThan(groupIdx);
		expect(recentIdx).toBeLessThan(bgIdx);
	});

	it('recent is the first titlebar toggle, above the search toggle', () => {
		const recentIdx = html.indexOf('data-pref="recent"');
		const searchIdx = html.indexOf('data-pref="titleBarSearch"');
		expect(recentIdx).toBeGreaterThan(-1);
		expect(searchIdx).toBeGreaterThan(-1);
		expect(recentIdx).toBeLessThan(searchIdx);
	});

	it('the recent control is NOT a segmented Off/Top radiogroup anymore', () => {
		expect(html).not.toMatch(/role="radiogroup" data-pref="recent"/);
		expect(html).not.toMatch(/data-message="options_recent_top"/);
	});
});

describe('updateUI — recent reflected onto the toggle (not a segmented control)', () => {
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
		vm.runInThisContext(code, { filename: 'recent-toggle-updateUI-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		document.body.innerHTML = `
			<button type="button" role="switch" class="ntt-toggle" data-pref="recent" aria-checked="false"></button>
		`;
		(globalThis as any).Prefs = {
			theme: 'system', locked: false,
			rows: 3, columns: 3, opacity: 80,
			margin: ['small', 'small', 'small', 'small'],
			spacing: 'small', titleSize: 'small', tileAspect: 'fill',
			tileRadius: 'medium', tileActions: true,
			statType: 'none', actionIconSize: 'medium',
			history: true, recent: true,
			titleBarSearch: false, titleBarStatus: true,
		};
	});

	it('aria-checked="true" when recent is on', () => {
		harness.updateUI(['recent']);
		const toggle = document.querySelector('.ntt-toggle[data-pref="recent"]') as HTMLElement;
		expect(toggle.getAttribute('aria-checked')).toBe('true');
	});

	it('aria-checked="false" when recent is off', () => {
		(globalThis as any).Prefs.recent = false;
		harness.updateUI(['recent']);
		const toggle = document.querySelector('.ntt-toggle[data-pref="recent"]') as HTMLElement;
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});
});
