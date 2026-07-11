/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phase 4-3 — Awesome bar DOM/browser wiring. Natively imports the real
 * awesomebar.js and exercises init → render → keyboard-nav → activate with
 * mocked WebExtension APIs. (The pure result model is covered in
 * awesomebar.test.ts; live `/` interception + real search in the E2E tier.)
 *
 * PAGE_MODULES.md P4: awesomebar.js now real-imports `NttIcons`/`Prefs`
 * (icons.js/prefs.js gained `export`s in P2/P3) instead of reading them as
 * bare globals, so this suite can no longer stand up a stub via
 * `globalThis.NttIcons = {...}` / `globalThis.Prefs = {...}` before a vm load
 * — a replacement object would be invisible to the real import binding (the
 * same P3 tiles-store.js gotcha, PAGE_MODULES.md's "second-order fallout").
 * `NttIcons` is the real singleton (its `create()` works fine against jsdom's
 * `document.createElementNS`, so no stub is needed); `Prefs` is the real
 * singleton too, mutated in place per test (`Prefs.titleBarSearch = ...`)
 * rather than replaced.
 *
 * P2-P5 review finding 1 (revised remediation, 2026-07-10): `Grid`/
 * `newTabTools` are gone from this file entirely. `getString`/`isValidURL`
 * are the real common.js imports (backed by the real `chrome.i18n.getMessage`
 * — this suite's local `chrome` mock below includes `i18n.getMessage` so they
 * resolve, echoing the key like `tests/setup.js`'s global mock does); the
 * tiles list is injected via `AwesomeBar.init({ tilesSource })` instead of a
 * `globalThis.Grid` stand-in.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AwesomeBar } from '../../webextension/awesomebar.js';
import { getString } from '../../webextension/common.js';
import { Prefs } from '../../webextension/prefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('AwesomeBar — DOM wiring', () => {
	let tabsUpdate: any;
	let tabsCreate: any;
	let searchSearch: any;
	let originalTitleBarSearch: boolean;

	beforeAll(() => {
		originalTitleBarSearch = Prefs.titleBarSearch;
	});

	afterEach(() => {
		Prefs.titleBarSearch = originalTitleBarSearch;
	});

	beforeEach(() => {
		document.documentElement.removeAttribute('awesomebar-open');
		document.body.innerHTML = `
			<div id="ntt-search">
				<input id="ntt-search-input" type="text" />
			</div>
		`;
		Prefs.titleBarSearch = true;
		tabsUpdate = vi.fn();
		tabsCreate = vi.fn();
		searchSearch = vi.fn();
		// chrome-prep C5a (CHROME_PREP.md): awesomebar.js now routes every call
		// through a single `api = globalThis.browser ?? chrome` namespace leaf,
		// so the mock must present one unified surface on whichever object
		// wins that precedence (`browser`) — a split mock (most of the surface
		// on `chrome`, `search` on `browser`) would leave e.g. `api.tabs`
		// undefined. `chrome` mirrors the same object so either name still
		// resolves it, matching jest-webextension-mock's own baseline
		// invariant (`browser`/`chrome` are aliases of one object).
		const mock = {
			i18n: { getMessage: (key: string) => key },
			tabs: { update: tabsUpdate, create: tabsCreate },
			bookmarks: { search: (_q: string, cb: (r: unknown[]) => void) => cb([]) },
			history: { search: (_o: unknown, cb: (r: unknown[]) => void) => cb([]) },
			permissions: { contains: (_p: unknown, cb: (g: boolean) => void) => cb(true) },
			search: { search: searchSearch },
		};
		(globalThis as any).chrome = mock;
		(globalThis as any).browser = mock;

		// Reset module instance state between tests.
		(AwesomeBar as any).dropdown = undefined;
		AwesomeBar._results = [];
		AwesomeBar._index = -1;
		AwesomeBar._permChecked = false;
		AwesomeBar.init({ tilesSource: () => [{ url: 'https://github.com/', title: 'GitHub' }] });
	});

	function render(query: string) {
		const results = AwesomeBar.buildResults(query, {
			tiles: [{ url: 'https://github.com/', title: 'GitHub' }],
			bookmarks: [{ url: 'https://gitlab.com/', title: 'GitLab' }],
			history: [{ url: 'https://git-scm.com/', title: 'Git SCM' }],
		});
		AwesomeBar._render(results);
		return results;
	}

	it('init creates the dropdown inside the search box, hidden', () => {
		const dd = document.getElementById('ntt-awesomebar');
		expect(dd).not.toBeNull();
		expect(dd!.parentElement!.id).toBe('ntt-search');
		expect((dd as HTMLElement).hidden).toBe(true);
	});

	it('render builds section headers + rows and opens the panel', () => {
		render('git');
		const dd = document.getElementById('ntt-awesomebar')!;
		expect(dd.hidden).toBe(false);
		expect(document.documentElement.hasAttribute('awesomebar-open')).toBe(true);
		const sections = [...dd.querySelectorAll('.ntt-awesomebar-section')].map(s => s.textContent);
		// Headers must be the i18n-resolved values (the mock getString echoes the
		// message key), never a raw English literal baked into awesomebar.js.
		expect(sections).toContain(getString('awesomebar_section_top'));
		expect(sections).toContain(getString('awesomebar_section_web'));
		expect(sections).not.toContain('Top match');
		expect(sections).not.toContain('Search the web');
		expect(dd.querySelectorAll('.ntt-awesomebar-row').length).toBeGreaterThan(1);
	});

	it('section labels are i18n message keys present in en/messages.json, not hardcoded English', () => {
		// The dropdown section headers were once a literal English map
		// (SECTION_LABELS: { top: 'Top match', … }) assigned via a computed
		// `OBJ[key] || key` lookup — a shape the ntt/no-hardcoded-text ESLint
		// rule cannot see statically. This guards the class at the contract
		// level: every label value must resolve to a real message key.
		// eslint-disable-next-line ntt/no-source-grep -- structural i18n contract check, not a behavioural source-grep
		const messages = JSON.parse(fs.readFileSync(
			path.resolve(__dirname, '../../webextension/_locales/en/messages.json'), 'utf8'));
		const labels = AwesomeBar.SECTION_LABELS as Record<string, string>;
		expect(Object.keys(labels).length).toBeGreaterThan(0);
		for (const [section, value] of Object.entries(labels)) {
			expect(
				messages,
				`SECTION_LABELS.${section} ("${value}") must be a key in en/messages.json, not literal text`,
			).toHaveProperty(value);
		}
	});

	it('the first row is selected on render', () => {
		render('git');
		const selected = document.querySelectorAll('#ntt-awesomebar .ntt-awesomebar-row.selected');
		expect(selected).toHaveLength(1);
		expect((selected[0] as HTMLElement).dataset.index).toBe('0');
	});

	it('ArrowDown moves the selection to the next row', () => {
		render('git');
		AwesomeBar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		const selected = document.querySelector('#ntt-awesomebar .ntt-awesomebar-row.selected') as HTMLElement;
		expect(selected.dataset.index).toBe('1');
	});

	it('Enter on a URL result opens it in the current tab', () => {
		render('git'); // index 0 = top match = github tile
		AwesomeBar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(tabsUpdate).toHaveBeenCalledWith({ url: 'https://github.com/' });
		expect(tabsCreate).not.toHaveBeenCalled();
	});

	it('Cmd/Ctrl+Enter opens the result in a new tab', () => {
		render('git');
		AwesomeBar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
		expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://github.com/' });
	});

	it('activating the web entry searches the default engine', () => {
		render('hello world');
		// Select the last row (the web entry) and hit Enter.
		const rows = document.querySelectorAll('#ntt-awesomebar .ntt-awesomebar-row');
		AwesomeBar._select(rows.length - 1);
		AwesomeBar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(searchSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'hello world', disposition: 'CURRENT_TAB' }));
	});

	it('Escape clears the input and closes the panel', () => {
		render('git');
		AwesomeBar.input.value = 'git';
		AwesomeBar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(AwesomeBar.input.value).toBe('');
		expect(document.getElementById('ntt-awesomebar')!.hidden).toBe(true);
		expect(document.documentElement.hasAttribute('awesomebar-open')).toBe(false);
	});

	it('"/" from elsewhere focuses the search input and is prevented', () => {
		// Focus something that is not an input.
		const grid = document.createElement('div');
		document.body.appendChild(grid);
		grid.tabIndex = -1;
		grid.focus();
		const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
		document.dispatchEvent(ev);
		expect(document.activeElement).toBe(AwesomeBar.input);
		expect(ev.defaultPrevented).toBe(true);
	});

	it('"/" while typing in an input is ignored (not hijacked)', () => {
		AwesomeBar.input.focus();
		const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
		document.dispatchEvent(ev);
		// Already in the search input → handler must not preventDefault.
		expect(ev.defaultPrevented).toBe(false);
	});

	it('_query wires the three sources through buildResults into the DOM', async () => {
		(globalThis as any).chrome.bookmarks.search = (_q: string, cb: (r: unknown[]) => void) =>
			cb([{ url: 'https://gitlab.com/', title: 'GitLab' }]);
		(globalThis as any).chrome.history.search = (_o: unknown, cb: (r: unknown[]) => void) =>
			cb([{ url: 'https://git-scm.com/', title: 'Git SCM' }]);
		AwesomeBar._query('git');
		await new Promise(r => setTimeout(r, 0));
		const urls = [...document.querySelectorAll('#ntt-awesomebar .ntt-awesomebar-url')].map(u => u.textContent);
		expect(urls).toContain('https://github.com/'); // tile
		expect(urls).toContain('https://gitlab.com/');  // bookmark
		expect(urls).toContain('https://git-scm.com/'); // history
	});

	it('without a tilesSource injected, _tiles() resolves empty and _query surfaces no tile-section result, without throwing (mirrors the old typeof-Grid-undefined degradation)', async () => {
		const original = (AwesomeBar as any)._tilesSource;
		(AwesomeBar as any)._tilesSource = null;
		try {
			await expect(AwesomeBar._tiles()).resolves.toEqual([]);
			(globalThis as any).chrome.bookmarks.search = (_q: string, cb: (r: unknown[]) => void) =>
				cb([{ url: 'https://gitlab.com/', title: 'GitLab' }]);
			expect(() => AwesomeBar._query('git')).not.toThrow();
			await new Promise(r => setTimeout(r, 0));
			const urls = [...document.querySelectorAll('#ntt-awesomebar .ntt-awesomebar-url')].map(u => u.textContent);
			expect(urls).not.toContain('https://github.com/'); // no tile source → no tile result
			expect(urls).toContain('https://gitlab.com/'); // the other sources still work
		} finally {
			(AwesomeBar as any)._tilesSource = original;
		}
	});

	it('init() with no options at all does not throw and leaves the tiles source unset', () => {
		expect(() => AwesomeBar.init()).not.toThrow();
		expect((AwesomeBar as any)._tilesSource).toBeNull();
	});

	it('regression (June review §4.4): a thrown render error inside _query\'s Promise.all chain is caught, not an unhandled rejection', async () => {
		// _query's Promise.all([...]).then(...) chain had no .catch — if the
		// render callback itself threw (e.g. a future _render/buildResults
		// bug), the resulting rejection was unhandled. It must land on
		// console.error instead.
		const realRender = AwesomeBar._render;
		AwesomeBar._render = () => { throw new Error('boom from _render'); };
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			AwesomeBar._query('git');
			await new Promise(r => setTimeout(r, 0));
			expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom from _render' }));
		} finally {
			AwesomeBar._render = realRender;
			errorSpy.mockRestore();
		}
	});

	it('preventive (review §3): renders attacker-controlled title/URL as text, never as HTML', () => {
		// Bookmark/history titles + URLs are attacker-influenced (a user can be
		// tricked into bookmarking a page with a crafted title). The renderer
		// must use textContent, not innerHTML — this pins that so a future
		// "improvement" to a template literal / innerHTML is caught.
		const evilTitle = '<img src=x onerror=alert(1)>';
		const evilUrl = 'https://evil.example/<script>alert(2)</script>';
		const results = AwesomeBar.buildResults('evil', {
			tiles: [{ url: evilUrl, title: evilTitle }],
			bookmarks: [],
			history: [],
		});
		AwesomeBar._render(results);
		const dd = document.getElementById('ntt-awesomebar')!;
		// No injected elements: the payload must not have become real nodes.
		expect(dd.querySelector('img')).toBeNull();
		expect(dd.querySelector('script')).toBeNull();
		// The strings survive verbatim as text content.
		const titleEl = dd.querySelector('.ntt-awesomebar-title') as HTMLElement;
		expect(titleEl.textContent).toBe(evilTitle);
		expect(titleEl.querySelector('*')).toBeNull();
		const urlEl = dd.querySelector('.ntt-awesomebar-url') as HTMLElement;
		expect(urlEl.textContent).toBe(evilUrl);
		expect(urlEl.querySelector('*')).toBeNull();
	});
});
