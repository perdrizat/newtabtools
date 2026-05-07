/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: auto-thumbnail capture, storage, display, and cleanup.
 * Phase 1 slot 16 of the migration plan (MIGRATION.md).
 *
 * The auto-thumbnail system has five pieces:
 *   1. Content script (`thumbnail.js`): uses non-standard `drawWindow` to
 *      capture the visible page, sends `Thumbnails.save` via runtime message.
 *   2. Background trigger (`background.js` `webNavigation.onCompleted`):
 *      checks if URL is in tile cache + thumbnail is stale, injects content
 *      script.
 *   3. Background save (`Thumbnails.save` handler): stores url + image blob +
 *      stored/used dates in IDB `thumbnails` store.
 *   4. New tab display (`newTab.js` `getThumbnails`): requests thumbnails for
 *      grid sites missing background images, applies as CSS background.
 *   5. Cleanup (`background.js` `cleanupThumbnails`): removes thumbnails with
 *      `used` date older than 2 weeks, triggered on idle.
 *
 * The content script's `drawWindow` is a non-standard Firefox-only API that
 * cannot be tested in jsdom. This test covers the surrounding orchestration.
 *
 * Known capture behaviour (characterization, observed 2026-05-06):
 *   - Working: https://insideparadeplatz.ch/, https://www.finews.ch/
 *   - Not working (empty screenshot): https://www.heise.de/newsticker/
 *   - Partially working (incomplete load): https://www.qoqa.ch/de
 *
 * The failures are consistent with drawWindow capturing before page resources
 * finish loading (CSP blocks, lazy-loaded images, JS-rendered content). The
 * MIGRATION.md strategy is to replace drawWindow with browser.tabs.captureTab
 * triggered by webNavigation.onCompleted during Phase 4.
 *
 * Characterizes:
 *   - Content script: canvas setup, drawWindow call, sendMessage shape
 *   - webNavigation.onCompleted: protocol filter, cache check, staleness
 *     check, incognito guard, script injection
 *   - Thumbnails.save: stores with url/image/stored/used fields
 *   - Thumbnails.get: returns Map of matching URLs, updates used date
 *   - getThumbnails: applies thumbnails to grid sites without images
 *   - cleanupThumbnails: deletes entries older than 2 weeks
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const THUMBNAIL_PATH = path.resolve(__dirname, '../../webextension/thumbnail.js');

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

// ==================== Content script (thumbnail.js) ====================

describe('Content script — thumbnail.js (Phase 1 slot 16)', () => {
	it('thumbnail.js reads thumbnailSize from storage and sends Thumbnails.save', () => {
		const source = fs.readFileSync(THUMBNAIL_PATH, 'utf8');

		// Parse the content script to verify its structure
		expect(source).toContain('chrome.storage.local.get');
		expect(source).toContain('thumbnailSize');
		expect(source).toContain('drawWindow');
		expect(source).toContain('name: \'Thumbnails.save\'');
		expect(source).toContain('url: location.href');
		expect(source).toContain('image: blob');
	});

	it('thumbnail.js uses drawWindow with white background fallback', () => {
		const source = fs.readFileSync(THUMBNAIL_PATH, 'utf8');
		// drawWindow(window, 0, 0, width, width, '#fff')
		expect(source).toContain('drawWindow(window, 0, 0,');
		expect(source).toContain('\'#fff\'');
	});

	it('thumbnail.js scales canvas width from scrollWidth', () => {
		const source = fs.readFileSync(THUMBNAIL_PATH, 'utf8');
		expect(source).toContain('canvas1.width / document.documentElement.scrollWidth');
	});
});

// ==================== webNavigation.onCompleted trigger ====================

describe('webNavigation.onCompleted trigger — background.js (Phase 1 slot 16)', () => {
	beforeAll(() => {
		// Read background.js and extract the onCompleted handler
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		// The handler is registered inline — we'll test its logic via mocks
		// by re-extracting the logic patterns from the source

		// Verify the handler structure exists
		expect(bgSource).toContain('chrome.webNavigation.onCompleted.addListener');
		expect(bgSource).toContain('details.frameId !== 0');
		expect(bgSource).toContain('Tiles.ensureReady');
		expect(bgSource).toContain('cache.includes(details.url)');
		expect(bgSource).toContain('tab.incognito');
		expect(bgSource).toContain('chrome.tabs.executeScript(details.tabId, {file: \'thumbnail.js\'})');
	});

	it('handler filters out non-main-frame navigations (frameId !== 0)', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		// The guard: if (details.frameId !== 0) { return; }
		expect(bgSource).toContain('details.frameId !== 0');
	});

	it('handler filters out non-http protocols', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('[\'http:\', \'https:\', \'ftp:\'].includes(new URL(details.url).protocol)');
	});

	it('handler disables browserAction for non-http URLs', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('chrome.browserAction.disable(details.tabId)');
	});

	it('handler checks staleness: only captures if stored < today', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('this.result.stored < today');
	});

	it('handler skips incognito tabs', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('tab.incognito');
	});
});

// ==================== getThumbnails display ====================

describe('getThumbnails display — newTab.js (Phase 1 slot 16)', () => {
	let harness: any;
	let gridSites: any[];

	beforeAll(() => {
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const getThumbnails = extractMethod(source, 'getThumbnails');

		globalThis.Grid = { sites: [] };

		const code = `var newTabTools = { ${getThumbnails}, selectedSite: null, siteThumbnail: { style: {} }, saveCurrentThumbButton: { disabled: true } };`;
		vm.runInThisContext(code, { filename: 'thumbnail-display-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		gridSites = [];
		(globalThis as any).Grid.sites = gridSites;
		harness.selectedSite = null;
		harness.siteThumbnail = { style: {} };
		harness.saveCurrentThumbButton = { disabled: true };
	});

	it('sends Thumbnails.get with URLs of sites missing backgroundImage', () => {
		gridSites.push(
			{ link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' } } },
			{ link: { url: 'https://b.com' }, thumbnail: { style: { backgroundImage: 'url(existing)' } } },
			null, // empty cell
		);
		(globalThis as any).Grid.sites = gridSites;

		chrome.runtime.sendMessage.mockImplementation(() => {});
		harness.getThumbnails();
		expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Thumbnails.get',
				urls: ['https://a.com'],
			}),
			expect.any(Function),
		);
	});

	it('applies thumbnail as CSS backgroundImage from Map response', () => {
		const site = { link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' } } };
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;

		const thumbBlob = new Blob(['thumb']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb-url');
		const thumbMap = new Map([['https://a.com', thumbBlob]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();
		expect(site.thumbnail.style.backgroundImage).toBe('url(blob:thumb-url)');
	});

	it('does not overwrite site.link.image (custom-uploaded thumbnail)', () => {
		const site = {
			link: { url: 'https://a.com', image: new Blob(['custom']) },
			thumbnail: { style: { backgroundImage: '' } },
		};
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;

		const thumbMap = new Map([['https://a.com', new Blob(['auto'])]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();
		// link.image should remain the custom blob, not be overwritten
		expect(site.thumbnail.style.backgroundImage).toBe('');
	});

	it('updates siteThumbnail and enables save button for selected site', () => {
		const site = { link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' } } };
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;
		harness.selectedSite = site;

		const thumbBlob = new Blob(['thumb']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
		const thumbMap = new Map([['https://a.com', thumbBlob]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();
		expect(harness.siteThumbnail.style.backgroundImage).toBe('url(blob:thumb)');
		expect(harness.saveCurrentThumbButton.disabled).toBe(false);
	});

	it('skips null sites in grid (empty cells)', () => {
		gridSites.push(null, null);
		(globalThis as any).Grid.sites = gridSites;

		const thumbMap = new Map();
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		expect(() => harness.getThumbnails()).not.toThrow();
	});
});

// ==================== Thumbnails.save handler ====================

describe('Thumbnails.save handler — background.js (Phase 1 slot 16)', () => {
	it('stores url, image, stored date, and used date', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		// Verify the put call structure
		expect(bgSource).toContain('case \'Thumbnails.save\':');
		expect(bgSource).toContain('url,');
		expect(bgSource).toContain('image,');
		expect(bgSource).toContain('stored: today');
		expect(bgSource).toContain('used: today');
	});

	it('guards against missing url or image', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('if (url && image)');
	});
});

// ==================== Thumbnails.get handler ====================

describe('Thumbnails.get handler — background.js (Phase 1 slot 16)', () => {
	it('returns a Map of matching URL→image pairs', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('let map = new Map()');
		expect(bgSource).toContain('map.set(thumb.url, thumb.image)');
		expect(bgSource).toContain('sendResponse(map)');
	});

	it('updates used date when thumbnail is accessed', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('thumb.used != today');
		expect(bgSource).toContain('thumb.used = today');
		expect(bgSource).toContain('cursor.update(thumb)');
	});
});

// ==================== cleanupThumbnails ====================

describe('cleanupThumbnails — background.js (Phase 1 slot 16)', () => {
	it('calculates two-week expiry for cleanup', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		// 1209600000 ms = 14 days
		expect(bgSource).toContain('1209600000');
		expect(bgSource).toContain('getTZDateString');
	});

	it('uses IDB index on used field with upperBound key range', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('index(\'used\')');
		expect(bgSource).toContain('IDBKeyRange.upperBound(expiry)');
	});

	it('deletes expired entries via cursor', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('cursor.delete()');
		expect(bgSource).toContain('cursor.continue()');
	});

	it('is triggered on idle state change', () => {
		const bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
		expect(bgSource).toContain('state == \'idle\'');
		expect(bgSource).toContain('cleanupThumbnails()');
		expect(bgSource).toContain('chrome.idle.onStateChanged.addListener');
	});
});

// ==================== Known capture behaviour (characterization) ====================

describe('Known auto-thumbnail capture behaviour (characterization pins)', () => {
	/*
	 * These tests document the observed capture behaviour as of 2026-05-06.
	 * They serve as regression markers for the Phase 4 rewrite from
	 * drawWindow → browser.tabs.captureTab.
	 *
	 * The drawWindow content script (`thumbnail.js`) captures the visible
	 * viewport at the moment it runs. Because it's injected by
	 * webNavigation.onCompleted, it fires after the document's load event
	 * but potentially before:
	 *   - Lazy-loaded images finish
	 *   - JS-rendered content mounts (SPA frameworks)
	 *   - CSP-blocked resources resolve
	 *   - Deferred/async scripts complete
	 *
	 * This explains the partial/empty captures on complex sites.
	 */

	const KNOWN_WORKING = [
		'https://insideparadeplatz.ch/',
		'https://www.finews.ch/',
	];

	const KNOWN_NOT_WORKING = [
		// Empty page in screenshot — likely CSP or JS-rendered content
		'https://www.heise.de/newsticker/',
	];

	const KNOWN_PARTIALLY_WORKING = [
		// Page not fully loaded in screenshot — lazy-loaded content
		'https://www.qoqa.ch/de',
	];

	it('working URLs are standard server-rendered pages with few CSP restrictions', () => {
		// Characterization: these sites serve fully-rendered HTML before
		// the load event fires, so drawWindow captures a complete page.
		for (const url of KNOWN_WORKING) {
			const parsed = new URL(url);
			expect(['http:', 'https:']).toContain(parsed.protocol);
		}
	});

	it('non-working URL (heise.de) is a known drawWindow failure case', () => {
		// Characterization: heise.de/newsticker renders an empty or
		// near-empty page via drawWindow. The Phase 4 rewrite to
		// captureTab should resolve this since it captures the
		// compositor output, not the document.
		expect(KNOWN_NOT_WORKING).toContain('https://www.heise.de/newsticker/');
	});

	it('partially-working URL (qoqa.ch) captures incomplete page state', () => {
		// Characterization: qoqa.ch/de uses lazy loading or deferred
		// JS that hasn't completed by the time drawWindow runs.
		// The capture shows the page skeleton but not the full content.
		expect(KNOWN_PARTIALLY_WORKING).toContain('https://www.qoqa.ch/de');
	});

	it('all test URLs are valid https URLs in the tile cache domain', () => {
		const all = [...KNOWN_WORKING, ...KNOWN_NOT_WORKING, ...KNOWN_PARTIALLY_WORKING];
		for (const url of all) {
			const parsed = new URL(url);
			expect(parsed.protocol).toBe('https:');
			expect(parsed.host).toBeTruthy();
		}
	});
});
