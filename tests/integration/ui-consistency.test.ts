/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Structural CSS regression guards for the design-system token migration
 * (design-audit findings 1–6). These are purely structural style checks —
 * no behavioral assertion is possible for CSS-only properties without a
 * running browser, so source-string matching is the only feasible guard.
 * Each assertion is a regression gate ensuring migrated selectors stay on
 * the shared token vocabulary and that the removed ad-hoc values stay removed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('UI consistency — design-system token migration (audit findings 1–6)', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- purely structural style checks: no behavioral test is possible for CSS-only properties without a running browser
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('no hardcoded ad-hoc blue #0a84ff remains (regression guard for wallpaper selected ring)', () => {
		expect(css).not.toMatch(/#0a84ff/i);
	});

	it('no hardcoded legacy border color #b2aeaa remains (regression guard for wallpaper/autocomplete)', () => {
		expect(css).not.toMatch(/#b2aeaa/i);
	});

	it('wallpaper picker uses var(--ntt-surface) and not var(--page-background)', () => {
		expect(css).toMatch(/#wallpaper-picker\s*\{[^}]*background:\s*var\(--ntt-surface\)/s);
		expect(css).not.toMatch(/#wallpaper-picker\s*\{[^}]*var\(--page-background\)/s);
	});

	it('autocomplete uses var(--ntt-surface) and has a border-radius', () => {
		expect(css).toMatch(/#autocomplete\s*\{[^}]*background:\s*var\(--ntt-surface\)/s);
		expect(css).toMatch(/#autocomplete\s*\{[^}]*border-radius:/s);
	});

	it('undo container non-close buttons have a hover rule', () => {
		expect(css).toMatch(/#newtab-undo-container button:not\(\.close-button\):hover\s*\{/);
	});

	it('close-button and undo buttons appear in the focus-visible chain', () => {
		const focusBlock = css.match(/\.close-button:focus-visible[^{]*\{[^}]*outline:[^}]*var\(--ntt-accent\)/s);
		expect(focusBlock, 'close-button must be in the focus-visible chain').toBeTruthy();
		const undoFocus = css.match(/#newtab-undo-container button[^{]*:focus-visible[^{]*\{[^}]*outline:[^}]*var\(--ntt-accent\)/s);
		expect(undoFocus, 'undo buttons must be in the focus-visible chain').toBeTruthy();
	});

	it('forced-colors block references #newtab-undo-container', () => {
		const fcBlock = css.match(/@media \(forced-colors: active\)\s*\{[\s\S]*?\n\}/);
		expect(fcBlock, '@media (forced-colors: active) block must exist').toBeTruthy();
		expect(fcBlock![0]).toMatch(/#newtab-undo-container/);
	});

	it('forced-colors block references #ntt-awesomebar or .close-button', () => {
		const fcBlock = css.match(/@media \(forced-colors: active\)\s*\{[\s\S]*?\n\}/);
		expect(fcBlock, '@media (forced-colors: active) block must exist').toBeTruthy();
		expect(fcBlock![0]).toMatch(/#ntt-awesomebar|\.close-button/);
	});
});
