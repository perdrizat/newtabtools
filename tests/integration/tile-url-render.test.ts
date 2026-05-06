/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: tile-URL render path characterization.
 * Phase 1 slot 2 of the migration plan (MIGRATION.md).
 *
 * Loads the real `fx-newTab.js` via `vm.runInThisContext` and exercises
 * `Site.prototype.addTitle` — the function that writes stored URLs into the
 * DOM as `<a href="...">`. The §2.1 finding in the security audit is that
 * this path performs NO sanitization: any URL stored in IDB (including
 * `javascript:`) reaches `setAttribute('href', url)` unchanged.
 *
 * These tests pin that current (vulnerable) behaviour so the Phase 2
 * rewrite can add sanitization under a safety net.
 *
 * E2E note: a dedicated E2E is not needed for this slot. The normal
 * pin-URL flow rejects dangerous schemes via `isValidURL` (tested in the
 * companion unit test). The dangerous injection vector (malicious URLs
 * entering IDB via backup restore) is slot 3's responsibility.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FX_NEWTAB_PATH = path.resolve(__dirname, '../../webextension/fx-newTab.js');

describe('tile-URL render path — addTitle (Phase 1 slot 2)', () => {
	let addTitle: any;

	beforeAll(() => {
		// fx-newTab.js is mostly declarations (Grid, Cell, Site, Updater, etc.)
		// but lines 1939-1941 call UndoDialog.init() and newTabTools.startup()
		// which need the full new-tab DOM. We strip those two calls — we only
		// need the Site prototype definitions.
		const raw = fs.readFileSync(FX_NEWTAB_PATH, 'utf8');
		const code = raw
			.replace(/^UndoDialog\.init\(\);$/m, '// [stripped for test]')
			.replace(/^newTabTools\.startup\(\);$/m, '// [stripped for test]');
		vm.runInThisContext(code, { filename: 'fx-newTab.js' });

		addTitle = (globalThis as any).Site.prototype.addTitle;
		expect(addTitle).toBeTypeOf('function');
	});

	/**
	 * Creates a minimal DOM fragment matching the tile structure that
	 * addTitle expects: a wrapper with a `.newtab-link` anchor and a
	 * `.newtab-title` span inside it.
	 */
	function createTileDOM() {
		const wrapper = document.createElement('div');
		const link = document.createElement('a');
		link.className = 'newtab-link';
		const title = document.createElement('span');
		title.className = 'newtab-title';
		link.appendChild(title);
		wrapper.appendChild(link);
		return { wrapper, link, title };
	}

	/**
	 * Calls the real `addTitle` with a mock Site wired to a fresh DOM
	 * fragment, and returns the rendered href and title text.
	 */
	function renderTile(url: string, titleText?: string) {
		const dom = createTileDOM();
		const mockSite = {
			get url() { return url; },
			get title() { return titleText; },
			get node() { return dom.wrapper; },
			_querySelector(sel: string) { return dom.wrapper.querySelector(sel); },
		};
		addTitle.call(mockSite);
		return {
			href: dom.link.getAttribute('href'),
			titleContent: dom.title.textContent,
			tooltip: dom.link.getAttribute('title'),
		};
	}

	// ======================== SAFE SCHEMES ========================

	describe('safe schemes — pass through unchanged', () => {
		it('renders http: URL', () => {
			expect(renderTile('http://example.com').href).toBe('http://example.com');
		});

		it('renders https: URL', () => {
			expect(renderTile('https://example.com').href).toBe('https://example.com');
		});

		it('renders moz-extension: URL', () => {
			expect(renderTile('moz-extension://uuid/page.html').href).toBe('moz-extension://uuid/page.html');
		});
	});

	// ======================== DANGEROUS SCHEMES ========================
	// These characterize the §2.1 XSS vector: addTitle does NOT sanitize.

	describe('dangerous schemes — also pass through unchanged (§2.1)', () => {
		it('renders javascript: URL unchanged — stored XSS vector', () => {
			const { href } = renderTile('javascript:alert(document.cookie)');
			expect(href).toBe('javascript:alert(document.cookie)');
		});

		it('renders data:text/html unchanged — potential phishing vector', () => {
			const { href } = renderTile('data:text/html,<h1>phish</h1>');
			expect(href).toBe('data:text/html,<h1>phish</h1>');
		});

		it('renders an unknown/custom scheme unchanged', () => {
			const { href } = renderTile('evil-scheme://payload');
			expect(href).toBe('evil-scheme://payload');
		});
	});

	// ======================== EDGE CASES ========================

	describe('edge cases', () => {
		it('renders empty string as href', () => {
			expect(renderTile('').href).toBe('');
		});

		it('falls back to URL as title when title is falsy', () => {
			const { titleContent } = renderTile('https://example.com');
			expect(titleContent).toBe('https://example.com');
		});

		it('uses provided title when present', () => {
			const { titleContent } = renderTile('https://example.com', 'My Site');
			expect(titleContent).toBe('My Site');
		});

		it('sets tooltip to "title\\nurl" when title differs from url', () => {
			const { tooltip } = renderTile('https://example.com', 'My Site');
			expect(tooltip).toBe('My Site\nhttps://example.com');
		});

		it('sets tooltip to url alone when title equals url', () => {
			const { tooltip } = renderTile('https://example.com');
			expect(tooltip).toBe('https://example.com');
		});
	});
});
