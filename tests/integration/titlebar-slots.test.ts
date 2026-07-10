/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: computeTitlebarSlots — pure slot-sizing helper.
 *
 * The recently-closed cards live in a greedy flex container the browser sizes
 * to the room left after the fixed search box and the masthead. Given that
 * measured width (`cardSpace`) and the inter-card gap, the helper returns how
 * many cards fit and their common width: the SMALLEST count whose cards, when
 * stretched to fill the container edge-to-edge (gaps included), stay at or
 * below the default width (186px).
 *
 * Signature: computeTitlebarSlots(cardSpace, gap, full=186)
 *            → { cardCount, slotWidth }.
 *
 *   cardCount = ceil((cardSpace + gap) / (full + gap))
 *   slotWidth = min(full, floor((cardSpace − (cardCount−1)·gap) / cardCount))
 *
 * The DOM-measuring wrapper is covered in titlebar.test.ts; the live reflow on
 * resize / drawer open-close / search toggle in the E2E tier (titlebar-reflow).
 */

import { describe, it, expect, vi } from 'vitest';
// titlebar.js imports `Grid` from grid.js, which in turn imports newTab.js
// (the pre-existing newTab.js<->grid.js<->site.js cycle) — whose own top
// level runs a boot IIFE that touches real newTab.html DOM ids. Mocking
// grid.js wholesale (recent-tabs.test.ts's precedent) severs that edge so
// importing titlebar.js here doesn't transitively evaluate newTab.js at all;
// `computeTitlebarSlots` itself never reads `Grid`, so the mock's shape is
// irrelevant.
vi.mock('../../webextension/grid.js', () => ({ Grid: { sites: [] } }));
// chrome-prep C4d (CHROME_PREP.md): `computeTitlebarSlots` is a real
// titlebar.js export now (moved verbatim out of newTab.js) — imported
// directly instead of vm-extracted from newTab.js source (C4a/b/c
// "import from the new specifier" precedent).
import { computeTitlebarSlots as compute } from '../../webextension/titlebar.js';

describe('computeTitlebarSlots — shrink-to-fill card sizing', () => {
	it('returns 0 cards for an empty / non-positive container', () => {
		expect(compute(0, 10).cardCount).toBe(0);
		expect(compute(-50, 10).cardCount).toBe(0);
	});

	it('never grows a card above the default width (186px)', () => {
		for (const w of [187, 200, 400, 600, 800, 1200, 2000]) {
			expect(compute(w, 10).slotWidth).toBeLessThanOrEqual(186);
		}
	});

	it('fills the container edge-to-edge (leftover under one card)', () => {
		for (const w of [187, 250, 400, 593, 730, 1000, 1503]) {
			const { cardCount, slotWidth } = compute(w, 10);
			const used = cardCount * slotWidth + (cardCount - 1) * 10;
			expect(used).toBeLessThanOrEqual(w);
			// floor rounding leaves at most (cardCount − 1) px of slack.
			expect(w - used).toBeLessThan(cardCount);
		}
	});

	it('picks the smallest count whose fill width stays <= full', () => {
		// 730px, gap 10: 3 cards would each need ~250px (>186) to fill, so it
		// must pick 4 cards at <=186 each.
		const { cardCount, slotWidth } = compute(730, 10);
		expect(cardCount).toBe(4);
		expect(slotWidth).toBeLessThanOrEqual(186);
		expect(slotWidth).toBeGreaterThan(0);
	});

	it('includes the gap in the fit (two full cards + one gap = 382)', () => {
		expect(compute(382, 10).cardCount).toBe(2);
		expect(compute(382, 10).slotWidth).toBe(186);
	});

	it('returns a single shrunk card when only part of one fits', () => {
		const { cardCount, slotWidth } = compute(120, 10);
		expect(cardCount).toBe(1);
		expect(slotWidth).toBe(120);
	});

	it('is monotonic: more width yields at least as many cards', () => {
		let prev = 0;
		for (const w of [100, 200, 300, 400, 500, 600, 700, 800]) {
			const n = compute(w, 10).cardCount;
			expect(n).toBeGreaterThanOrEqual(prev);
			prev = n;
		}
	});

	it('a larger gap never increases the card count', () => {
		const tight = compute(1000, 10).cardCount;
		const gappy = compute(1000, 40).cardCount;
		expect(gappy).toBeLessThanOrEqual(tight);
	});

	it('defaults full to 186 when omitted', () => {
		expect(compute(1000, 10)).toEqual(compute(1000, 10, 186));
	});
});
