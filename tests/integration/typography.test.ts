/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Typography role discipline (DESIGNv2_REVIEW §6).
 *
 * The win is *role discipline*: monospace is reserved for content that is
 * genuinely tabular-numeric or a keyboard key. Everything textual — URLs,
 * domains, section captions, helper/explanatory text — is the UI sans, with
 * hierarchy coming from weight/size/colour, not a second typeface. Italics are
 * banned outright (italic + small + low-contrast is the least legible combo).
 *
 * These assert against the CSS/markup source so a regression that reintroduces
 * mono on textual content (or italic on helper copy) fails the build.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const HTML_PATH = path.resolve(__dirname, '../../webextension/newTab.html');

// Return the body of the FIRST CSS rule whose selector list ends with `selector`
// immediately before the opening brace. Anchored on `selector\s*{` so
// `.ntt-form-group-help` does not accidentally match `.ntt-form-group-head`.
function ruleBody(css: string, selector: string): string {
	const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
	const m = re.exec(css);
	if (!m) { throw new Error(`selector ${selector} not found`); }
	const braceStart = css.indexOf('{', m.index);
	const braceEnd = css.indexOf('}', braceStart);
	return css.substring(braceStart + 1, braceEnd);
}

describe('typography role discipline (§6)', () => {
	let css: string;
	let html: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS/markup rule presence
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup attribute presence
		html = fs.readFileSync(HTML_PATH, 'utf8');
	});

	// Textual content that must NOT be monospace.
	const TEXTUAL_SELECTORS = [
		'.ntt-form-group-help',   // helper / explanatory copy
		'.ntt-awesomebar-section', // section captions
		'.ntt-awesomebar-url',    // URLs in the awesomebar dropdown
		'.ntt-recent-url',        // recently-closed domain line
		'.ntt-recent-age',        // recently-closed age label
		'#newtab-undo-container', // undo toast copy
	];

	TEXTUAL_SELECTORS.forEach((sel) => {
		it(`${sel} is not monospace (textual → UI sans)`, () => {
			expect(ruleBody(css, sel)).not.toMatch(/--ntt-font-mono/);
		});
	});

	// Genuinely tabular-numeric or keyboard-key content keeps monospace.
	const MONO_SELECTORS = [
		'.ntt-stat-chip',  // visit counts / stat numbers (tabular numerics)
		'.ntt-search-kbd', // the `/` key hint
		'.ntt-toggle-kbd', // inline key hint
	];

	MONO_SELECTORS.forEach((sel) => {
		it(`${sel} keeps monospace (numeric / key)`, () => {
			expect(ruleBody(css, sel)).toMatch(/--ntt-font-mono/);
		});
	});

	it('helper copy is never italic (§6: drop italics entirely)', () => {
		expect(ruleBody(css, '.ntt-form-group-help')).not.toMatch(/italic/);
	});

	it('the Add-tile autocomplete dropdown uses the UI sans (not the page system font)', () => {
		// The page sets `font: message-box`, which leaks a system serif into the
		// absolutely-positioned `#autocomplete` dropdown unless it sets the UI font.
		expect(ruleBody(css, '#autocomplete')).toMatch(/--ntt-font-ui/);
	});

	it('no inline font-style:italic survives in the markup', () => {
		// The Advanced-tab filter helptext, restore warning, and reset warning
		// shipped as inline italic — the least legible combination in the UI.
		expect(html).not.toMatch(/font-style:\s*italic/);
	});
});
