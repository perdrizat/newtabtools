/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: tile-URL render path characterization.
 * Phase 1 slot 2 of the migration plan (MIGRATION.md).
 *
 * Natively `import()`s the real `site.js` and exercises
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
import { parseNewTabDocument } from './_helpers';

describe('tile-URL render path — addTitle (Phase 1 slot 2)', () => {
	let addTitle: any;

	beforeAll(async () => {
		// site.js (chrome-prep C4c, CHROME_PREP.md, split out of the former
		// page monolith) holds `Site`'s constructor+prototype (Grid/Cell/Drag/
		// Drop live in their own sibling modules). page-modules P1
		// (PAGE_MODULES.md): its top level is now definition-only — the former
		// `UndoDialog.init(); newTabTools.startup();` trailer this test used to
		// strip out was hoisted to page-main.js. page-modules P5
		// (PAGE_MODULES.md): the former page monolith gained real
		// `import`/`export` syntax in that slice, which `vm.runInThisContext`
		// (script-mode) can no longer parse — natively `import()`ing it
		// instead. chrome-prep C3b (CHROME_PREP.md) typed it for real, so this
		// is a plain literal-string dynamic import rather than the old
		// `@vite-ignore`d computed-path one — `tsc` resolves/types it like a
		// static import. It stays dynamic (not top-level static), though:
		// importing site.js transitively imports and evaluates newTab.js too
		// (the legal cycle, Decision 3), whose top-level DOM-wiring IIFE needs
		// the real markup's element ids — mounting the shipped `newTab.html`
		// body first is the same precedent page-module-scope.test.ts and
		// `_helpers.ts`'s `mountSite()` use, and a static import is hoisted
		// above all of a module's own top-level code, so there's no way to
		// sequence "mount the DOM, then import" with one.
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;
		const site = await import('../../webextension/site.js');

		addTitle = site.Site.prototype.addTitle;
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

		it('renders ftp: URL', () => {
			expect(renderTile('ftp://files.example.com/pub').href).toBe('ftp://files.example.com/pub');
		});
	});

	// ======================== DANGEROUS SCHEMES ========================
	// §2.1 fix: addTitle now blocks non-http/https/ftp schemes.

	describe('dangerous schemes — blocked by defense-in-depth (§2.1 fix)', () => {
		it('blocks javascript: URL — renders # instead', () => {
			const { href } = renderTile('javascript:alert(document.cookie)');
			expect(href).toBe('#');
		});

		it('blocks data:text/html — renders # instead', () => {
			const { href } = renderTile('data:text/html,<h1>phish</h1>');
			expect(href).toBe('#');
		});

		it('blocks unknown/custom schemes — renders # instead', () => {
			const { href } = renderTile('evil-scheme://payload');
			expect(href).toBe('#');
		});

		it('blocks moz-extension: URLs — renders # instead', () => {
			expect(renderTile('moz-extension://uuid/page.html').href).toBe('#');
		});
	});

	// ======================== EDGE CASES ========================

	describe('edge cases', () => {
		it('renders # for empty string', () => {
			expect(renderTile('').href).toBe('#');
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
