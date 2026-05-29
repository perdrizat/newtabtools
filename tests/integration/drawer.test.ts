/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: config drawer (Phase 3-1).
 *
 * Extracts `openDrawer`, `closeDrawer`, `toggleDrawer`, and
 * `switchDrawerTab` from newTab.js via `vm.runInThisContext` and exercises
 * their effects on a mock document with `#ntt-drawer` and tab markup.
 *
 * Covers:
 *   - openDrawer: sets `drawer-open` attribute on `<html>`, drops
 *     `aria-hidden`, focuses the drawer
 *   - closeDrawer: removes `drawer-open`, re-applies `aria-hidden="true"`
 *   - toggleDrawer: flips between open and closed
 *   - switchDrawerTab(name): sets `data-active` on tab button, sets
 *     `hidden` on inactive panels, leaves the named panel visible
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

describe('Drawer — open / close / toggle (Phase 3-1)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const openDrawer = extractMethod(source, 'openDrawer');
		const closeDrawer = extractMethod(source, 'closeDrawer');
		const toggleDrawer = extractMethod(source, 'toggleDrawer');
		const switchDrawerTab = extractMethod(source, 'switchDrawerTab');
		const autoSelectFirstTile = extractMethod(source, '_autoSelectFirstTileIfNeeded');

		const code = `var _drawerHarness = { ${openDrawer}, ${closeDrawer}, ${toggleDrawer}, ${switchDrawerTab}, ${autoSelectFirstTile}, _refreshGridPositionsAfterDrawerTransition() {}, get selectedSiteIndex() { return this._selectedSiteIndex; }, set selectedSiteIndex(i) { this._selectedSiteIndex = i; } };`;
		vm.runInThisContext(code, { filename: 'drawer-harness.js' });
		harness = (globalThis as any)._drawerHarness;
	});

	beforeEach(() => {
		document.documentElement.removeAttribute('drawer-open');
		document.documentElement.removeAttribute('drawer-tab');
		document.body.innerHTML = `
			<aside id="ntt-drawer" aria-hidden="true" tabindex="-1">
				<div id="ntt-drawer-tabs" role="tablist">
					<button type="button" role="tab" data-drawer-tab="tile" data-active="false">Tile</button>
					<button type="button" role="tab" data-drawer-tab="page" data-active="true">Page</button>
					<button type="button" role="tab" data-drawer-tab="advanced" data-active="false">Advanced</button>
				</div>
				<div id="ntt-drawer-body">
					<section data-drawer-panel="tile" hidden=""></section>
					<section data-drawer-panel="page"></section>
					<section data-drawer-panel="advanced" hidden=""></section>
				</div>
				<button id="ntt-drawer-close" type="button"></button>
			</aside>
		`;
	});

	describe('openDrawer', () => {
		it('sets [drawer-open] on <html>', () => {
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(false);
			harness.openDrawer();
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(true);
		});

		it('clears aria-hidden on the drawer element', () => {
			expect(document.getElementById('ntt-drawer')!.getAttribute('aria-hidden')).toBe('true');
			harness.openDrawer();
			expect(document.getElementById('ntt-drawer')!.getAttribute('aria-hidden')).toBe('false');
		});

		it('focuses the drawer element so Esc reaches the key handler', () => {
			const drawer = document.getElementById('ntt-drawer')!;
			drawer.focus = vi.fn();
			harness.openDrawer();
			expect(drawer.focus).toHaveBeenCalled();
		});

		it('is idempotent — second call leaves drawer open', () => {
			harness.openDrawer();
			harness.openDrawer();
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(true);
		});
	});

	describe('closeDrawer', () => {
		it('removes [drawer-open] from <html>', () => {
			document.documentElement.setAttribute('drawer-open', '');
			harness.closeDrawer();
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(false);
		});

		it('re-applies aria-hidden="true" on the drawer', () => {
			document.getElementById('ntt-drawer')!.setAttribute('aria-hidden', 'false');
			harness.closeDrawer();
			expect(document.getElementById('ntt-drawer')!.getAttribute('aria-hidden')).toBe('true');
		});

		it('is idempotent — second call leaves drawer closed', () => {
			harness.closeDrawer();
			harness.closeDrawer();
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(false);
		});
	});

	describe('toggleDrawer', () => {
		it('opens a closed drawer', () => {
			harness.toggleDrawer();
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(true);
		});

		it('closes an open drawer', () => {
			harness.openDrawer();
			harness.toggleDrawer();
			expect(document.documentElement.hasAttribute('drawer-open')).toBe(false);
		});
	});

	describe('switchDrawerTab', () => {
		it('sets data-active="true" on the named tab button and false on others', () => {
			harness.switchDrawerTab('page');
			const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]');
			for (const t of tabs) {
				const active = t.getAttribute('data-active');
				const expected = t.getAttribute('data-drawer-tab') === 'page' ? 'true' : 'false';
				expect(active).toBe(expected);
			}
		});

		it('hides all panels except the named one', () => {
			harness.switchDrawerTab('advanced');
			const panels = document.querySelectorAll<HTMLElement>('[data-drawer-panel]');
			for (const panel of panels) {
				const expectedHidden = panel.getAttribute('data-drawer-panel') !== 'advanced';
				expect(panel.hidden).toBe(expectedHidden);
			}
		});

		it('mirrors the active tab onto <html> via [drawer-tab]', () => {
			harness.switchDrawerTab('tile');
			expect(document.documentElement.getAttribute('drawer-tab')).toBe('tile');
		});

		it('ignores unknown tab names (no-op when name is not in DOM)', () => {
			harness.switchDrawerTab('page');
			const before = document.documentElement.getAttribute('drawer-tab');
			harness.switchDrawerTab('nope');
			expect(document.documentElement.getAttribute('drawer-tab')).toBe(before);
		});
	});
});
