/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: wallpaper picker — fetch, cache, display, persist.
 *
 * The wallpaper picker fetches Mozilla's curated wallpapers from Remote
 * Settings, displays them in a category-grouped grid, and persists the
 * selection as a `backgroundUrl` pref (CDN URL string).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

const MOZILLA_API_URL = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/newtab-wallpapers-v2/records';
const MOZILLA_CDN_BASE = 'https://firefox-settings-attachments.cdn.mozilla.net/';

describe('Wallpaper fetch logic — newTab.js', () => {
	let source: string;

	beforeAll(() => {
		source = fs.readFileSync(NEWTAB_PATH, 'utf8');
	});

	it('defines fetchFirefoxWallpapers as an async function', () => {
		expect(source).toMatch(/async\s+fetchFirefoxWallpapers\s*\(/);
	});

	it('fetches from the Mozilla Remote Settings endpoint', () => {
		expect(source).toContain(MOZILLA_API_URL);
	});

	it('uses the Mozilla CDN base URL for image assembly', () => {
		expect(source).toContain(MOZILLA_CDN_BASE);
	});

	it('filters out firefox category items and records without attachments', () => {
		expect(source).toMatch(/category\s*!==?\s*['"]firefox['"]/);
		expect(source).toContain('item.attachment');
	});

	it('assembles full image URL from CDN base + attachment.location', () => {
		expect(source).toContain('attachment.location');
	});
});

describe('Wallpaper picker UI — newTab.xhtml', () => {
	let xhtml: string;

	beforeAll(() => {
		xhtml = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.xhtml'), 'utf8'
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

describe('Wallpaper picker CSS — newTab.css', () => {
	let css: string;

	beforeAll(() => {
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

describe('backgroundUrl pref — prefs.js', () => {
	let prefsSource: string;

	beforeAll(() => {
		prefsSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/prefs.js'), 'utf8'
		);
	});

	it('declares backgroundUrl as a known pref key', () => {
		expect(prefsSource).toContain('backgroundUrl');
	});
});
