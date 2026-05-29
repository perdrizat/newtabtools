/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Font-size scoping inside the config drawer.
 *
 * The Advanced tab (and a few legacy items still living in the Tile tab —
 * the Pin URL fieldset, the per-tile editor's `#options-tile`) is built out
 * of raw `<fieldset>` / `<legend>` / `<p>` / `<label>` / `<a>` / `<table>`
 * markup. Without scoped overrides those elements fall back to the page
 * default (~13-16 px), which makes the Advanced tab look visibly bigger
 * than the Page tab (where every label sits on `.ntt-form-group-label` at
 * 10.5 px). The drawer enforces its own scale via `#ntt-drawer-body …`
 * rules so the three tabs match.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('drawer font-size scoping — newTab.css', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rule presence
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	function ruleBody(selector: string): string {
		const idx = css.indexOf(selector);
		if (idx === -1) { throw new Error(`selector ${selector} not found`); }
		const braceStart = css.indexOf('{', idx);
		const braceEnd = css.indexOf('}', braceStart);
		return css.substring(braceStart + 1, braceEnd);
	}

	it('scopes <legend> in the drawer body to the form-group-label scale (10.5 px, uppercase)', () => {
		// Legend is the section header inside fieldsets — Pin URL, Tile editor,
		// History filter, Backup & Restore, Reset. It should match the
		// `.ntt-form-group-label` look so headers don't jump between tabs.
		const body = ruleBody('#ntt-drawer-body legend');
		expect(body).toMatch(/font-size:\s*10\.5px/);
		expect(body).toMatch(/text-transform:\s*uppercase/);
	});

	it('scopes <p> in the drawer body to 11.5 px', () => {
		// `<p>` is descriptive body copy: backup description, restore warning,
		// reset description. 11.5 px keeps it readable but smaller than
		// labels' 10.5-px uppercase headings.
		const body = ruleBody('#ntt-drawer-body p');
		expect(body).toMatch(/font-size:\s*11\.5px/);
	});

	it('scopes <label> in the drawer body to 11.5 px', () => {
		const body = ruleBody('#ntt-drawer-body label');
		expect(body).toMatch(/font-size:\s*11\.5px/);
	});

	it('scopes <a> in the drawer body to 11.5 px', () => {
		// "About" / GitHub link at the bottom of the Advanced tab.
		const body = ruleBody('#ntt-drawer-body a');
		expect(body).toMatch(/font-size:\s*11\.5px/);
	});

	it('scopes the history-filter <table> in the drawer body to 11.5 px', () => {
		const body = ruleBody('#ntt-drawer-body table');
		expect(body).toMatch(/font-size:\s*11\.5px/);
	});
});
