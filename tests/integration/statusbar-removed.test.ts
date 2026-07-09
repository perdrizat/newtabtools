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
import { readNewTabHtml } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
	let html: string;
	let css: string;

	beforeAll(() => {
		html = readNewTabHtml();
		// eslint-disable-next-line ntt/no-source-grep -- structural check: style removal
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('the #ntt-statusbar markup is removed entirely (Phase 5-1)', () => {
		expect(html).not.toMatch(/id="ntt-statusbar"/);
		expect(html).not.toMatch(/ntt-statusbar-hints|ntt-statusbar-kbd|ntt-statusbar-summary|ntt-statusbar-tilecount/);
	});

	it('the status-bar CSS is removed (no #ntt-statusbar / .ntt-statusbar-* rules)', () => {
		expect(css).not.toMatch(/#ntt-statusbar/);
		expect(css).not.toMatch(/\.ntt-statusbar-/);
	});

	it('the drawer no longer offers a Status bar (titleBarStatus) toggle', () => {
		expect(html).not.toMatch(/data-pref="titleBarStatus"/);
	});

	it('the removed-tile undo notice survives as a standalone floating toast', () => {
		// The undo container is independent of the (now-deleted) status bar.
		expect(html).toMatch(/id="newtab-undo-container"/);
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

	it('prefs.js no longer manages titleBarStatus (no schema field or parse branch)', () => {
		// eslint-disable-next-line ntt/no-source-grep -- structural: schema/names/parse all dropped
		const source = fs.readFileSync(PREFS_PATH, 'utf8');
		// The pref is gone from the schema and parser…
		expect(source).not.toMatch(/_titleBarStatus/);
		expect(source).not.toMatch(/this\._titleBarStatus\s*=/);
		// …though Phase 5-4 deliberately lists it in the init storage-prune
		// `remove([...])` call, so a bare substring match is intentionally not used.
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
