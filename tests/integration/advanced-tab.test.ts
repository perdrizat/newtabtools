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
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.html');
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

	it('the manual contrast theme uses the same alarm red #cc1633 (it controls its own palette)', () => {
		const hc = css.match(/:root\[theme="contrast"\]\s*\{[^}]*\}/s);
		expect(hc).toBeTruthy();
		expect(hc![0]).toMatch(/--ntt-danger:\s*#cc1633/);
	});

	it('light/dark danger is the cooler alarm red #cc1633, never equal to the copper accent', () => {
		// tokens.css holds light (:root) + dark; the contrast danger lives in css here.
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: design tokens
		const tokens = fs.readFileSync(path.resolve(__dirname, '../../webextension/tokens.css'), 'utf8');
		const dangers = [...tokens.matchAll(/--ntt-danger:\s*(#[0-9a-f]{6})/gi)].map(m => m[1].toLowerCase());
		const accents = [...tokens.matchAll(/--ntt-accent:\s*(#[0-9a-f]{6})/gi)].map(m => m[1].toLowerCase());
		expect(dangers.length).toBeGreaterThanOrEqual(2); // light + dark
		for (const d of dangers) {
			expect(d).toBe('#cc1633');
			expect(accents).not.toContain(d);
		}
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

describe('High-contrast action buttons — differentiate by treatment, not hue', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('forced-colors mode is handled with system-color keywords (honours the OS palette)', () => {
		expect(css).toMatch(/@media \(forced-colors: active\)/);
		expect(css).toMatch(/ButtonText/);
		expect(css).toMatch(/ButtonFace/);
	});

	it('in forced-colors the destructive ✕ is the inverted/filled button (contrast cue, not hue)', () => {
		// remove inverts fill/text: background becomes the foreground system colour
		expect(css).toMatch(/\.ntt-action-btn\[data-action="remove"\]\s*\{[^}]*background:\s*ButtonText/s);
	});

	it('the manual contrast theme ✕ uses the red danger fill (it controls its own palette, unlike forced-colors)', () => {
		const rule = css.match(/:root\[theme="contrast"\]\s+\.ntt-action-btn\[data-action="remove"\]\s*\{[^}]*\}/s);
		expect(rule).toBeTruthy();
		// red fill + white ring/icon keep it legible on black — same treatment as light/dark
		expect(rule![0]).toMatch(/background:\s*var\(--ntt-danger\)/);
		expect(rule![0]).toMatch(/rgba\(255,\s*255,\s*255/);
	});
});

describe('Themed Restore file button (Advanced › Restore)', () => {
	let xhtml: string;
	let css: string;
	let messages: Record<string, { message: string }>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: locale copy
		messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../webextension/_locales/en/messages.json'), 'utf8'));
	});

	it('the native file input is visually hidden and triggered by a styled <label>', () => {
		expect(xhtml).toMatch(/id="options-restore-file"[^>]*ntt-visually-hidden|ntt-visually-hidden[^>]*id="options-restore-file"/);
		expect(xhtml).toMatch(/<label[^>]*for="options-restore-file"[^>]*ntt-file-label/);
	});

	it('a themed filename display + the choose-file/no-file messages exist', () => {
		expect(xhtml).toMatch(/ntt-file-name/);
		expect(messages.restore_choose_file).toBeTruthy();
		expect(messages.backup_no_file).toBeTruthy();
	});

	it('the label is styled like a drawer button and a visually-hidden utility exists', () => {
		expect(css).toMatch(/\.ntt-visually-hidden\s*\{/);
		expect(css).toMatch(/\.ntt-file-label/);
	});
});

describe('History-tiles filter — toggle, remove, design language', () => {
	let xhtml: string;
	let css: string;
	let js: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: handler behaviour
		js = fs.readFileSync(JS_PATH, 'utf8');
	});

	it('the filter panel is a toggle: hidden by default + a CSS rule that hides it', () => {
		expect(xhtml).toMatch(/id="options-filter"[^>]*hidden/);
		expect(css).toMatch(/#options-filter\[hidden\]\s*\{[^}]*display:\s*none/s);
	});

	it('the Filter… button controls the panel (aria-controls + aria-expanded)', () => {
		expect(xhtml).toMatch(/id="historytiles-filter"[^>]*aria-controls="options-filter"/);
		expect(xhtml).toMatch(/id="historytiles-filter"[^>]*aria-expanded/);
	});

	it('the Filter… click toggles the panel rather than only populating it', () => {
		expect(js).toMatch(/case 'historytiles-filter':[\s\S]{0,260}optionsFilter\.hidden\s*=\s*!/);
		expect(js).toMatch(/case 'historytiles-filter':[\s\S]{0,260}setAttribute\('aria-expanded'/);
	});

	it('the helptext is no longer centered (left-aligned to the drawer rhythm)', () => {
		const tag = xhtml.match(/<td[^>]*data-message="filter_helptext"[^>]*>/);
		expect(tag).toBeTruthy();
		expect(tag![0]).not.toMatch(/text-align:\s*center/);
	});

	it('an explicit ✕ remove control exists, styled, and is wired to delete the filter', () => {
		expect(css).toMatch(/\.ntt-filter-remove\s*\{/);
		// created only on filter rows in fillFilterUI
		expect(js).toMatch(/ntt-filter-remove/);
		// the click handler deletes the filter entry (setFilter host, -1)
		expect(js).toMatch(/classList\.contains\('ntt-filter-remove'\)[\s\S]{0,400}setFilter\([^,]+,\s*-1\)/);
	});

	it('the Set handler normalizes the host (so exact matching reliably fires)', () => {
		expect(js).toMatch(/case 'options-filter-set':[\s\S]{0,260}Filters\.normalizeHost/);
	});
});

describe('Tile editor controls — themed + recognizable', () => {
	let xhtml: string;
	let css: string;
	let messages: Record<string, { message: string }>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: locale copy
		messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../webextension/_locales/en/messages.json'), 'utf8'));
	});

	it('the thumbnail file picker is a themed <label> (native input hidden), like Restore', () => {
		expect(xhtml).toMatch(/id="options-savedthumb-input"[^>]*ntt-visually-hidden|ntt-visually-hidden[^>]*id="options-savedthumb-input"/);
		expect(xhtml).toMatch(/<label[^>]*for="options-savedthumb-input"[^>]*ntt-file-label/);
	});

	it('secondary (ghost) drawer buttons have a visible filled surface, not transparent', () => {
		// The shared ghost base must paint a subtle surface so Set/Remove read as buttons.
		expect(css).toMatch(/\.ntt-btn-ghost\s*\{[^}]*background:\s*var\(--ntt-surface-soft\)/s);
	});

	it('"Save current thumbnail" is renamed to "Pin current thumbnail" + a Choose-image label exists', () => {
		expect(messages.tile_savedthumb_savecurrent.message).toMatch(/^Pin /);
		expect(messages.tile_savedthumb_choose).toBeTruthy();
	});
});

describe('Tile dialog redesign — Pin next / Update current, rows, alignment', () => {
	let xhtml: string;
	let css: string;
	let js: string;
	let messages: Record<string, { message: string }>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: handler behaviour
		js = fs.readFileSync(JS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: locale copy
		messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../webextension/_locales/en/messages.json'), 'utf8'));
	});

	it('section headers are renamed: "Pin to next available tile:" + "Update current tile:"', () => {
		expect(messages.pin_url_header.message).toBe('Pin to next available tile:');
		expect(messages.tile_header.message).toBe('Update current tile:');
	});

	it('the redundant labels are gone (Saved image / Title / current-URL)', () => {
		const tile = xhtml.slice(xhtml.indexOf('id="options-tile"'), xhtml.indexOf('data-drawer-panel="page"'));
		expect(tile).not.toMatch(/data-message="tile_savedthumb_label"/);
		expect(tile).not.toMatch(/data-message="tile_title_label"/);
		expect(tile).not.toMatch(/id="options-url"[^-]/); // the read-only #options-url label
	});

	it('URL row has a danger Remove; Title row has a Remove', () => {
		expect(xhtml).toMatch(/id="options-url-remove"[^>]*ntt-btn-danger|ntt-btn-danger[^>]*id="options-url-remove"/);
		expect(xhtml).toContain('id="options-title-remove"');
	});

	it('Pin-thumbnail row has Remove; Choose-image row has a separate Clear', () => {
		expect(xhtml).toContain('id="options-savethumb"');
		expect(xhtml).toContain('id="options-savedthumb-remove"');
		expect(xhtml).toContain('id="options-savedimg-clear"');
	});

	it('a separator divides "Pin next tile" from "Update current tile"', () => {
		const tilePanel = xhtml.slice(xhtml.indexOf('data-drawer-panel="tile"'), xhtml.indexOf('data-drawer-panel="page"'));
		expect(tilePanel).toMatch(/<hr class="ntt-drawer-divider"/);
	});

	it('rows left-align content, right-align Set/Remove (inputs/filename flex; pin-Remove auto-margin)', () => {
		expect(css).toMatch(/#options-tile #options-url-input,\s*#options-tile #options-title-input\s*\{[^}]*flex:\s*1/s);
		expect(css).toMatch(/#options-tile \.options-row > #options-savedthumb-remove\s*\{[^}]*margin-left:\s*auto/s);
	});

	it('Page tab: Choose-wallpaper left, Remove right; Advanced: Filter… left', () => {
		expect(css).toMatch(/#options-bg-remove\s*\{[^}]*margin-left:\s*auto/s);
		expect(css).toMatch(/#historytiles-filter\s*\{[^}]*margin-right:\s*auto/s);
	});

	it('the new handlers are wired (url-remove deletes the tile; title-remove clears; savedimg-clear)', () => {
		expect(js).toMatch(/case 'options-url-remove':[\s\S]{0,400}\.block\(\)/);
		expect(js).toMatch(/case 'options-title-remove':[\s\S]{0,260}titleIsUserSet\s*=\s*false/);
		expect(js).toMatch(/case 'options-savedimg-clear'/);
	});
});
