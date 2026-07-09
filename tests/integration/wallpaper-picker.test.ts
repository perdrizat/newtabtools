/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: wallpaper picker — fetch, cache, display, persist.
 *
 * The wallpaper picker fetches Mozilla's curated wallpapers from Remote
 * Settings, displays them in a category-grouped grid, and persists the
 * selection as a `backgroundUrl` pref (CDN URL string).
 *
 * Fetch logic is tested behaviorally by extracting `fetchFirefoxWallpapers`
 * from the real newTab.js and running it with a mocked `fetch`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

const MOZILLA_CDN_BASE = 'https://firefox-settings-attachments.cdn.mozilla.net/';

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) {throw new Error(`${methodName} not found`);}
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') {depth++;}
		else if (source[i] === '}') { depth--; if (depth === 0) {return source.substring(start, i + 1);} }
	}
	throw new Error('Unbalanced braces');
}

// ===========================================================================
// Wallpaper fetch logic — behavioral (vm.runInThisContext)
// ===========================================================================

describe('Wallpaper fetch logic — newTab.js (behavioral)', () => {
	let harness: { fetchFirefoxWallpapers: () => Promise<any[]>; _wallpaperCache: any };

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const method = extractMethod(source, 'fetchFirefoxWallpapers');

		const code = `var newTabTools = { ${method}, _wallpaperCache: null };`;
		vm.runInThisContext(code, { filename: 'wallpaper-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		harness._wallpaperCache = null;
	});

	it('returns wallpapers with imageUrl assembled from CDN base + attachment.location', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{
						title: 'Beach',
						theme: 'light',
						category: 'landscape',
						attachment: { location: 'main-workspace/beach.avif' },
						attribution: 'Photo by Someone',
					},
				],
			}),
		});

		const result = await harness.fetchFirefoxWallpapers();
		expect(result).toHaveLength(1);
		// New shape (Phase 4-5 follow-up): `backgroundPosition` is always
		// present, defaulting to `center center` when the upstream record
		// doesn't carry one. `solidColor` is omitted for image records.
		expect(result[0]).toEqual({
			title: 'Beach',
			theme: 'light',
			category: 'landscape',
			imageUrl: MOZILLA_CDN_BASE + 'main-workspace/beach.avif',
			attribution: 'Photo by Someone',
			backgroundPosition: 'center center',
		});
	});

	it('filters out items with category "firefox"', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{
						title: 'Firefox Branded',
						theme: 'dark',
						category: 'firefox',
						attachment: { location: 'firefox-branded.avif' },
					},
					{
						title: 'Mountain',
						theme: 'light',
						category: 'nature',
						attachment: { location: 'mountain.avif' },
					},
				],
			}),
		});

		const result = await harness.fetchFirefoxWallpapers();
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe('Mountain');
	});

	it('filters out items without attachment', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{ title: 'No Attachment', theme: 'dark', category: 'abstract' },
					{
						title: 'Valid',
						theme: 'light',
						category: 'abstract',
						attachment: { location: 'valid.avif' },
					},
				],
			}),
		});

		const result = await harness.fetchFirefoxWallpapers();
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe('Valid');
	});

	it('filters out items where attachment has no location', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{
						title: 'No Location',
						theme: 'dark',
						category: 'abstract',
						attachment: {},
					},
					{
						title: 'Has Location',
						theme: 'light',
						category: 'abstract',
						attachment: { location: 'has-loc.avif' },
					},
				],
			}),
		});

		const result = await harness.fetchFirefoxWallpapers();
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe('Has Location');
	});

	it('caches results and returns cache on subsequent calls', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{
						title: 'Cached',
						theme: 'light',
						category: 'nature',
						attachment: { location: 'cached.avif' },
					},
				],
			}),
		});

		const first = await harness.fetchFirefoxWallpapers();
		const second = await harness.fetchFirefoxWallpapers();
		expect(first).toBe(second); // same reference
		expect((globalThis as any).fetch).toHaveBeenCalledTimes(1); // only one fetch
	});
});

// ===========================================================================
// Wallpaper picker UI — newTab.html (wiring)
// ===========================================================================

describe('Wallpaper picker UI — newTab.html', () => {
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: template structure
		xhtml = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.html'), 'utf8'
		);
	});

	it('has a wallpaper picker container element', () => {
		expect(xhtml).toContain('id="wallpaper-picker"');
	});

	it('has a button to open the wallpaper picker', () => {
		expect(xhtml).toContain('id="options-wallpaper-btn"');
	});

	it('has a wallpaper grid container', () => {
		expect(xhtml).toContain('id="wallpaper-grid"');
	});

	it('has a close button for the picker', () => {
		expect(xhtml).toContain('id="wallpaper-close"');
	});

	it('has an upload custom image option', () => {
		expect(xhtml).toContain('id="wallpaper-upload"');
	});

	it('has a reset/no-background option', () => {
		expect(xhtml).toContain('id="wallpaper-reset"');
	});
});

// ===========================================================================
// Wallpaper picker CSS — newTab.css (wiring)
// ===========================================================================

describe('Wallpaper picker CSS — newTab.css', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.css'), 'utf8'
		);
	});

	it('styles the wallpaper picker as a sidebar', () => {
		expect(css).toContain('#wallpaper-picker');
	});

	it('styles wallpaper thumbnails with cover fit', () => {
		expect(css).toContain('.wallpaper-thumb');
		expect(css).toContain('object-fit: cover');
	});

	it('highlights the active wallpaper selection', () => {
		expect(css).toContain('.wallpaper-thumb[selected]');
	});
});

// ===========================================================================
// backgroundUrl pref — prefs.js (wiring)
// ===========================================================================

describe('backgroundUrl pref — prefs.js', () => {
	let prefsSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: pref wiring
		prefsSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/prefs.js'), 'utf8'
		);
	});

	it('declares backgroundUrl as a known pref key', () => {
		expect(prefsSource).toContain('backgroundUrl');
	});
});
