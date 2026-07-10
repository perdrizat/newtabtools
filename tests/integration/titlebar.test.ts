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
import { readNewTabHtml } from './_helpers';
// titlebar.js imports `Grid` from grid.js, which in turn imports newTab.js
// (the pre-existing newTab.js<->grid.js<->site.js cycle) — whose own top
// level runs a boot IIFE that touches real newTab.html DOM ids. Mocking
// grid.js wholesale (recent-tabs.test.ts's precedent) severs that edge so
// importing titlebar.js here doesn't transitively evaluate newTab.js at
// all; `_layoutTitlebar` itself never reads `Grid`, so the mock's shape is
// irrelevant.
vi.mock('../../webextension/grid.js', () => ({ Grid: { sites: [] } }));
// chrome-prep C4d (CHROME_PREP.md): `_layoutTitlebar`/`computeTitlebarSlots`
// are real titlebar.js exports now (moved verbatim out of newTab.js) —
// imported directly instead of vm-extracted from newTab.js source (C4a/b/c
// "import from the new specifier" precedent).
import { _layoutTitlebar } from '../../webextension/titlebar.js';
// `_layoutTitlebar` reads the REAL `Prefs` singleton (prefs.js) now — a
// `(globalThis as any).Prefs = {...}` stand-in no longer reaches it (same
// "second-order fallout" class _helpers.ts's `ensureSiteEnv` documents).
// Before `Prefs.init()` runs (deliberately not called here — booting in
// jsdom is out of scope), `recent`/etc. are plain, getter-less own-data
// properties, so a direct assignment is read back synchronously with no
// storage round-trip (`ensureSiteEnv`'s `Prefs.statType = 'none'` precedent).
import { Prefs } from '../../webextension/prefs.js';

describe('_layoutTitlebar — measures the card container and sets the slot width', () => {
	let setProps: Record<string, string>;
	let recent: { clientWidth: number; hidden: boolean };
	let realGetComputedStyle: typeof window.getComputedStyle;
	let realGetById: typeof document.getElementById;

	beforeEach(() => {
		setProps = {};
		realGetComputedStyle = window.getComputedStyle;
		realGetById = document.getElementById;
		Prefs.recent = true;
		Prefs.titleBarSearch = true;

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
	});

	it('sets --ntt-slot-w (px) on the titlebar', () => {
		_layoutTitlebar();
		expect(setProps['--ntt-slot-w']).toMatch(/^\d+px$/);
	});

	it('no longer sets the retired --ntt-search-w variable (search is fixed-width)', () => {
		_layoutTitlebar();
		expect(setProps['--ntt-search-w']).toBeUndefined();
	});

	it('un-hides the container so it can be measured and pin the masthead right', () => {
		recent.hidden = true;
		_layoutTitlebar();
		expect(recent.hidden).toBe(false);
	});

	it('fits a positive card count into a wide container (730px)', () => {
		// computeTitlebarSlots(730, 10): ceil(740/196) = 4 cards, shrunk to fill.
		const slots = _layoutTitlebar();
		expect(slots.cardCount).toBe(4);
		expect(slots.slotWidth).toBeLessThanOrEqual(186);
	});

	it('fits fewer cards into a narrower container (360px)', () => {
		recent.clientWidth = 360;
		const slots = _layoutTitlebar();
		expect(slots.cardCount).toBeLessThan(4);
		expect(slots.cardCount).toBeGreaterThanOrEqual(1);
	});

	it('forces 0 cards when the recent pref is off (empty spacer remains)', () => {
		Prefs.recent = false;
		const slots = _layoutTitlebar();
		expect(slots.cardCount).toBe(0);
	});

	it('degrades to 0 cards when the titlebar / container is absent', () => {
		document.getElementById = vi.fn(() => null) as any;
		const slots = _layoutTitlebar();
		expect(slots.cardCount).toBe(0);
	});
});

describe('Titlebar — Board A chrome (newTab.html)', () => {
	let html: string;

	beforeAll(() => {
		html = readNewTabHtml();
	});

	it('drops the wordmark, masthead, and lock/cogwheel button cluster (§1)', () => {
		expect(html).not.toContain('ntt-wordmark');
		expect(html).not.toContain('ntt-masthead');
		expect(html).not.toContain('ntt-titlebar-buttons');
		expect(html).not.toContain('locked-toggle');
	});

	it('keeps a single titlebar action button (#options-toggle) labelled Edit', () => {
		expect(html).toMatch(/<button id="options-toggle"[^>]*data-message="options_edit"/);
	});

	it('has no clock or divider element in the redesigned titlebar', () => {
		expect(html).not.toContain('ntt-clock');
		expect(html).not.toContain('ntt-titlebar-divider');
	});
});
