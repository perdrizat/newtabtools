/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Audit 2026-06-10 §4.3/§8.7.4 — object-URL hygiene in newTab.js.
 *
 * Blob URLs are only freed on document unload, so every repeated-render site
 * must revoke its prior URL before creating a replacement (the
 * fx-newTab.js `refreshThumbnail` pattern: stash on the owner, revoke on
 * replace). These tests drive the real methods (vm-extracted) and assert the
 * revocation contract on the three highest-churn sites the audit flagged:
 *
 *   - `refreshBackgroundImage` — wallpaper blob re-rendered on pref changes
 *   - `getThumbnails`          — per-site IDB thumbnails (stash shared with
 *                                fx-newTab's `_thumbnailObjectURL` so a later
 *                                capture's refreshThumbnail revokes ours)
 *   - `refreshRecent`          — favicon blobs, cards rebuilt every refresh
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

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

// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
const source = fs.readFileSync(NEWTAB_PATH, 'utf8');

let urlCounter = 0;
let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	urlCounter = 0;
	createSpy = vi.fn(() => `blob:fake-${++urlCounter}`);
	revokeSpy = vi.fn();
	(URL as any).createObjectURL = createSpy;
	(URL as any).revokeObjectURL = revokeSpy;
});

describe('object-URL helper — _freshObjectURL / _dropObjectURL', () => {
	let harness: any;

	beforeAll(() => {
		const fresh = extractMethod(source, '_freshObjectURL');
		const drop = extractMethod(source, '_dropObjectURL');
		vm.runInThisContext(
			`var _urlHarness = { ${fresh}, ${drop}, _objectURLs: {} };`,
			{ filename: 'objecturl-harness.js' },
		);
		harness = (globalThis as any)._urlHarness;
	});

	beforeEach(() => { harness._objectURLs = {}; });

	it('first use creates without revoking; replacement revokes the prior URL', () => {
		const url1 = harness._freshObjectURL('bg', new Blob(['a']));
		expect(url1).toBe('blob:fake-1');
		expect(revokeSpy).not.toHaveBeenCalled();
		const url2 = harness._freshObjectURL('bg', new Blob(['b']));
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		expect(url2).toBe('blob:fake-2');
	});

	it('keys are independent owners', () => {
		harness._freshObjectURL('bg', new Blob(['a']));
		harness._freshObjectURL('editorThumb', new Blob(['b']));
		expect(revokeSpy).not.toHaveBeenCalled();
	});

	it('_dropObjectURL revokes and forgets; double-drop is a no-op', () => {
		harness._freshObjectURL('bg', new Blob(['a']));
		harness._dropObjectURL('bg');
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		harness._dropObjectURL('bg');
		expect(revokeSpy).toHaveBeenCalledTimes(1);
	});
});

describe('refreshBackgroundImage — wallpaper blob revoked on re-render', () => {
	let harness: any;

	beforeAll(() => {
		const refresh = extractMethod(source, 'refreshBackgroundImage');
		const fresh = extractMethod(source, '_freshObjectURL');
		const drop = extractMethod(source, '_dropObjectURL');
		vm.runInThisContext(
			`var _bgHarness = { ${refresh}, ${fresh}, ${drop}, _objectURLs: {} };`,
			{ filename: 'bg-harness.js' },
		);
		harness = (globalThis as any)._bgHarness;
	});

	beforeEach(() => {
		harness._objectURLs = {};
		harness.backgroundFake = { style: {} };
		harness.removeBackgroundButton = { disabled: false, blur: vi.fn() };
		(globalThis as any).Prefs = { backgroundUrl: '', backgroundColor: '', backgroundPosition: '' };
		(globalThis as any).Background = { getBackground: vi.fn().mockResolvedValue(new Blob(['img'])) };
	});

	it('two consecutive IDB-blob renders revoke the first URL', async () => {
		await harness.refreshBackgroundImage();
		expect(document.body.style.backgroundImage).toContain('blob:fake-1');
		expect(revokeSpy).not.toHaveBeenCalled();
		await harness.refreshBackgroundImage();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		expect(document.body.style.backgroundImage).toContain('blob:fake-2');
	});

	it('switching to a CDN wallpaper revokes the stale blob URL', async () => {
		await harness.refreshBackgroundImage();
		(globalThis as any).Prefs.backgroundUrl = 'https://firefox-settings-attachments.cdn.mozilla.net/x.jpg';
		await harness.refreshBackgroundImage();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
	});

	it('clearing the background (no blob, no prefs) revokes the stale blob URL', async () => {
		await harness.refreshBackgroundImage();
		(globalThis as any).Background.getBackground = vi.fn().mockResolvedValue(null);
		await harness.refreshBackgroundImage();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
	});
});

describe('getThumbnails — per-site stash, revoked on replace', () => {
	let harness: any;
	let site: any;
	let thumbsMap: Map<string, Blob>;

	beforeAll(() => {
		const getThumbnails = extractMethod(source, 'getThumbnails');
		vm.runInThisContext(
			`var _thumbHarness = { ${getThumbnails} };`,
			{ filename: 'thumbs-harness.js' },
		);
		harness = (globalThis as any)._thumbHarness;
	});

	beforeEach(() => {
		site = {
			link: { url: 'https://example.com/' },
			thumbnail: { style: {}, querySelector: vi.fn(() => null) },
		};
		thumbsMap = new Map([['https://example.com/', new Blob(['t'])]]);
		(globalThis as any).Grid = { sites: [site] };
		(globalThis as any).newTabTools = {
			getFavicons: vi.fn(),
			selectedSite: null,
			siteThumbnail: { style: {} },
			saveCurrentThumbButton: { disabled: true },
		};
		(globalThis as any).chrome = {
			runtime: { sendMessage: vi.fn((_msg: unknown, cb: (m: Map<string, Blob>) => void) => cb(thumbsMap)) },
		};
	});

	it('stashes the created URL on the site (shared with fx-newTab refreshThumbnail)', () => {
		harness.getThumbnails();
		expect(site.thumbnail.style.backgroundImage).toContain('blob:fake-1');
		expect(site._thumbnailObjectURL).toBe('blob:fake-1');
	});

	it('re-rendering the same site revokes the prior URL', () => {
		harness.getThumbnails();
		// Simulate a grid refresh that cleared the tile's background, so the
		// site is re-requested and gets a fresh object URL.
		site.thumbnail.style.backgroundImage = '';
		harness.getThumbnails();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		expect(site._thumbnailObjectURL).toBe('blob:fake-2');
	});
});

describe('refreshRecent — favicon blob URLs revoked on rebuild', () => {
	let harness: any;
	let faviconsByHost: Map<string, Blob>;

	function makeMockElement(): any {
		const children: any[] = [];
		return {
			href: '', className: '', title: '', style: {}, dataset: {},
			onclick: null, childNodes: [],
			appendChild: vi.fn((child: any) => { children.push(child); return child; }),
			_children: children,
		};
	}

	beforeAll(() => {
		const refreshRecent = extractMethod(source, 'refreshRecent');
		const trimRecent = extractMethod(source, 'trimRecent');
		const isValidURL = extractMethod(source, 'isValidURL');
		const _formatAge = extractMethod(source, '_formatAge');
		vm.runInThisContext(
			`var newTabTools = { ${refreshRecent}, ${trimRecent}, ${isValidURL}, ${_formatAge}, recentList: null, _layoutResult: { cardCount: 10, slotWidth: 186, searchWidth: 186 }, _layoutTitlebar() { return this._layoutResult; } };`,
			{ filename: 'recent-revoke-harness.js' },
		);
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		harness._recentFaviconURLs = undefined;
		harness.recentList = {
			hidden: false,
			querySelectorAll: vi.fn(() => []),
			removeChild: vi.fn(),
			appendChild: vi.fn((el: any) => el),
		};
		harness._layoutResult = { cardCount: 10, slotWidth: 186, searchWidth: 186 };
		faviconsByHost = new Map([['example.com', new Blob(['f'])]]);
		(globalThis as any).Prefs = { recent: true };
		const items = [
			// No session favIconUrl → falls back to the stored (Blob) favicon.
			{ tab: { url: 'https://example.com/article', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(globalThis as any).chrome = {
			sessions: { getRecentlyClosed: vi.fn((cb: (i: unknown[]) => void) => cb(items)) },
			runtime: {
				sendMessage: vi.fn((msg: any, cb: (m: Map<string, Blob>) => void) => {
					if (msg && msg.name === 'Thumbnails.getFaviconsByHost') { cb(faviconsByHost); }
				}),
			},
		};
		// `refreshRecent` builds 'img' elements via one shape and everything else
		// (the 'a'/'span' card structure) via `makeMockElement`'s generic shape —
		// both now go through `document.createElement` (no more createElementNS
		// namespace split), so the mock dispatches on the tag name.
		document.createElement = vi.fn((tag: string) =>
			tag === 'img'
				? { classList: { add: vi.fn() }, onerror: null, src: '', remove: vi.fn() }
				: makeMockElement(),
		) as any;
		document.createTextNode = vi.fn((text: string) => ({ textContent: text })) as any;
	});

	it('creates a blob URL for a stored favicon and records it for revocation', () => {
		harness.refreshRecent();
		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(harness._recentFaviconURLs).toContain('blob:fake-1');
	});

	it('the next rebuild revokes the prior render\'s favicon URLs', () => {
		harness.refreshRecent();
		expect(revokeSpy).not.toHaveBeenCalled();
		harness.refreshRecent();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
	});
});
