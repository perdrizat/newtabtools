/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: statusbar — _updateStatusBar + titleBarStatus pref
 * (Phase 2-2).
 *
 * Extracts `_updateStatusBar` and the `titleBarStatus` branch of `updateUI`
 * from newTab.js via `vm.runInThisContext`. Exercises tile counting against
 * a fake Grid.sites array and verifies the right-aligned summary text.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

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

// NB: the bottom status bar was retired — Phase 4-0 hid it, Phase 5-1 deleted
// it — so `_updateStatusBar`/`_initStatusBar`, the `titleBarStatus` pref, and
// the updateUI show/hide + count branches are all gone (removal pinned by
// statusbar-removed.test.ts). The only status-bar-era logic left is the
// spacing → `--ntt-gap` mapping in updateUI, covered below.

describe('Statusbar — gapMap defaults (Phase 2-2 §2.2)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateUI = extractMethod(source, 'updateUI');

		(globalThis as any).Prefs = {
			theme: 'light', locked: false,
			rows: 3, columns: 3, opacity: 80,
			margin: ['small', 'small', 'small', 'small'],
			spacing: 'small', titleSize: 'small', tileAspect: 'fill',
			history: true, recent: true,
		};
		(globalThis as any).browser = {
			theme: {
				getCurrent: vi.fn().mockResolvedValue({ colors: {} }),
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			extension: { getURL: vi.fn((p: string) => `moz-extension://fake/${p}`) },
		};

		const syncSeg = extractMethod(source, '_syncDrawerSegmented');
		const syncToggle = extractMethod(source, '_syncDrawerToggle');
		const syncSlider = extractMethod(source, '_syncDrawerSlider');
		const code = `var newTabTools = { ${updateUI}, ${syncSeg}, ${syncToggle}, ${syncSlider}, updateThemeColours() {}, resizeOptionsThumbnail() {}, refreshRecent() {}, applyTileAspect() {}, _updateThemeToggleIcon() {}, _updateStatusBar() {}, darkIcons: { disabled: false }, lockedToggleButton: { style: {} } };`;
		vm.runInThisContext(code, { filename: 'statusbar-gapmap-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		document.querySelector = vi.fn((sel: string) => {
			if (typeof sel === 'string' && (sel.startsWith('.ntt-segmented') || sel.startsWith('.ntt-toggle') || sel.startsWith('.ntt-slider'))) {
				return null;
			}
			return { value: '', style: {}, classList: { remove: vi.fn(), add: vi.fn() } };
		}) as any;
		document.querySelectorAll = vi.fn(() => []) as any;
		document.getElementById = vi.fn(() => ({ disabled: false, hidden: false })) as any;
		document.documentElement.setAttribute = vi.fn();
		document.documentElement.removeAttribute = vi.fn();
		document.documentElement.style.setProperty = vi.fn();
		document.documentElement.style.getPropertyValue = vi.fn(() => '');
		document.documentElement.hasAttribute = vi.fn(() => true);
	});

	it('spacing=medium sets --ntt-gap to 18px (matches token default)', () => {
		(globalThis as any).Prefs.spacing = 'medium';
		harness.updateUI(['spacing']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--ntt-gap', '18px');
	});

	it('spacing=small sets --ntt-gap to 10px', () => {
		(globalThis as any).Prefs.spacing = 'small';
		harness.updateUI(['spacing']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--ntt-gap', '10px');
	});

	it('spacing=large sets --ntt-gap to 28px', () => {
		(globalThis as any).Prefs.spacing = 'large';
		harness.updateUI(['spacing']);
		expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--ntt-gap', '28px');
	});
});
