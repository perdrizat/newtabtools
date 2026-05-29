/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: foreground opacity on fallback tiles.
 *
 * Tiles without a screenshot render `.ntt-logo-fallback` (a radial-gradient
 * background + a centred glyph). The user wants `--opacity`
 * (Prefs.opacity / 100) to dim the background so the wallpaper / page colour
 * shines through, while the glyph itself stays at full opacity for
 * legibility.
 *
 * The first attempt put `opacity: var(--opacity)` directly on the fallback
 * element, which dimmed the glyph too. The fix is to push the background to
 * a `::before` pseudo-element with `opacity: var(--opacity)`, give the
 * glyph `position: relative; z-index: 1` so it stacks above, and zero out
 * the underlying thumbnail background when a fallback is present so the
 * page wallpaper can actually reach the surface.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('Logo fallback foreground-opacity invariants', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: fallback opacity structure
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('`.ntt-logo-fallback` itself does NOT carry `opacity: var(--opacity)`', () => {
		// Putting opacity on the container fades the glyph too — bug.
		const block = css.match(/^\.ntt-logo-fallback\s*\{[^}]*\}/m);
		expect(block).not.toBeNull();
		expect(block![0]).not.toMatch(/opacity\s*:\s*var\(--opacity\)/);
	});

	it('the `::before` pseudo-element carries the foreground-opacity-dimmed background', () => {
		expect(css).toMatch(/\.ntt-logo-fallback::before\s*\{[^}]*background:\s*radial-gradient[\s\S]*?opacity:\s*var\(--opacity\)/);
	});

	it('the glyph stacks above the pseudo background (`position: relative; z-index: 1`)', () => {
		// Without an explicit stacking, the ::before paints over the glyph.
		const block = css.match(/^\.ntt-logo-glyph\s*\{[^}]*\}/m);
		expect(block).not.toBeNull();
		expect(block![0]).toMatch(/position:\s*relative/);
		expect(block![0]).toMatch(/z-index:\s*1/);
	});

	it('thumbnail box goes transparent when a fallback is present (so the wallpaper can show through)', () => {
		// `.newtab-thumbnail` has a default `background-color: var(--ntt-surface, ...)`.
		// With a `:has(.ntt-logo-fallback)` override that surface is cleared,
		// otherwise the ::before's transparency only reveals the surface
		// colour, not the actual page background.
		expect(css).toMatch(/\.newtab-thumbnail:has\(\.ntt-logo-fallback\)\s*\{[^}]*background-color:\s*transparent/);
	});
});
