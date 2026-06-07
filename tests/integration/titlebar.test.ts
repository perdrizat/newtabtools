/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: titlebar layout wrapper.
 *
 * The redesigned titlebar measures the greedy recently-closed card container
 * (`#ntt-titlebar-recent`, `flex: 1 1 0`) — the browser sizes it to exactly the
 * room left after the fixed search box and the content-width masthead — and
 * shrinks the cards to fill it edge-to-edge. The DOM-measuring wrapper
 * `_layoutTitlebar` reads that container's `clientWidth`, asks the pure
 * `computeTitlebarSlots` helper how many cards fit (math covered in
 * titlebar-slots.test.ts), sets `--ntt-slot-w`, and stashes the cap on
 * `this._recentCardCount`.
 *
 * jsdom has no layout engine, so the container width is injected directly here;
 * the real reflow-on-resize / drawer-open-close / search-toggle behaviour can
 * only be proven in a real browser and is covered by the E2E tier
 * (`tests/e2e/titlebar-reflow.test.ts`).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

describe('_layoutTitlebar — measures the card container and sets the slot width', () => {
	let harness: any;
	let setProps: Record<string, string>;
	let recent: { clientWidth: number; hidden: boolean };
	let realGetComputedStyle: typeof window.getComputedStyle;
	let realGetById: typeof document.getElementById;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const computeTitlebarSlots = extractMethod(source, 'computeTitlebarSlots');
		const _layoutTitlebar = extractMethod(source, '_layoutTitlebar');
		const code = `var _tbHarness = { ${computeTitlebarSlots}, ${_layoutTitlebar} };`;
		vm.runInThisContext(code, { filename: 'layout-titlebar-harness.js' });
		harness = (globalThis as any)._tbHarness;
	});

	beforeEach(() => {
		setProps = {};
		realGetComputedStyle = window.getComputedStyle;
		realGetById = document.getElementById;
		(globalThis as any).Prefs = { recent: true, titleBarSearch: true };

		const titlebar = {
			style: { setProperty: (k: string, v: string) => { setProps[k] = v; } },
		};
		// The greedy card container reports the width the browser left it after
		// the fixed search box + masthead. jsdom can't compute flex layout, so
		// the width is injected directly; 730px is a typically-wide row.
		recent = { clientWidth: 730, hidden: true };
		document.getElementById = vi.fn((id: string) => {
			if (id === 'ntt-titlebar') { return titlebar; }
			if (id === 'ntt-titlebar-recent') { return recent; }
			return null;
		}) as any;
		(window as any).getComputedStyle = vi.fn(() => ({
			gap: '10px', columnGap: '10px',
		}));
	});

	afterEach(() => {
		window.getComputedStyle = realGetComputedStyle;
		document.getElementById = realGetById;
		delete (globalThis as any).Prefs;
	});

	it('sets --ntt-slot-w (px) on the titlebar', () => {
		harness._layoutTitlebar();
		expect(setProps['--ntt-slot-w']).toMatch(/^\d+px$/);
	});

	it('no longer sets the retired --ntt-search-w variable (search is fixed-width)', () => {
		harness._layoutTitlebar();
		expect(setProps['--ntt-search-w']).toBeUndefined();
	});

	it('un-hides the container so it can be measured and pin the masthead right', () => {
		recent.hidden = true;
		harness._layoutTitlebar();
		expect(recent.hidden).toBe(false);
	});

	it('fits a positive card count into a wide container (730px)', () => {
		// computeTitlebarSlots(730, 10): ceil(740/196) = 4 cards, shrunk to fill.
		const slots = harness._layoutTitlebar();
		expect(slots.cardCount).toBe(4);
		expect(harness._recentCardCount).toBe(4);
		expect(slots.slotWidth).toBeLessThanOrEqual(186);
	});

	it('fits fewer cards into a narrower container (360px)', () => {
		recent.clientWidth = 360;
		const slots = harness._layoutTitlebar();
		expect(slots.cardCount).toBeLessThan(4);
		expect(slots.cardCount).toBeGreaterThanOrEqual(1);
	});

	it('forces 0 cards when the recent pref is off (empty spacer remains)', () => {
		(globalThis as any).Prefs = { recent: false };
		const slots = harness._layoutTitlebar();
		expect(slots.cardCount).toBe(0);
		expect(harness._recentCardCount).toBe(0);
	});

	it('degrades to 0 cards when the titlebar / container is absent', () => {
		document.getElementById = vi.fn(() => null) as any;
		const slots = harness._layoutTitlebar();
		expect(slots.cardCount).toBe(0);
	});
});

describe('Titlebar — Board A chrome (newTab.xhtml)', () => {
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: titlebar structure
		xhtml = fs.readFileSync(path.resolve(__dirname, '../../webextension/newTab.xhtml'), 'utf8');
	});

	it('drops the wordmark, masthead, and lock/cogwheel button cluster (§1)', () => {
		expect(xhtml).not.toContain('ntt-wordmark');
		expect(xhtml).not.toContain('ntt-masthead');
		expect(xhtml).not.toContain('ntt-titlebar-buttons');
		expect(xhtml).not.toContain('locked-toggle');
	});

	it('keeps a single titlebar action button (#options-toggle) labelled Edit', () => {
		expect(xhtml).toMatch(/<button id="options-toggle"[^>]*data-message="options_edit"/);
	});

	it('has no clock or divider element in the redesigned titlebar', () => {
		expect(xhtml).not.toContain('ntt-clock');
		expect(xhtml).not.toContain('ntt-titlebar-divider');
	});
});
