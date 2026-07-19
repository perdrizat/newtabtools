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
 * chrome-prep C4d (CHROME_PREP.md): `fetchFirefoxWallpapers` is a real
 * wallpaper.js export now (moved verbatim out of newTab.js) — imported
 * directly instead of vm-extracted from newTab.js source (C4a/b/c "import
 * from the new specifier" precedent). `_wallpaperCache` is wallpaper.js's
 * own module-private state (no longer a resettable `harness._wallpaperCache`
 * field) — `vi.resetModules()` + a fresh dynamic `import()` per test gives
 * each test its own module instance instead, the same effect the old
 * per-`beforeAll` harness object had.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readNewTabHtml } from './_helpers';
import { isMozillaWallpaperCatalogAvailable } from '../../webextension/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MOZILLA_CDN_BASE = 'https://firefox-settings-attachments.cdn.mozilla.net/';

// Captured BEFORE any test stubs `location`: restoring `{value: window.
// location}` inside afterEach is a self-referential no-op in jsdom
// (globalThis IS window, so it reads back the stub itself and leaks the
// chrome-extension origin into later tests — caught by the negative
// collections-link test below). Restore this original descriptor instead.
const ORIGINAL_LOCATION_DESCRIPTOR =
	Object.getOwnPropertyDescriptor(globalThis, 'location') as PropertyDescriptor;

// ===========================================================================
// Wallpaper fetch logic — behavioral
// ===========================================================================

describe('Wallpaper fetch logic — newTab.js (behavioral)', () => {
	let fetchFirefoxWallpapers: () => Promise<any[]>;

	beforeEach(async () => {
		// Fresh module instance per test — `_wallpaperCache` starts `undefined`
		// each time (see this file's header comment).
		vi.resetModules();
		({ fetchFirefoxWallpapers } = await import('../../webextension/wallpaper.js'));
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

		const result = await fetchFirefoxWallpapers();
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

		const result = await fetchFirefoxWallpapers();
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

		const result = await fetchFirefoxWallpapers();
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

		const result = await fetchFirefoxWallpapers();
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

		const first = await fetchFirefoxWallpapers();
		const second = await fetchFirefoxWallpapers();
		expect(first).toBe(second); // same reference
		expect((globalThis as any).fetch).toHaveBeenCalledTimes(1); // only one fetch
	});
});

// ===========================================================================
// Chrome catalog-unavailable predicate — api.js (CHROME.md D8 finding 2)
// ===========================================================================

describe('isMozillaWallpaperCatalogAvailable — api.js', () => {
	afterEach(() => {
		Object.defineProperty(globalThis, 'location', ORIGINAL_LOCATION_DESCRIPTOR);
	});

	it('is true under the default jsdom test location (Firefox/test fetch path stays live)', () => {
		expect(isMozillaWallpaperCatalogAvailable()).toBe(true);
	});

	it('is false under a chrome-extension: origin (the attachment CDN 406s Chrome UAs)', () => {
		Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
		expect(isMozillaWallpaperCatalogAvailable()).toBe(false);
	});

	it('is true under a moz-extension: origin', () => {
		Object.defineProperty(globalThis, 'location', { value: { protocol: 'moz-extension:' }, configurable: true });
		expect(isMozillaWallpaperCatalogAvailable()).toBe(true);
	});
});

// ===========================================================================
// Chrome wallpaper degrade — hardcoded solid palette (CHROME.md D8 finding 2)
// ===========================================================================
//
// The attachment CDN rejects Chrome User-Agents server-side with 406 (curl
// header matrix, CHROME.md D8), so on Chrome `fetchFirefoxWallpapers` must
// skip the network entirely and hand back a hardcoded solid-colour palette.
// Fresh module instance per test (see this file's header comment) so
// `_wallpaperCache` starts `undefined` and the chrome-extension stub from one
// test can't poison another.

describe('Wallpaper fetch logic — Chrome degrade (no network, hardcoded palette)', () => {
	let fetchFirefoxWallpapers: () => Promise<any[]>;
	let renderWallpaperGrid: (wallpapers: any[]) => void;

	beforeEach(async () => {
		vi.resetModules();
		({ fetchFirefoxWallpapers, renderWallpaperGrid } = await import('../../webextension/wallpaper.js'));
		(globalThis as any).fetch = vi.fn();
		Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
	});

	afterEach(() => {
		Object.defineProperty(globalThis, 'location', ORIGINAL_LOCATION_DESCRIPTOR);
	});

	it('resolves to the 15-record hardcoded palette without calling fetch', async () => {
		const result = await fetchFirefoxWallpapers();
		expect(result).toHaveLength(15);
		expect((globalThis as any).fetch).not.toHaveBeenCalled();
	});

	it('every record carries a solidColor and no imageUrl', async () => {
		const result = await fetchFirefoxWallpapers();
		for (const wp of result) {
			expect(typeof wp.solidColor).toBe('string');
			expect(wp.solidColor.length).toBeGreaterThan(0);
			expect(wp.imageUrl).toBeUndefined();
		}
	});

	it('renders 15 solid-colour DIV swatches (no <img>) under a solid-colors heading', async () => {
		document.body.innerHTML = '<div id="wallpaper-grid"></div>';
		const wallpapers = await fetchFirefoxWallpapers();
		renderWallpaperGrid(wallpapers);

		const thumbs = document.querySelectorAll('.wallpaper-thumb');
		expect(thumbs).toHaveLength(15);
		for (const thumb of thumbs) {
			expect(thumb.tagName).toBe('DIV');
		}
		expect(document.querySelectorAll('img.wallpaper-thumb')).toHaveLength(0);

		const headings = Array.from(document.querySelectorAll('.wallpaper-category')).map(h => h.textContent);
		expect(headings).toEqual(['solid colors']);
	});

	it('appends the curated-collections link (Unsplash Wallpapers) below the palette on Chrome', async () => {
		// Maintainer decision 2026-07-18 (supersedes the vendored-CC0-set
		// follow-up): Chrome ships NO photo wallpapers of its own — the solid
		// palette plus Upload Image, with a link to a curated free collection
		// for users who want a photo.
		document.body.innerHTML = '<div id="wallpaper-picker" hidden><div id="wallpaper-grid"></div></div>';
		const { openWallpaperPicker } = await import('../../webextension/wallpaper.js');
		openWallpaperPicker();

		await vi.waitFor(() => expect(document.querySelector('.wallpaper-collections-note')).toBeTruthy());
		const link = document.querySelector('.wallpaper-collections-note a') as HTMLAnchorElement;
		expect(link.href).toBe('https://unsplash.com/t/wallpapers');
		expect(link.target).toBe('_blank');
		expect(link.rel).toContain('noopener');
		expect((globalThis as any).fetch).not.toHaveBeenCalled();
	});

	it('re-opening the picker does not duplicate the collections link', async () => {
		document.body.innerHTML = '<div id="wallpaper-picker" hidden><div id="wallpaper-grid"></div></div>';
		const { openWallpaperPicker } = await import('../../webextension/wallpaper.js');
		openWallpaperPicker();
		await vi.waitFor(() => expect(document.querySelector('.wallpaper-collections-note')).toBeTruthy());
		openWallpaperPicker();
		await vi.waitFor(() => expect(document.querySelector('.wallpaper-collections-note')).toBeTruthy());
		expect(document.querySelectorAll('.wallpaper-collections-note')).toHaveLength(1);
	});
});

describe('Wallpaper picker — no collections link when the live catalog is available', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('the Firefox/live-catalog path never renders the collections note', async () => {
		document.body.innerHTML = '<div id="wallpaper-picker" hidden><div id="wallpaper-grid"></div></div>';
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ data: [{ category: 'solid-colors', title: 'blue', solid_color: '#76C1FF' }] }),
		});
		const { openWallpaperPicker } = await import('../../webextension/wallpaper.js');
		openWallpaperPicker();
		await vi.waitFor(() => expect(document.querySelectorAll('.wallpaper-thumb').length).toBeGreaterThan(0));
		expect(document.querySelector('.wallpaper-collections-note')).toBeNull();
	});
});

// ===========================================================================
// Wallpaper picker UI — newTab.html (wiring)
// ===========================================================================

describe('Wallpaper picker UI — newTab.html', () => {
	let html: string;

	beforeAll(() => {
		html = readNewTabHtml();
	});

	it('has a wallpaper picker container element', () => {
		expect(html).toContain('id="wallpaper-picker"');
	});

	it('has a button to open the wallpaper picker', () => {
		expect(html).toContain('id="options-wallpaper-btn"');
	});

	it('has a wallpaper grid container', () => {
		expect(html).toContain('id="wallpaper-grid"');
	});

	it('has a close button for the picker', () => {
		expect(html).toContain('id="wallpaper-close"');
	});

	it('has an upload custom image option', () => {
		expect(html).toContain('id="wallpaper-upload"');
	});

	it('has a reset/no-background option', () => {
		expect(html).toContain('id="wallpaper-reset"');
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
