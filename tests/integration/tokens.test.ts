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
		let xhtml: string;

		beforeAll(() => {
			// eslint-disable-next-line ntt/no-source-grep -- wiring check: stylesheet link
			xhtml = fs.readFileSync(
				path.resolve(__dirname, '../../webextension/newTab.html'), 'utf8'
			);
		});

		it('has a <link> to tokens.css', () => {
			expect(xhtml).toMatch(/<link[^>]+href="tokens\.css"/);
		});
	});
});
