/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: Tile tab empty state + tile selection (Phase 3-2).
 *
 * The Tile tab is enabled regardless of selection, but the body switches
 * between an "empty state" placeholder and the edit controls based on
 * `selectedSite`. The selected tile gets `[data-selected="true"]` so the
 * copper-ring CSS can highlight it.
 *
 * Covers:
 *   - `set selectedSiteIndex(null)` shows the empty state and hides the edit
 *     controls
 *   - `set selectedSiteIndex(N)` hides the empty state and shows controls
 *   - the selected site's node receives `[data-selected="true"]`; any
 *     previously-selected site has it removed
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractAccessor(source: string, methodName: string): string {
	// Match `\tget name` or `\tset name`.
	const sigPattern = new RegExp(`^\\t(?:get|set)\\s+${methodName}[\\(\\s]`, 'gm');
	const result: string[] = [];
	let m;
	while ((m = sigPattern.exec(source)) != null) {
		let depth = 0;
		const start = m.index;
		let i = source.indexOf('{', start);
		for (; i < source.length; i++) {
			if (source[i] === '{') { depth++; }
			else if (source[i] === '}') { depth--; if (depth === 0) { result.push(source.substring(start, i + 1)); break; } }
		}
	}
	if (!result.length) { throw new Error(`get/set ${methodName} not found`); }
	return result.join(',');
}

function makeStub(): HTMLElement {
	return document.createElement('div');
}

function harnessShell() {
	const t: any = {};
	for (const id of [
		'setSavedThumbInput', 'setTitleInput', 'setTitleButton',
		'siteThumbnail', 'siteURL', 'editSiteURLRow', 'siteURLInput',
		'setURLButton', 'saveCurrentThumbButton', 'removeSavedThumbButton',
		'setBgColourInput', 'setBgColourButton', 'resetBgColourButton',
		'editSiteTitleRow',
	]) {
		const el = makeStub();
		Object.assign(el, { disabled: false, value: '', hidden: false, classList: { add: () => {}, remove: () => {} } });
		t[id] = el;
	}
	// Some setter paths touch nested chain — setBgColourDisplay.parentNode.
	// setBgColourDisplay.parentNode.disabled is touched by the existing
	// setter — keep this as a plain object so we can attach `parentNode`.
	t.setBgColourDisplay = { style: { backgroundColor: null }, parentNode: { disabled: false } };
	t.getString = () => '';
	return t;
}

describe('Tile tab empty state + selection (Phase 3-2)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const accessor = extractAccessor(source, 'selectedSiteIndex');

		// Object-URL hygiene (audit §4.3): the selectedSiteIndex setter routes
		// thumbnail URLs through object-urls.js's `_freshObjectURL`/
		// `_dropObjectURL` now (chrome-prep C4d) — called as bare identifiers
		// (real module-level function references), so exposed on the shared
		// `globalThis` (the `isValidURL`/`el` pattern) rather than as harness
		// `this.X` stubs. Revocation itself is covered behaviorally in
		// objecturl-revoke.test.ts; plain stubs suffice here.
		(globalThis as any)._freshObjectURL = () => 'blob:stub';
		(globalThis as any)._dropObjectURL = () => {};

		// Build the harness inside the VM so accessor descriptors are
		// preserved (Object.assign would collapse `get`/`set` to data
		// properties).
		const skeleton = harnessShell();
		(globalThis as any)._tileShell = skeleton;
		const code = `var _tileHarness = { __proto__: globalThis._tileShell, get selectedSite() { return Grid.sites[this._selectedSiteIndex]; }, ${accessor} }; for (let k of Object.keys(globalThis._tileShell)) { _tileHarness[k] = globalThis._tileShell[k]; }`;
		vm.runInThisContext(code, { filename: 'tile-harness.js' });
		harness = (globalThis as any)._tileHarness;
	});

	beforeEach(() => {
		document.body.innerHTML = `
			<section data-drawer-panel="tile">
				<div class="ntt-empty-state" data-tile-empty="">Click a tile to edit</div>
				<div id="options-tile">
					<div id="options-thumbnail-wrap"></div>
				</div>
			</section>
			<div id="newtab-grid">
				<div class="newtab-site" data-tile-index="0"></div>
				<div class="newtab-site" data-tile-index="1"></div>
				<div class="newtab-site" data-tile-index="2"></div>
			</div>
		`;
		const nodes = Array.from(document.querySelectorAll('.newtab-site')) as HTMLElement[];
		(globalThis as any).Grid = {
			sites: nodes.map((node, i) => ({
				node,
				link: { url: `https://example.com/${i}`, title: `Site ${i}` },
				thumbnail: { style: {} },
			})),
		};
		(globalThis as any).Prefs = { rows: 3, columns: 3 };
	});

	it('selectedSiteIndex = null hides the edit area and shows the empty state', () => {
		harness.selectedSiteIndex = null;
		const empty = document.querySelector('[data-tile-empty]') as HTMLElement;
		const editArea = document.getElementById('options-tile') as HTMLElement;
		expect(empty.hidden).toBe(false);
		expect(editArea.hidden).toBe(true);
	});

	it('selectedSiteIndex = N shows the edit area and hides the empty state', () => {
		harness.selectedSiteIndex = 1;
		const empty = document.querySelector('[data-tile-empty]') as HTMLElement;
		const editArea = document.getElementById('options-tile') as HTMLElement;
		expect(empty.hidden).toBe(true);
		expect(editArea.hidden).toBe(false);
	});

	it('selecting a tile sets [data-selected="true"] on its node only', () => {
		harness.selectedSiteIndex = 1;
		const nodes = Array.from(document.querySelectorAll('.newtab-site')) as HTMLElement[];
		expect(nodes[0].getAttribute('data-selected')).toBe(null);
		expect(nodes[1].getAttribute('data-selected')).toBe('true');
		expect(nodes[2].getAttribute('data-selected')).toBe(null);
	});

	it('selecting a different tile moves the [data-selected] attribute', () => {
		harness.selectedSiteIndex = 1;
		harness.selectedSiteIndex = 2;
		const nodes = Array.from(document.querySelectorAll('.newtab-site')) as HTMLElement[];
		expect(nodes[1].getAttribute('data-selected')).toBe(null);
		expect(nodes[2].getAttribute('data-selected')).toBe('true');
	});

	it('selectedSiteIndex = null clears the [data-selected] attribute', () => {
		harness.selectedSiteIndex = 1;
		harness.selectedSiteIndex = null;
		const nodes = Array.from(document.querySelectorAll('.newtab-site')) as HTMLElement[];
		expect(nodes.every(n => n.getAttribute('data-selected') === null)).toBe(true);
	});
});
