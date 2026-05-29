/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression tests for titlebar layout invariants. The recent restructure
 * moved the cogwheel + lock-toggle into `#ntt-titlebar-buttons` and
 * introduced a set of rules that must hold for the alignment to behave:
 *
 *   1. `#ntt-clock` must own `margin-left: auto` so it (and the buttons
 *      group after it) always stick to the right edge, regardless of which
 *      siblings are visible.
 *   2. When the clock is hidden, the buttons group must take over the
 *      auto-margin — otherwise the cogwheel + lock-toggle collapse left.
 *   3. When the wordmark is hidden, the search bar must snap to the left
 *      edge instead of trying to centre itself against nothing.
 *   4. The titlebar must NOT carry a bottom border anymore (separator was
 *      dropped in favour of just `margin-bottom: var(--ntt-gap)`).
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

	it('clock owns the right-side auto-margin (`#ntt-clock { margin-left: auto }`)', () => {
		expect(css).toMatch(/#ntt-titlebar\s*>\s*#ntt-clock\s*\{[^}]*margin-left:\s*auto/);
	});

	it('buttons group takes over the auto-margin when the clock is hidden (sibling rule)', () => {
		// `#ntt-clock[hidden] + #ntt-titlebar-buttons` selects the buttons
		// group only when clock is hidden — keeps cogwheel/lock-toggle
		// right-aligned even with no clock between them and the wordmark.
		expect(css).toMatch(/#ntt-titlebar\s*>\s*#ntt-clock\[hidden\]\s*\+\s*#ntt-titlebar-buttons\s*\{[^}]*margin-left:\s*auto/);
	});

	it('search snaps to the left when the wordmark is hidden (via :has)', () => {
		// `margin: 0 auto` on search centres it when the wordmark is
		// visible. With the wordmark hidden there's nothing to centre
		// against — the rule must reset to `margin: 0` so search sits at
		// the left edge.
		expect(css).toMatch(/#ntt-titlebar:has\(#ntt-wordmark\[hidden\]\)\s+#ntt-search\s*\{[^}]*margin:\s*0/);
	});

	it('search has the centring auto-margin by default', () => {
		expect(css).toMatch(/#ntt-search\s*\{[^}]*margin:\s*0\s+auto/);
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

	it('cogwheel and lock-toggle live in #ntt-titlebar-buttons (32×32 buttons)', () => {
		expect(css).toMatch(/#ntt-titlebar-buttons\s+#options-toggle,\s*\n?\s*#ntt-titlebar-buttons\s+#locked-toggle\s*\{[^}]*width:\s*32px/);
	});

	it('the legacy `#ntt-cogwheel-wrap` styles are gone', () => {
		// The wrapper used to be `position: absolute; top: 10px; right: 10px`.
		// All of that is dead now — the wrap div was deleted from the XHTML.
		expect(css).not.toMatch(/#ntt-cogwheel-wrap\s*\{/);
	});
});
