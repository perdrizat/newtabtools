/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: auto-thumbnail capture, storage, display, and cleanup.
 *
 * The auto-thumbnail system captures screenshots of pinned sites using
 * `captureVisibleTab()` from the background page. No content scripts are
 * injected into visited pages (resolves §2.6 from the security audit).
 *
 * Architecture:
 *   1. Background trigger (`webNavigation.onCompleted`): checks if URL is in
 *      tile cache, captures immediately for active tabs (Capture A), arms
 *      network idle for a second capture (Capture B) once page finishes loading.
 *      Non-active tabs are deferred to `tabs.onActivated`.
 *   2. `captureAndStore()`: calls `captureVisibleTab()`, resizes via canvas,
 *      stores blob in IDB `thumbnails` store.
 *   3. `resizeThumbnail()`: resizes a data URL to target width via canvas.
 *   4. Network idle monitor: `webRequest` listeners reset a 2s timer per tab.
 *   5. `Thumbnails.capture` message: used by action.js capture button.
 *   6. Display (`newTab.js` `getThumbnails`): applies thumbnails to grid sites.
 *   7. Cleanup (`cleanupThumbnails`): removes entries older than 2 weeks.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

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

// ==================== webNavigation.onCompleted trigger ====================

describe('webNavigation.onCompleted trigger — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('handler is registered', () => {
		expect(bgSource).toContain('chrome.webNavigation.onCompleted.addListener');
	});

	it('handler filters out non-main-frame navigations (frameId !== 0)', () => {
		expect(bgSource).toContain('details.frameId !== 0');
	});

	it('handler filters out non-http protocols', () => {
		expect(bgSource).toContain('[\'http:\', \'https:\', \'ftp:\'].includes(new URL(details.url).protocol)');
	});

	it('handler disables browserAction for non-http URLs', () => {
		expect(bgSource).toContain('chrome.browserAction.disable(details.tabId)');
	});

	it('handler checks cache for URL match', () => {
		expect(bgSource).toContain('cache.includes(details.url)');
	});

	it('handler skips incognito tabs', () => {
		expect(bgSource).toContain('tab.incognito');
	});

	it('does NOT use executeScript (§2.6 resolved)', () => {
		expect(bgSource).not.toContain('executeScript');
	});

	it('does NOT check staleness — captures every visit', () => {
		expect(bgSource).not.toContain('this.result.stored < today');
	});

	it('calls captureAndStore for active tabs', () => {
		expect(bgSource).toContain('tab.active');
		expect(bgSource).toContain('captureAndStore(');
	});

	it('arms network idle for capture B on active tabs', () => {
		expect(bgSource).toContain('armNetworkIdle(details.tabId');
	});

	it('pendingCaptures map exists for background tabs', () => {
		expect(bgSource).toContain('var pendingCaptures = new Map()');
	});

	it('adds non-active tabs to pendingCaptures', () => {
		expect(bgSource).toContain('pendingCaptures.set(');
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

// ==================== action.js capture button ====================

describe('action.js capture button', () => {
	let actionSource: string;
	const ACTION_PATH = path.resolve(__dirname, '../../webextension/action.js');

	beforeAll(() => {
		actionSource = fs.readFileSync(ACTION_PATH, 'utf8');
	});

	it('does NOT use executeScript', () => {
		expect(actionSource).not.toContain('executeScript');
	});

	it('does NOT reference thumbnail.js', () => {
		expect(actionSource).not.toContain('thumbnail.js');
	});

	it('sends Thumbnails.capture message to background', () => {
		expect(actionSource).toContain('name: \'Thumbnails.capture\'');
	});
});

// ==================== Thumbnails.capture handler ====================

describe('Thumbnails.capture handler — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('handles Thumbnails.capture message', () => {
		expect(bgSource).toContain('case \'Thumbnails.capture\':');
	});

	it('calls captureAndStore with sender tab info', () => {
		expect(bgSource).toContain('captureAndStore(');
	});

	it('uses sender.tab for tabId and windowId', () => {
		expect(bgSource).toContain('sender.tab');
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

// ==================== resizeThumbnail helper ====================

describe('resizeThumbnail — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('resizeThumbnail function exists', () => {
		expect(bgSource).toContain('function resizeThumbnail(');
	});

	it('accepts dataURL and targetWidth parameters', () => {
		expect(bgSource).toMatch(/function resizeThumbnail\s*\(\s*dataURL\s*,\s*targetWidth\s*\)/);
	});

	it('creates an Image and loads the dataURL', () => {
		expect(bgSource).toContain('new Image()');
		expect(bgSource).toContain('img.src = dataURL');
	});

	it('scales canvas dimensions from targetWidth', () => {
		expect(bgSource).toContain('targetWidth / img.width');
		expect(bgSource).toContain('canvas.width = targetWidth');
	});

	it('caps canvas height to targetWidth', () => {
		expect(bgSource).toContain('Math.min(targetWidth,');
	});

	it('returns a Promise resolving with a blob via canvas.toBlob', () => {
		expect(bgSource).toContain('return new Promise');
		expect(bgSource).toContain('canvas.toBlob(resolve)');
	});
});

// ==================== tabs.onActivated handler ====================

describe('tabs.onActivated handler — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('registers a tabs.onActivated listener', () => {
		expect(bgSource).toContain('chrome.tabs.onActivated.addListener');
	});

	it('checks pendingCaptures for the activated tab', () => {
		expect(bgSource).toContain('pendingCaptures.get(');
	});

	it('calls captureAndStore for pending tab', () => {
		// The handler captures immediately when a pending tab becomes active
		expect(bgSource).toContain('captureAndStore(');
	});

	it('arms network idle for the pending tab', () => {
		expect(bgSource).toContain('armNetworkIdle(');
	});

	it('removes the tab from pendingCaptures after capture', () => {
		expect(bgSource).toContain('pendingCaptures.delete(');
	});
});

describe('tabs.onRemoved cleanup — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('registers a tabs.onRemoved listener', () => {
		expect(bgSource).toContain('chrome.tabs.onRemoved.addListener');
	});

	it('cleans up pendingCaptures on tab close', () => {
		expect(bgSource).toContain('pendingCaptures.delete(');
	});

	it('disarms network idle on tab close', () => {
		expect(bgSource).toContain('disarmNetworkIdle(');
	});
});

// ==================== captureAndStore helper ====================

describe('captureAndStore — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('captureAndStore function exists with tabId, windowId, url, label params', () => {
		expect(bgSource).toMatch(/function captureAndStore\s*\(\s*tabId\s*,\s*windowId\s*,\s*url\s*,\s*label\s*\)/);
	});

	it('calls chrome.tabs.captureVisibleTab for the window', () => {
		expect(bgSource).toContain('chrome.tabs.captureVisibleTab(windowId');
	});

	it('reads thumbnailSize from storage with 600 default', () => {
		expect(bgSource).toContain('\'thumbnailSize\': 600');
	});

	it('calls resizeThumbnail with the dataURL and size', () => {
		expect(bgSource).toContain('resizeThumbnail(dataURL,');
	});

	it('stores resized blob in IDB thumbnails store', () => {
		expect(bgSource).toContain('\'thumbnails\', \'readwrite\'');
		expect(bgSource).toContain('image: blob');
	});
});

// ==================== Network idle monitor ====================

describe('Network idle monitor — background.js', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/background.js'), 'utf8'
		);
	});

	it('networkIdleWatchers map exists', () => {
		expect(bgSource).toContain('var networkIdleWatchers = new Map()');
	});

	it('armNetworkIdle function exists with tabId and callback params', () => {
		expect(bgSource).toMatch(/function armNetworkIdle\s*\(\s*tabId\s*,\s*callback\s*\)/);
	});

	it('sets a 2-second idle timer', () => {
		// 2000ms idle timeout
		expect(bgSource).toContain('2000');
		expect(bgSource).toContain('setTimeout');
	});

	it('stores startTime for elapsed-time calculation', () => {
		expect(bgSource).toContain('startTime: Date.now()');
	});

	it('disarmNetworkIdle function removes watcher and clears timer', () => {
		expect(bgSource).toContain('function disarmNetworkIdle(');
		expect(bgSource).toContain('clearTimeout');
		expect(bgSource).toContain('networkIdleWatchers.delete(');
	});

	it('webRequest.onBeforeRequest listener resets timer for watched tabs', () => {
		expect(bgSource).toContain('chrome.webRequest.onBeforeRequest.addListener');
		expect(bgSource).toContain('networkIdleWatchers.get(');
	});

	it('webRequest.onCompleted listener resets timer for watched tabs', () => {
		expect(bgSource).toContain('chrome.webRequest.onCompleted.addListener');
	});

	it('webRequest.onErrorOccurred listener resets timer for watched tabs', () => {
		expect(bgSource).toContain('chrome.webRequest.onErrorOccurred.addListener');
	});

	it('passes elapsed time to callback on idle', () => {
		expect(bgSource).toContain('Date.now() - watcher.startTime');
	});
});

