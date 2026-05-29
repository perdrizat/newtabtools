/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: tile aspect ratio CSS rules (newTab.css).
 *
 * Verifies that :root[tileaspect="..."] rules exist for each locked aspect,
 * that the grid centers when aspect is locked, and that rows stop stretching
 * vertically so the aspect-locked cell height is honored.
 *
 * Layout correctness (actual rendered sizes) is verified in the E2E suite
 * (tests/e2e/tile-aspect.test.ts) because jsdom does not compute CSS
 * aspect-ratio against a real layout engine.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('Tile aspect ratio CSS — newTab.css', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS aspect-ratio rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('declares aspect-ratio 16 / 9 for [tileaspect="16-9"] cells', () => {
		expect(css).toMatch(/:root\[tileaspect="16-9"\][^{}]*\.newtab-cell\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
	});

	it('declares aspect-ratio 4 / 3 for [tileaspect="4-3"] cells', () => {
		expect(css).toMatch(/:root\[tileaspect="4-3"\][^{}]*\.newtab-cell\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/);
	});

	it('declares aspect-ratio 1 / 1 for [tileaspect="1-1"] cells', () => {
		expect(css).toMatch(/:root\[tileaspect="1-1"\][^{}]*\.newtab-cell\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
	});

	it('declares aspect-ratio 3 / 4 for [tileaspect="3-4"] (portrait) cells', () => {
		expect(css).toMatch(/:root\[tileaspect="3-4"\][^{}]*\.newtab-cell\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/);
	});

	it('centers #newtab-grid when aspect is locked (not fill)', () => {
		// At least one rule must center the grid for a locked aspect.
		expect(css).toMatch(/:root\[tileaspect="(?:16-9|4-3|1-1|3-4)"\][^{}]*#newtab-grid\s*\{[^}]*justify-content:\s*center/);
	});

	it('centers the grid content when aspect is locked', () => {
		expect(css).toMatch(/:root\[tileaspect="(?:16-9|4-3|1-1|3-4)"\][^{}]*#newtab-grid\s*\{[^}]*align-content:\s*center/);
	});

	it('does not change defaults when [tileaspect="fill"] (no rule for fill)', () => {
		// Fill mode should have NO :root[tileaspect="fill"] selector that
		// overrides flex/aspect — fill is the existing behavior.
		expect(css).not.toMatch(/:root\[tileaspect="fill"\][^{}]*\.newtab-cell\s*\{[^}]*aspect-ratio/);
	});
});

describe('Tile aspect ratio UI — newTab.xhtml', () => {
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: template structure
		xhtml = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.xhtml'), 'utf8'
		);
	});

	it('has a tileAspect segmented control in the Tile tab (Phase 3-2 reshuffle)', () => {
		// Phase 3-2 reshuffle: the legacy `<select name="tileAspect">` was
		// replaced by a 5-button segmented radiogroup with `data-pref="tileAspect"`.
		expect(xhtml).toMatch(/data-pref="tileAspect"/);
	});

	it('offers all five aspect options (fill, 16-9, 4-3, 1-1, 3-4)', () => {
		expect(xhtml).toMatch(/data-value="fill"/);
		expect(xhtml).toMatch(/data-value="16-9"/);
		expect(xhtml).toMatch(/data-value="4-3"/);
		expect(xhtml).toMatch(/data-value="1-1"/);
		expect(xhtml).toMatch(/data-value="3-4"/);
	});

	it('uses i18n data-message attributes for the row label and the Fill option', () => {
		// Row label.
		expect(xhtml).toContain('options_tile_aspect');
		// Only the "Fill viewport" label is localized — the four ratios
		// (16:9, 4:3, etc.) are bare strings in the segmented buttons per
		// UX decision.
		expect(xhtml).toContain('options_tile_aspect_fill');
	});
});
