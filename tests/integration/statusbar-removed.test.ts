/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phase 4-0 — the bottom status bar is retired from the v2 chrome (it has no
 * analogue in the current Firefox new tab page). This pins the removal:
 *
 *   - `#ntt-statusbar` ships `hidden`, so the keyboard-hint pills + tile-count
 *     never render.
 *   - the drawer's "Status bar (bottom)" toggle (`titleBarStatus`) is gone, and
 *     so is the `titleBarStatus` pref (schema / names / parse) and its locale.
 *   - the removed-tile undo notice survives: `#newtab-undo-container` is moved
 *     OUT of `#ntt-statusbar` so hiding the bar (display:none) can't take the
 *     undo toast down with it. (Its show/hide wiring lives in UndoDialog and is
 *     exercised end-to-end by tile-redesign.test.ts.)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.xhtml');
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');
const LOCALE_PATH = path.resolve(__dirname, '../../webextension/_locales/en/messages.json');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) { throw new Error(`${methodName} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('Phase 4-0 — status bar retired from the chrome', () => {
	let xhtml: string;
	let css: string;

	beforeAll(() => {
		/* eslint-disable ntt/no-source-grep -- structural checks: markup/style removal */
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		css = fs.readFileSync(CSS_PATH, 'utf8');
		/* eslint-enable ntt/no-source-grep */
	});

	it('#ntt-statusbar ships hidden (never renders)', () => {
		expect(xhtml).toMatch(/<div id="ntt-statusbar" hidden/);
	});

	it('the drawer no longer offers a Status bar (titleBarStatus) toggle', () => {
		expect(xhtml).not.toMatch(/data-pref="titleBarStatus"/);
	});

	it('the removed-tile undo notice lives OUTSIDE the status bar', () => {
		// The undo container must not be a descendant of #ntt-statusbar, or
		// hiding the bar would hide the undo toast too. Assert it appears after
		// the status bar's closing position rather than nested within it.
		const statusOpen = xhtml.indexOf('<div id="ntt-statusbar"');
		const statusClose = xhtml.indexOf('</div>', xhtml.indexOf('ntt-statusbar-summary'));
		const undoIdx = xhtml.indexOf('id="newtab-undo-container"');
		expect(undoIdx).toBeGreaterThan(-1);
		// Undo container is not between the status-bar open tag and the point
		// where its inner content closes.
		const insideStatus = undoIdx > statusOpen && undoIdx < statusClose;
		expect(insideStatus).toBe(false);
	});

	it('the undo toast is positioned (fixed/absolute), not an inline status-bar cell', () => {
		const rule = css.match(/#newtab-undo-container\s*\{[^}]*\}/);
		expect(rule).not.toBeNull();
		expect(rule![0]).toMatch(/position:\s*(fixed|absolute)/);
	});
});

describe('Phase 4-0 — titleBarStatus pref removed', () => {
	let parsePrefs: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading prefs.parsePrefs for behavioral test
		const source = fs.readFileSync(PREFS_PATH, 'utf8');
		const parsePrefsFn = extractMethod(source, 'parsePrefs');
		const code = `var _prefsHarness = { _theme: 'system', _opacity: 80, _rows: 3, _columns: 3, _margin: ['small','small','small','small'], _spacing: 'small', _titleSize: 'small', _tileAspect: 'fill', _statType: 'none', _titleBarSearch: false, _actionIconSize: 'medium', _tileActions: true, _tileRadius: 'medium', _locked: false, _history: true, _recent: true, _thumbnailSize: 600, _backgroundUrl: '', _version: -1, ${parsePrefsFn} };`;
		(globalThis as any).Blocked = { _list: [] };
		(globalThis as any).Filters = { _list: {} };
		vm.runInThisContext(code, { filename: 'statusbar-removed-prefs-harness.js' });
		parsePrefs = (globalThis as any)._prefsHarness;
	});

	it('parsePrefs ignores a titleBarStatus key (pref no longer exists)', () => {
		parsePrefs.parsePrefs({ titleBarStatus: false });
		expect(parsePrefs._titleBarStatus).toBeUndefined();
	});

	it('prefs.js source no longer references titleBarStatus', () => {
		// eslint-disable-next-line ntt/no-source-grep -- structural: schema/names/parse all dropped
		const source = fs.readFileSync(PREFS_PATH, 'utf8');
		expect(source).not.toMatch(/titleBarStatus/);
	});
});

describe('Phase 4-0 — locale string removed', () => {
	it('options_titlebar_status message is gone', () => {
		// eslint-disable-next-line ntt/no-source-grep -- structural: locale key dropped
		const raw = fs.readFileSync(LOCALE_PATH, 'utf8');
		const messages = JSON.parse(raw);
		expect(messages.options_titlebar_status).toBeUndefined();
	});
});
