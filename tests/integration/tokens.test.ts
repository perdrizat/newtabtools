/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: NTT v2 design tokens (tokens.css).
 *
 * Verifies that all required CSS custom properties are defined in tokens.css
 * for both light (:root) and dark (:root[theme="dark"]) themes, and that
 * spacing/shadow/font tokens are present.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readNewTabHtml } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, '../../webextension/tokens.css');

describe('Design tokens — tokens.css', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS tokens
		css = fs.readFileSync(TOKENS_PATH, 'utf8');
	});

	describe('color tokens on :root (light defaults)', () => {
		const lightTokens = [
			'--ntt-page-bg',
			'--ntt-surface',
			'--ntt-surface-soft',
			'--ntt-ink',
			'--ntt-sub',
			'--ntt-mute',
			'--ntt-line',
			'--ntt-line-soft',
			'--ntt-kbd-bg',
			'--ntt-kbd-ink',
			'--ntt-accent',
			'--ntt-accent-tint',
			'--ntt-success',
			'--ntt-danger',
		];

		it.each(lightTokens)('defines %s', (token) => {
			const regex = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
			expect(css).toMatch(regex);
		});
	});

	describe('dark theme overrides on :root[theme="dark"]', () => {
		it('has a :root[theme="dark"] block', () => {
			expect(css).toMatch(/:root\[theme="dark"\]/);
		});

		const darkTokens = [
			'--ntt-page-bg',
			'--ntt-surface',
			'--ntt-ink',
			'--ntt-accent',
		];

		it.each(darkTokens)('overrides %s in dark theme', (token) => {
			const darkBlock = css.slice(css.indexOf(':root[theme="dark"]'));
			const regex = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
			expect(darkBlock).toMatch(regex);
		});
	});

	describe('high-contrast theme overrides (newTab.css :root[theme="contrast"])', () => {
		// The light defaults of these are black-alpha inks/fills: inherited into
		// high contrast they render dark-on-black and vanish (issue #24: the
		// search placeholder uses --ntt-sub). Every token the dark theme re-inks
		// must be re-inked for contrast too, except the ones listed here, which
		// read on black as-is or are overridden by dedicated HC rules.
		const inheritedOnPurpose = new Set([
			'--ntt-page-bg', // HC paints the page with --page-background: #000
			'--ntt-accent', // copper, reserved for focus/selection rings; legible on black
			'--ntt-accent-tint', // HC replaces tint fills with solid rings (newTab.css)
			'--ntt-success', // mid green, legible on black
			'--ntt-shadow-tile-rest', // built from --ntt-line, which HC overrides
			'--ntt-shadow-tile-hover',
			'--ntt-shadow-tile-selected',
		]);

		function tokenNames(block: string): string[] {
			return [...block.matchAll(/(--ntt-[\w-]+)\s*:/g)].map((m) => m[1]);
		}

		function blockAfter(source: string, selector: string): string {
			const start = source.indexOf(selector);
			expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
			return source.slice(start, source.indexOf('}', start));
		}

		it('re-inks every token the dark theme overrides', () => {
			// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS tokens; the computed colour is covered by UAT 32-high-contrast
			const newTabCss = fs.readFileSync(path.resolve(__dirname, '../../webextension/newTab.css'), 'utf8');
			const contrast = new Set(tokenNames(blockAfter(newTabCss, ':root[theme="contrast"]')));
			const missing = tokenNames(blockAfter(css, ':root[theme="dark"]'))
				.filter((t) => !contrast.has(t) && !inheritedOnPurpose.has(t));
			expect(missing).toEqual([]);
		});
	});

	describe('spacing tokens', () => {
		it('defines --ntt-gap', () => {
			expect(css).toMatch(/--ntt-gap\s*:/);
		});

		it('defines --ntt-outer-pad-x', () => {
			expect(css).toMatch(/--ntt-outer-pad-x\s*:/);
		});

		it('defines --ntt-radius', () => {
			expect(css).toMatch(/--ntt-radius\s*:/);
		});
	});

	describe('typography tokens', () => {
		it('defines --ntt-font-ui', () => {
			expect(css).toMatch(/--ntt-font-ui\s*:/);
		});

		it('defines --ntt-font-mono', () => {
			expect(css).toMatch(/--ntt-font-mono\s*:/);
		});
	});

	describe('shadow tokens', () => {
		it('defines --ntt-shadow-tile-rest', () => {
			expect(css).toMatch(/--ntt-shadow-tile-rest\s*:/);
		});

		it('defines --ntt-shadow-tile-hover', () => {
			expect(css).toMatch(/--ntt-shadow-tile-hover\s*:/);
		});

		it('defines --ntt-shadow-tile-selected', () => {
			expect(css).toMatch(/--ntt-shadow-tile-selected\s*:/);
		});
	});

	describe('page background gradients', () => {
		it('includes radial-gradient for light theme', () => {
			expect(css).toMatch(/radial-gradient/);
		});
	});

	describe('newTab.html links tokens.css', () => {
		let html: string;

		beforeAll(() => {
			html = readNewTabHtml();
		});

		it('has a <link> to tokens.css', () => {
			expect(html).toMatch(/<link[^>]+href="tokens\.css"/);
		});
	});
});
