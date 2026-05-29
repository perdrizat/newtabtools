/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phase 4-5: domain-hash brand colors for fallback tiles.
 *
 * `siteHue(url)` returns a deterministic 0-359 hue derived from the URL's
 * hostname (`www.` stripped). `siteBrandColor(link)` resolves the CSS
 * value used for `.ntt-logo-fallback`'s `--ntt-brand` with this precedence:
 *
 *   1. `link.backgroundColor` if it's a syntactically valid hex color
 *      (security: rejects strings like `#ff0000); url(...)`).
 *   2. `hsl(siteHue(url), 55%, 52%)` — stable per host.
 *   3. `#666` neutral grey fallback when the URL can't be parsed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX_PATH = path.resolve(__dirname, '../../webextension/fx-newTab.js');

describe('siteHue + siteBrandColor', () => {
	let siteHue: (url: string) => number | null;
	let siteBrandColor: (link: any) => string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(FX_PATH, 'utf8');
		// Both helpers are top-level `function` declarations. Extract them
		// by name and evaluate inside a scoped IIFE so we can return refs.
		const hueMatch = source.match(/^function\s+siteHue\([\s\S]*?\n\}/m);
		const brandMatch = source.match(/^function\s+siteBrandColor\([\s\S]*?\n\}/m);
		if (!hueMatch || !brandMatch) {
			throw new Error('siteHue/siteBrandColor not found in fx-newTab.js');
		}
		// vm.createContext starts with no globals — explicitly hand it the
		// host's URL constructor so `new URL(...)` works inside the body.
		const ctx = vm.createContext({ URL });
		vm.runInContext(`${hueMatch[0]}\n${brandMatch[0]}\nglobalThis._siteHue = siteHue; globalThis._siteBrandColor = siteBrandColor;`, ctx);
		siteHue = (ctx as any)._siteHue;
		siteBrandColor = (ctx as any)._siteBrandColor;
	});

	it('siteHue returns a deterministic hue 0-359 for a given hostname', () => {
		const a = siteHue('https://example.com/');
		const b = siteHue('https://example.com/some/path?q=1');
		expect(a).toBe(b);
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThan(360);
	});

	it('siteHue strips `www.` so the same brand is shared', () => {
		expect(siteHue('https://www.example.com/')).toBe(siteHue('https://example.com/'));
	});

	it('siteHue differentiates hostnames', () => {
		// Not strictly guaranteed by the hash, but the chosen polynomial
		// gives different values for these three real-world hostnames.
		const a = siteHue('https://example.com/');
		const b = siteHue('https://google.com/');
		const c = siteHue('https://github.com/');
		expect(new Set([a, b, c]).size).toBe(3);
	});

	it('siteHue returns null for unparseable URLs', () => {
		expect(siteHue('not a url')).toBeNull();
		expect(siteHue('')).toBeNull();
	});

	it('siteBrandColor prefers a valid `link.backgroundColor` over the hash', () => {
		expect(siteBrandColor({ url: 'https://example.com/', backgroundColor: '#abcdef' })).toBe('#abcdef');
	});

	it('siteBrandColor rejects malicious backgroundColor and falls through to the hash', () => {
		const out = siteBrandColor({
			url: 'https://example.com/',
			backgroundColor: '#ff0000); url(http://attacker.example/x',
		});
		expect(out).not.toMatch(/url\(/);
		expect(out).not.toMatch(/attacker/);
		expect(out).toMatch(/^oklch\(65% 0\.13 \d+(\.\d+)?\)$/);
	});

	it('siteBrandColor falls back to `#666` when the URL can\'t be parsed', () => {
		expect(siteBrandColor({ url: 'not a url' })).toBe('#666');
	});

	it('siteBrandColor returns a stable OKLCH string per host', () => {
		// OKLCH instead of HSL so white glyph text has perceptually-uniform
		// contrast across hues.
		const a = siteBrandColor({ url: 'https://example.com/foo' });
		const b = siteBrandColor({ url: 'https://example.com/bar' });
		expect(a).toBe(b);
		expect(a).toMatch(/^oklch\(65% 0\.13 \d+(\.\d+)?\)$/);
	});

	it('handles a null/undefined link without throwing', () => {
		expect(siteBrandColor(null)).toBe('#666');
		expect(siteBrandColor(undefined)).toBe('#666');
	});
});
