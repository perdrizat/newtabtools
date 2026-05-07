/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: recently-closed-tabs row + one-click restore.
 * Phase 1 slot 14 of the migration plan (MIGRATION.md).
 *
 * Extracts `refreshRecent`, `trimRecent`, and `isValidURL` from the real
 * `newTab.js` via `vm.runInThisContext` and exercises the recently-closed
 * tabs logic with mocked `chrome.sessions` and DOM.
 *
 * Characterizes:
 *   - refreshRecent: hides list when Prefs.recent is false
 *   - refreshRecent: clears existing items before rebuilding
 *   - refreshRecent: creates anchor elements from session items
 *   - refreshRecent: skips incognito tabs
 *   - refreshRecent: skips items without a tab property
 *   - refreshRecent: sets title, href, sessionId, onclick handler
 *   - refreshRecent: adds favicon img when favIconUrl is valid
 *   - refreshRecent: hides list when no items added
 *   - refreshRecent: shows list when items added
 *   - onclick handler calls chrome.sessions.restore with sessionId
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

describe('Recently-closed tabs — newTab.js (Phase 1 slot 14)', () => {
	let harness: any;
	let recentList: any;
	let appendedElements: any[];

	beforeAll(() => {
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const refreshRecent = extractMethod(source, 'refreshRecent');
		const trimRecent = extractMethod(source, 'trimRecent');
		const isValidURL = extractMethod(source, 'isValidURL');

		globalThis.Prefs = { recent: true };
		(globalThis as any).HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

		chrome.sessions = {
			getRecentlyClosed: vi.fn(),
			restore: vi.fn(),
			onChanged: { addListener: vi.fn() },
		} as any;

		const code = `var newTabTools = { ${refreshRecent}, ${trimRecent}, ${isValidURL}, recentList: null, recentListOuter: null };`;
		vm.runInThisContext(code, { filename: 'recent-tabs-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		Prefs.recent = true;
		appendedElements = [];

		recentList = {
			hidden: false,
			querySelectorAll: vi.fn(() => []),
			removeChild: vi.fn(),
			appendChild: vi.fn((el: any) => appendedElements.push(el)),
			style: { width: '' },
			offsetLeft: 0,
		};
		harness.recentList = recentList;
		harness.recentListOuter = { clientWidth: 800 };

		// Mock DOM creation
		document.createElementNS = vi.fn((_ns: string, _tag: string) => {
			const children: any[] = [];
			const el: any = {
				href: '',
				className: '',
				title: '',
				dataset: {},
				onclick: null,
				appendChild: vi.fn((child: any) => children.push(child)),
				_children: children,
			};
			return el;
		}) as any;

		document.createElement = vi.fn((_tag: string) => {
			return {
				classList: { add: vi.fn() },
				onerror: null,
				src: '',
			};
		}) as any;

		document.createTextNode = vi.fn((text: string) => ({ textContent: text })) as any;
	});

	// ==================== Prefs.recent guard ====================

	it('hides recent list when Prefs.recent is false', () => {
		Prefs.recent = false;
		harness.refreshRecent();
		expect(recentList.hidden).toBe(true);
		expect(chrome.sessions.getRecentlyClosed).not.toHaveBeenCalled();
	});

	it('calls chrome.sessions.getRecentlyClosed when Prefs.recent is true', () => {
		harness.refreshRecent();
		expect(chrome.sessions.getRecentlyClosed).toHaveBeenCalledWith(expect.any(Function));
	});

	// ==================== clearing existing items ====================

	it('removes existing anchor elements before rebuilding', () => {
		const existingA = { tagName: 'A' };
		recentList.querySelectorAll.mockReturnValue([existingA]);
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb([]));
		harness.refreshRecent();
		expect(recentList.removeChild).toHaveBeenCalledWith(existingA);
	});

	// ==================== creating items ====================

	it('creates anchor elements from session tab items', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(recentList.appendChild).toHaveBeenCalledTimes(1);
		const anchor = appendedElements[0];
		expect(anchor.href).toBe('https://example.com');
		expect(anchor.className).toBe('recent');
		expect(anchor.dataset.sessionId).toBe('s1');
	});

	it('sets title with title and URL when both differ', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Example', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		expect(anchor.title).toBe('Example\nhttps://example.com');
	});

	it('sets title to just URL when title equals URL', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'https://example.com', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		expect(anchor.title).toBe('https://example.com');
	});

	it('sets title to empty when title is empty', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: '', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		expect(anchor.title).toBe('');
	});

	// ==================== skipping items ====================

	it('skips incognito tabs', () => {
		const items = [
			{ tab: { url: 'https://private.com', title: 'Private', sessionId: 's1', favIconUrl: null, incognito: true } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(recentList.appendChild).not.toHaveBeenCalled();
	});

	it('skips items without a tab property (window sessions)', () => {
		const items = [
			{ window: { sessionId: 'w1' } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(recentList.appendChild).not.toHaveBeenCalled();
	});

	// ==================== favicon ====================

	it('adds favicon img when favIconUrl is valid', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: 'https://example.com/favicon.ico', incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		// anchor should have two children: favicon img + text node
		expect(anchor.appendChild).toHaveBeenCalledTimes(2);
		const favicon = anchor.appendChild.mock.calls[0][0];
		expect(favicon.src).toBe('https://example.com/favicon.ico');
	});

	it('does not add favicon when favIconUrl is falsy', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		// Only text node child
		expect(anchor.appendChild).toHaveBeenCalledTimes(1);
	});

	it('does not add favicon when favIconUrl has invalid protocol', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: 'Ex', sessionId: 's1', favIconUrl: 'javascript:alert(1)', incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		expect(anchor.appendChild).toHaveBeenCalledTimes(1);
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
		const anchor = appendedElements[0];
		// Call onclick with the anchor as `this`
		const result = anchor.onclick.call(anchor);
		expect(chrome.sessions.restore).toHaveBeenCalledWith('abc123');
		expect(result).toBe(false);
	});

	// ==================== multiple items ====================

	it('creates multiple anchors for multiple valid tabs', () => {
		const items = [
			{ tab: { url: 'https://a.com', title: 'A', sessionId: 's1', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://b.com', title: 'B', sessionId: 's2', favIconUrl: null, incognito: false } },
			{ tab: { url: 'https://c.com', title: 'C', sessionId: 's3', favIconUrl: null, incognito: true } }, // skipped
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		expect(appendedElements).toHaveLength(2);
	});

	// ==================== text content fallback ====================

	it('uses URL as text when title is empty', () => {
		const items = [
			{ tab: { url: 'https://example.com', title: '', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(chrome.sessions.getRecentlyClosed as any).mockImplementation((cb: any) => cb(items));
		harness.refreshRecent();
		const anchor = appendedElements[0];
		const textNode = anchor.appendChild.mock.calls[0][0];
		expect(textNode.textContent).toBe('https://example.com');
	});
});
