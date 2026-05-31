/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Font-size scoping inside the config drawer.
 *
 * Phase 5-3 consolidated the legacy `<fieldset>` / `<legend>` markup into
 * `.ntt-form-group` primitives, so section headers now ride on
 * `.ntt-form-group-label` and the `<legend>` override is gone. A few raw body
 * elements remain — the Pin-URL permission `<p>`, the per-tile editor
 * `<label>`s, the GitHub `<a>`, and the history-filter `<table>` — which still
 * need the drawer's 11.5 px scale (vs. the page default ~13-16 px) so the
 * three tabs match.
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

	it('no longer ships a <legend> override (legends consolidated into .ntt-form-group, Phase 5-3)', () => {
		expect(css).not.toMatch(/#ntt-drawer-body legend\s*\{/);
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
