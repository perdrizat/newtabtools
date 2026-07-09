/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression tests for titlebar layout invariants. The inline-recent redesign
 * lays the titlebar out left→right as: [recent cards] [search] [masthead].
 *
 *   1. the recent cards live in #ntt-titlebar-recent, a greedy `flex: 1 1 0`
 *      container that absorbs all slack and pins the masthead to the right.
 *   2. the search box is a fixed-width box (decoupled from the card slot so the
 *      card-count measurement can't feed back into itself).
 *   3. the masthead (#ntt-masthead) is a content-width box holding the wordmark
 *      plus the lock + cogwheel buttons.
 *   4. slots are separated by the tile gap (`gap: var(--ntt-gap)`).
 *   5. the titlebar carries no bottom border (margin-bottom only).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('Titlebar layout invariants — CSS rules', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: titlebar alignment rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	// Anchor to start-of-line so we match the standalone rule, not the
	// dark-mode `:root[theme="dark"] #ntt-…` override that shares the selector.
	it('the single Edit action button is content-width at the right (Board A §1)', () => {
		// Board A drops the masthead/wordmark; the one titlebar action is the
		// Edit button (#options-toggle), which hugs its content (flex 0 0 auto).
		const edit = css.match(/^#options-toggle\s*\{[^}]*\}/m);
		expect(edit).not.toBeNull();
		expect(edit![0]).toMatch(/flex:\s*0\s+0\s+auto/);
	});

	it('search is a fixed-width box, decoupled from the card slot to avoid measurement feedback', () => {
		const search = css.match(/#ntt-search\s*\{[^}]*\}/s);
		expect(search![0]).toMatch(/flex:\s*0 0 186px/);
		expect(search![0]).not.toMatch(/var\(--ntt-search-w/);
	});

	it('recent cards live in #ntt-titlebar-recent between search and buttons', () => {
		expect(css).toMatch(/#ntt-titlebar-recent\s*\{/);
	});

	it('the Edit button is pinned to the right edge by the greedy recent container', () => {
		// Keeps the Edit action at the right even when the row under-fills
		// (search hidden, or fewer recent tabs). Pinned right by the greedy
		// recent-cards container, not an auto-margin.
		const edit = css.match(/^#options-toggle\s*\{[^}]*\}/m);
		expect(edit![0]).not.toMatch(/margin-left:\s*auto/);
		const recent = css.match(/#ntt-titlebar-recent\s*\{[^}]*\}/s);
		expect(recent![0]).toMatch(/flex:\s*1 1 0/);
	});

	it('the Edit button carries the titlebar box visuals (surface bg + line shadow, 38px)', () => {
		// Reads as the same box as the recently-closed cards / search bar:
		// surface fill, rounded, subtle 1px line shadow, level at 38px.
		const edit = css.match(/^#options-toggle\s*\{[^}]*\}/m)![0];
		expect(edit).toMatch(/background:\s*var\(--ntt-surface/);
		expect(edit).toMatch(/box-shadow:[^;]*var\(--ntt-line-soft/);
		expect(edit).toMatch(/border-radius:/);
		expect(edit).toMatch(/height:\s*38px/);
	});

	it('titlebar separates slots by the tile gap (`gap: var(--ntt-gap)`)', () => {
		expect(css).toMatch(/^#ntt-titlebar\s*\{[^}]*gap:\s*var\(--ntt-gap/m);
	});

	it('the titlebar does NOT carry a `border-bottom` (separator dropped)', () => {
		// Whole `#ntt-titlebar { ... }` block, no border-bottom anywhere
		// inside it. The block may be split across other rules but the
		// canonical declaration must not include it.
		const titleBlockRe = /^#ntt-titlebar\s*\{[^}]*\}/m;
		const block = css.match(titleBlockRe);
		expect(block).not.toBeNull();
		expect(block![0]).not.toMatch(/border-bottom\s*:/);
	});

	it('titlebar padding-top equals padding-left/right at every spacing tier', () => {
		// Small: `padding: 30px 30px 0` (top = sides = 30px, bottom 0)
		// Medium override: `padding: 60px 60px 0`
		// Large override: `padding: 120px 120px 0`
		expect(css).toMatch(/^#ntt-titlebar\s*\{[^}]*padding:\s*30px\s+30px\s+0/m);
		expect(css).toMatch(/#ntt-titlebar\.medium\s*\{[^}]*padding:\s*60px\s+60px\s+0/);
		expect(css).toMatch(/#ntt-titlebar\.large\s*\{[^}]*padding:\s*120px\s+120px\s+0/);
	});

	it('the titlebar exposes exactly one action button — #options-toggle (Edit)', () => {
		expect(css).toMatch(/^#options-toggle\s*\{/m);
		expect(css).not.toMatch(/#ntt-titlebar-buttons/);
		expect(css).not.toMatch(/#locked-toggle\s*\{/);
	});

	it('the legacy `#ntt-cogwheel-wrap` styles are gone', () => {
		// The wrapper used to be `position: absolute; top: 10px; right: 10px`.
		// All of that is dead now — the wrap div was deleted from the markup.
		expect(css).not.toMatch(/#ntt-cogwheel-wrap\s*\{/);
	});
});
