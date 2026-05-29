/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phase 4-5 favicons-from-cache: real implementation.
 *
 * The auto-thumbnail capture pipeline now also grabs `tab.favIconUrl`,
 * fetches it as a Blob, and stashes it in the existing `thumbnails`
 * objectStore under the same row as the screenshot (new `favicon` field).
 * On the page side `newTabTools.getFavicons` queries a new
 * `Thumbnails.getFavicons` message and calls `site.applyFavicon(blob)` for
 * any tile that still has a logo-fallback (i.e. no real screenshot).
 *
 * `applyFavicon` swaps the letter glyph for an `<img class="ntt-logo-favicon">`
 * sourced from `URL.createObjectURL(blob)`.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const FX_PATH = path.resolve(__dirname, '../../webextension/fx-newTab.js');
const BG_PATH = path.resolve(__dirname, '../../webextension/background.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
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

describe('background.js — favicon capture + storage wiring', () => {
	let source: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: capture pipeline
		source = fs.readFileSync(BG_PATH, 'utf8');
	});

	it('captureTab returns (dataURL, favIconUrl) — second arg threads `tab.favIconUrl` through', () => {
		// The new contract: `callback(dataURL, favIconUrl)`. Older tests
		// passing a single-arg callback would still work, but the wiring
		// itself must reach for `tab.favIconUrl`.
		expect(source).toMatch(/let\s+favIconUrl\s*=\s*tab\.favIconUrl\s*\|\|\s*null/);
		expect(source).toMatch(/callback\(\s*dataURL\s*,\s*favIconUrl\s*\)/);
	});

	it('startCaptureSession threads favIconUrl from each capture into `session.favIconUrl`', () => {
		// All three captures (A, B, C) must store the latest non-null
		// favIconUrl they observe. The regex tolerates any whitespace.
		const assignments = source.match(/session\.favIconUrl\s*=\s*favIconUrl/g) || [];
		expect(assignments.length).toBeGreaterThanOrEqual(3);
	});

	it('fetchFaviconBlob exists and caps at 64 KB', () => {
		// Cap is important: some sites ship huge SVG favicons that would
		// bloat the IDB store. 64 KB comfortably fits a PNG/ICO favicon.
		expect(source).toMatch(/function\s+fetchFaviconBlob/);
		expect(source).toMatch(/64\s*\*\s*1024/);
	});

	it('pickAndStore writes the favicon Blob to the thumbnails row when present', () => {
		// Wires the fetchFaviconBlob result into the put() record.
		expect(source).toMatch(/fetchFaviconBlob\(favIconUrl\)/);
		expect(source).toMatch(/record\.favicon\s*=\s*faviconBlob/);
	});

	it('Thumbnails.getFavicons message handler walks the store and returns a Map', () => {
		expect(source).toMatch(/case\s+['"]Thumbnails\.getFavicons['"]/);
		expect(source).toMatch(/sendResponse\(faviconMap\)/);
	});
});

describe('newTabTools.getFavicons', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'getFavicons');
		const code = `var _favHarness = { ${body} };`;
		vm.runInThisContext(code, { filename: 'get-favicons-harness.js' });
		harness = (globalThis as any)._favHarness;
	});

	beforeEach(() => {
		(globalThis as any).Grid = undefined;
		(globalThis as any).chrome = undefined;
	});

	function makeBadgelessSite(url: string) {
		// Tile whose overlay badge already has an <img> (favicon previously
		// applied). `getFavicons` skips it because there's nothing to load.
		const root = document.createElement('div');
		const badge = document.createElement('div'); badge.className = 'ntt-favicon';
		badge.appendChild(document.createElement('img'));
		root.appendChild(badge);
		return {
			link: { url },
			applyFavicon: vi.fn(),
			thumbnail: document.createElement('div'),
			_querySelector(sel: string) { return root.querySelector(sel); },
		};
	}

	function makeBadgeSite(url: string) {
		// Tile whose overlay badge is still showing the letter glyph — needs
		// a favicon. Works the same whether or not the centred fallback is
		// also visible (the badge is in the overlay, which always exists).
		const root = document.createElement('div');
		const badge = document.createElement('div'); badge.className = 'ntt-favicon';
		root.appendChild(badge);
		return {
			link: { url },
			applyFavicon: vi.fn(),
			thumbnail: document.createElement('div'),
			_querySelector(sel: string) { return root.querySelector(sel); },
		};
	}

	it('queries every site whose overlay badge does not yet have an <img>', () => {
		const a = makeBadgeSite('https://a.example/');
		const b = makeBadgelessSite('https://b.example/');
		const c = makeBadgeSite('https://c.example/');
		(globalThis as any).Grid = { sites: [a, b, c, null] };
		const sendMessage = vi.fn();
		(globalThis as any).chrome = { runtime: { sendMessage } };

		harness.getFavicons();

		expect(sendMessage).toHaveBeenCalledTimes(1);
		const [msg] = sendMessage.mock.calls[0];
		expect(msg.name).toBe('Thumbnails.getFavicons');
		expect(msg.urls).toEqual(['https://a.example/', 'https://c.example/']);
	});

	it('short-circuits with no message when every badge already has its favicon', () => {
		const a = makeBadgelessSite('https://a.example/');
		(globalThis as any).Grid = { sites: [a, null] };
		const sendMessage = vi.fn();
		(globalThis as any).chrome = { runtime: { sendMessage } };

		harness.getFavicons();

		expect(sendMessage).not.toHaveBeenCalled();
	});

	it('calls site.applyFavicon with the matching Blob for every hit in the response', () => {
		const a = makeBadgeSite('https://a.example/');
		const b = makeBadgeSite('https://b.example/');
		(globalThis as any).Grid = { sites: [a, b] };
		const blobA = new Blob(['a']);
		const blobB = new Blob(['b']);
		const responseMap = new Map([
			['https://a.example/', blobA],
			['https://b.example/', blobB],
		]);
		(globalThis as any).chrome = {
			runtime: { sendMessage: (_msg: any, cb: any) => cb(responseMap) },
		};

		harness.getFavicons();

		expect(a.applyFavicon).toHaveBeenCalledWith(blobA);
		expect(b.applyFavicon).toHaveBeenCalledWith(blobB);
	});

	it('survives an empty or malformed response without throwing', () => {
		const a = makeBadgeSite('https://a.example/');
		(globalThis as any).Grid = { sites: [a] };
		(globalThis as any).chrome = {
			runtime: { sendMessage: (_msg: any, cb: any) => cb(null) },
		};
		expect(() => harness.getFavicons()).not.toThrow();
		expect(a.applyFavicon).not.toHaveBeenCalled();
	});
});

describe('Site.applyFavicon — DOM swap', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(FX_PATH, 'utf8');
		const body = extractMethod(source, 'applyFavicon');
		const code = `var _applyHarness = { ${body} };`;
		vm.runInThisContext(code, { filename: 'apply-favicon-harness.js' });
		harness = (globalThis as any)._applyHarness;
	});

	function buildSite(withFallback = true) {
		document.body.innerHTML = '';
		const node = document.createElement('div');
		node.className = 'newtab-site';
		const thumb = document.createElement('div');
		thumb.className = 'newtab-thumbnail';
		node.appendChild(thumb);
		if (withFallback) {
			const fallback = document.createElement('div');
			fallback.className = 'ntt-logo-fallback';
			const glyph = document.createElement('div');
			glyph.className = 'ntt-logo-glyph';
			glyph.textContent = 'E';
			fallback.appendChild(glyph);
			thumb.appendChild(fallback);
		}
		document.body.appendChild(node);
		return {
			node,
			_querySelector(sel: string) {
				return node.querySelector(sel);
			},
		};
	}

	beforeEach(() => {
		// `URL.createObjectURL` isn't implemented in jsdom by default —
		// stub it so applyFavicon can run end-to-end.
		(URL as any).createObjectURL = vi.fn(() => 'blob:fake-url');
		(URL as any).revokeObjectURL = vi.fn();
	});

	it('replaces the glyph with an <img class="ntt-logo-favicon">', () => {
		const site = buildSite();
		const blob = new Blob(['x']);
		harness.applyFavicon.call(site, blob);
		const fallback = site.node.querySelector('.ntt-logo-fallback')!;
		expect(fallback.querySelector('.ntt-logo-glyph')).toBeNull();
		const img = fallback.querySelector('img.ntt-logo-favicon') as HTMLImageElement;
		expect(img).not.toBeNull();
		expect(img.src).toBe('blob:fake-url');
		expect(img.getAttribute('alt')).toBe('');
	});

	it('no-ops when the site is already showing a real screenshot (no fallback in DOM)', () => {
		const site = buildSite(/* withFallback */ false);
		const blob = new Blob(['x']);
		harness.applyFavicon.call(site, blob);
		expect(site.node.querySelector('.ntt-logo-favicon')).toBeNull();
	});

	it('no-ops on falsy blob (defensive — handler caller may pass null)', () => {
		const site = buildSite();
		harness.applyFavicon.call(site, null);
		expect(site.node.querySelector('.ntt-logo-favicon')).toBeNull();
		expect(site.node.querySelector('.ntt-logo-glyph')).not.toBeNull();
	});

	it('revokes a prior object URL before allocating a new one (no leak across re-applications)', () => {
		const site: any = buildSite();
		harness.applyFavicon.call(site, new Blob(['a']));
		// Second application — simulate a re-render with a different favicon.
		// First, restore the fallback DOM so applyFavicon has something to
		// replace again.
		const fallback = site.node.querySelector('.ntt-logo-fallback')!;
		const img = fallback.querySelector('img.ntt-logo-favicon')!;
		fallback.removeChild(img);
		const glyph = document.createElement('div');
		glyph.className = 'ntt-logo-glyph';
		fallback.appendChild(glyph);
		harness.applyFavicon.call(site, new Blob(['b']));
		expect(URL.revokeObjectURL).toHaveBeenCalled();
	});
});
