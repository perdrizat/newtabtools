/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: tile-action "Edit" must open the drawer on the Tile
 * tab and select the clicked tile.
 *
 * Bug history: the edit action used to call
 * `newTabTools.setPinURLInputValue(this.url)` only — no drawer open. The
 * user had to manually open the drawer first or right-click the tile and
 * pick Edit from the context menu. Now the action button itself opens
 * the drawer, switches to the Tile tab, and sets `selectedSiteIndex`.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_PATH = path.resolve(__dirname, '../../webextension/site.js');

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

describe('Site._onClick — "edit" action opens the drawer on the Tile tab', () => {
	let body: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(SITE_PATH, 'utf8');
		body = extractMethod(source, '_onClick');
	});

	function invokeEdit(siteOverrides: Partial<any> = {}): {
		openDrawer: ReturnType<typeof vi.fn>;
		switchDrawerTab: ReturnType<typeof vi.fn>;
		selectedSiteIndex: number | null;
	} {
		const openDrawer = vi.fn();
		const switchDrawerTab = vi.fn();
		let selectedSiteIndex: number | null = null;
		(globalThis as any).newTabTools = {
			openDrawer,
			switchDrawerTab,
			set selectedSiteIndex(v: number) { selectedSiteIndex = v; },
		};

		const site: any = {
			cell: { index: 3 },
			url: 'https://example.com/',
			link: { url: 'https://example.com/' },
			...siteOverrides,
		};
		const code = `var _siteShell = { ${body} };`;
		vm.runInThisContext(code, { filename: 'site-edit-harness.js' });
		const shell = (globalThis as any)._siteShell;

		const target = document.createElement('div');
		target.classList.add('ntt-action-btn');
		target.setAttribute('data-action', 'edit');
		shell._onClick.call(site, { target, preventDefault() {} });

		return { openDrawer, switchDrawerTab, selectedSiteIndex };
	}

	it('opens the drawer', () => {
		const { openDrawer } = invokeEdit();
		expect(openDrawer).toHaveBeenCalledTimes(1);
	});

	it('switches to the Tile tab', () => {
		const { switchDrawerTab } = invokeEdit();
		expect(switchDrawerTab).toHaveBeenCalledWith('tile');
	});

	it('selects the clicked tile via its cell index', () => {
		const { selectedSiteIndex } = invokeEdit({ cell: { index: 5 } });
		expect(selectedSiteIndex).toBe(5);
	});

	it('handles a detached tile gracefully (no `cell` — drawer still opens, no selection)', () => {
		const { openDrawer, switchDrawerTab, selectedSiteIndex } = invokeEdit({ cell: null });
		expect(openDrawer).toHaveBeenCalled();
		expect(switchDrawerTab).toHaveBeenCalledWith('tile');
		expect(selectedSiteIndex).toBeNull();
	});
});
