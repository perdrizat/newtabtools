/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Advanced tab on-system + confirm steps (DESIGNv2_REVIEW §5, §7).
 *
 * The Advanced tab must use the same control vocabulary as the rest of the
 * drawer: no native checkboxes (the history control is a copper toggle), a
 * three-tier button hierarchy (ghost / copper primary / danger destructive),
 * segmented-style steppers, and a row-rhythm domain table. Irreversible actions
 * (Reset everything, Restore) gate behind an inline Confirm/Cancel — no
 * window.confirm.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.xhtml');
const JS_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

describe('Advanced tab — no native controls (§5/B1)', () => {
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: drawer markup
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
	});

	it('has no native checkbox anywhere in the drawer body', () => {
		const drawerBody = xhtml.slice(xhtml.indexOf('id="ntt-drawer-body"'), xhtml.indexOf('id="ntt-drawer-footer"'));
		expect(drawerBody).not.toMatch(/<input[^>]*type="checkbox"/);
	});

	it('the history control is a copper toggle (role=switch, data-pref="history")', () => {
		expect(xhtml).toMatch(/role="switch"[^>]*class="ntt-toggle"[^>]*data-pref="history"|data-pref="history"[^>]*class="ntt-toggle"[^>]*role="switch"|class="ntt-toggle"[^>]*data-pref="history"/);
	});
});

describe('Advanced tab — button hierarchy + confirm steps (§5/§7)', () => {
	let xhtml: string;
	let css: string;
	let js: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup/CSS/JS
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: handler behaviour
		js = fs.readFileSync(JS_PATH, 'utf8');
	});

	it('destructive actions (Reset, Restore) carry the danger button class', () => {
		expect(xhtml).toMatch(/id="options-reset-all"[^>]*class="ntt-btn-danger"|class="ntt-btn-danger"[^>]*id="options-reset-all"/);
		expect(xhtml).toMatch(/id="options-restore"[^>]*class="ntt-btn-danger"|class="ntt-btn-danger"[^>]*id="options-restore"/);
	});

	it('a primary (copper) action exists per group', () => {
		expect(xhtml).toMatch(/id="options-pinURL"[^>]*ntt-btn-primary/);
		expect(xhtml).toMatch(/id="options-filter-set"[^>]*ntt-btn-primary/);
	});

	it('the button hierarchy classes are styled (primary fill, danger role)', () => {
		expect(css).toMatch(/button\.ntt-btn-primary\s*\{[^}]*background:\s*var\(--ntt-accent/s);
		expect(css).toMatch(/button\.ntt-btn-danger\s*\{[^}]*var\(--ntt-danger/s);
	});

	it('the ghost base does not inflate specificity with :not(#id) (danger/primary must win)', () => {
		// Regression (caught by UAT): `.options-row button:not(#id)` counts the id,
		// pushing the ghost base above the (1,1,1) primary/danger modifiers so the
		// danger tier rendered identically to ghost. The base must not carry an
		// ID-bearing :not().
		expect(css).not.toMatch(/\.options-row button:not\(#/);
	});

	it('the high-contrast theme bumps --ntt-danger to the AAA-on-black dark tone (§8)', () => {
		const hc = css.match(/:root\[theme="contrast"\]\s*\{[^}]*\}/s);
		expect(hc).toBeTruthy();
		expect(hc![0]).toMatch(/--ntt-danger:\s*#e89279/);
	});

	it('focusable controls have a visible focus ring (§8 a11y — caught by UAT)', () => {
		// The search input clears the UA outline; a replacement ring must exist on
		// its container, else keyboard focus is invisible.
		expect(css).toMatch(/#ntt-search:focus-within[^{]*\{[^}]*outline:[^}]*var\(--ntt-accent/s);
	});

	it('Reset and Restore have inline Confirm/Cancel rows, hidden by default', () => {
		expect(xhtml).toMatch(/id="options-reset-confirm-row"[^>]*hidden/);
		expect(xhtml).toMatch(/id="options-restore-confirm-row"[^>]*hidden/);
		expect(xhtml).toContain('id="options-reset-confirm"');
		expect(xhtml).toContain('id="options-restore-confirm"');
	});

	it('resetAllSettings no longer uses window.confirm (the inline row gates it)', () => {
		const body = js.slice(js.indexOf('resetAllSettings()'), js.indexOf('resetAllSettings()') + 400);
		expect(body).not.toMatch(/window\.confirm/);
	});

	it('the reset/restore clicks reveal the confirm row instead of acting immediately', () => {
		expect(js).toMatch(/case 'options-reset-all':[\s\S]{0,160}_showConfirm\('options-reset-confirm-row'\)/);
		expect(js).toMatch(/case 'options-reset-confirm':[\s\S]{0,160}resetAllSettings\(\)/);
	});
});

describe('Advanced tab — steppers + table on-system (§5)', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('steppers are segmented-style (bordered, connected), not borderless icons', () => {
		const block = css.match(/\.plus-button,\s*\n?\s*\.minus-button\s*\{[^}]*\}/s);
		expect(block).toBeTruthy();
		expect(block![0]).toMatch(/border:\s*1px solid var\(--ntt-line/);
	});

	it('the domain table has row hairlines', () => {
		expect(css).toMatch(/#options-filter tbody tr\s*\{[^}]*border-bottom:[^}]*var\(--ntt-line/s);
	});

	it('drawer links use the accent colour, not browser-default blue (on-system + HC-legible)', () => {
		expect(css).toMatch(/#ntt-drawer-body a\s*\{[^}]*color:\s*var\(--ntt-accent/s);
	});
});
