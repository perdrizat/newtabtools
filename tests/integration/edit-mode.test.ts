/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Edit / Done mode (DESIGNv2_REVIEW §2).
 *
 * Opening the drawer IS edit mode: the board unlocks, the titlebar button reads
 * "Done", pinned tiles show a persistent action row + a centred drag handle + a
 * dashed accent outline, and auto (non-pinned) tiles fade back to offer
 * "+ Add tile". Closing re-locks. The board is locked by default. Hover actions
 * remain available in normal (locked) mode — they are NOT gated on `locked`.
 *
 * The live open/close state machine is exercised end-to-end in the E2E tier
 * (tests/e2e/lock-grid.test.ts + edit-mode coverage); here we pin the CSS,
 * markup, and per-tile rendering invariants.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountSite, readNewTabHtml } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');

describe('edit mode — CSS affordances (§2)', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rule presence
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('drag handle and add-tile prompt are hidden outside edit mode', () => {
		const block = css.match(/\.ntt-drag-handle,\s*\n?\s*\.ntt-add-tile\s*\{[^}]*\}/s);
		expect(block).toBeTruthy();
		expect(block![0]).toMatch(/display:\s*none/);
	});

	it('pinned tiles do NOT get a dashed outline (the drag handle already signals movable)', () => {
		expect(css).not.toMatch(/:root\[drawer-open\]\s+\.newtab-site\[pinned\]\s*\{[^}]*outline:[^}]*dashed/s);
	});

	it('dashed = "add here" — only the non-pinned (candidate) slots carry it', () => {
		expect(css).toMatch(/:root\[drawer-open\]\s+\.newtab-site:not\(\[pinned\]\)\s*\{[^}]*outline:[^}]*dashed/s);
	});

	it('the open (selected) tile gets a single copper ring with a white-separator halo', () => {
		// 2px white halo + 4px accent ring (readable on any thumbnail). The rule has
		// a `,:hover` variant (so the elevation shadow can't override it), so allow
		// extra selectors before the opening brace.
		expect(css).toMatch(/\.newtab-site\[data-selected="true"\][^{]*\{[^}]*box-shadow:[^;]*#fff[^;]*var\(--ntt-accent/s);
		// dark theme swaps the halo to a dark tone
		expect(css).toMatch(/:root\[theme="dark"\][^{]*\.newtab-site\[data-selected="true"\][^{]*\{[^}]*box-shadow:[^;]*rgba\(0,\s*0,\s*0/s);
	});

	it('pinned tiles show the persistent action row + centred drag handle in edit mode', () => {
		expect(css).toMatch(/:root\[drawer-open\]\s+\.newtab-site\[pinned\]\s+\.ntt-actions\s*\{[^}]*opacity:\s*1/s);
		expect(css).toMatch(/:root\[drawer-open\]\s+\.newtab-site\[pinned\]\s+\.ntt-drag-handle\s*\{[^}]*display:\s*flex/s);
	});

	it('non-pinned slots show the "+ Pin tile" chip WITHOUT dimming the thumbnail (no wallpaper bleed)', () => {
		expect(css).toMatch(/:root\[drawer-open\]\s+\.newtab-site:not\(\[pinned\]\)[^{]*\.ntt-add-tile\s*\{[^}]*display:\s*flex/s);
		// the old opacity:0.25 dim on the thumbnail/overlay is gone
		expect(css).not.toMatch(/:root\[drawer-open\]\s+\.newtab-site:not\(\[pinned\]\)[^{]*(thumbnail|overlay)[^{]*\{[^}]*opacity:\s*0\.25/s);
		// the label is an opaque chip
		expect(css).toMatch(/\.ntt-add-tile-chip\s*\{/s);
	});

	it('edit mode dims the page wallpaper so gaps go calm', () => {
		expect(css).toMatch(/:root\[drawer-open\]\s+#background-fake\s*\{[^}]*brightness\(/s);
	});

	it('the drag handle + "+ Pin tile" scale with the tile (container-query sized, landscape)', () => {
		// .newtab-site is a size container so affordances scale via cqmin.
		expect(css).toMatch(/\.newtab-site\s*\{[^}]*container-type:\s*size/s);
		// drag handle is a landscape pill — both axes scale via cqmin (width > height).
		const handle = css.match(/:root\[drawer-open\]\s+\.newtab-site\[pinned\]\s+\.ntt-drag-handle\s*\{[^}]*\}/s);
		expect(handle).toBeTruthy();
		expect(handle![0]).toMatch(/width:[^;]*cqmin/);
		expect(handle![0]).toMatch(/height:[^;]*cqmin/);
		// the grip is rotated 90° to read landscape
		expect(css).toMatch(/\.ntt-drag-handle svg[\s\S]{0,300}rotate\(90deg\)/s);
		// "+ Pin tile" chip: scales (height + font via cqmin) and stays on one line.
		const chip = css.match(/\.ntt-add-tile-chip\s*\{[^}]*\}/s);
		expect(chip).toBeTruthy();
		expect(chip![0]).toMatch(/height:[^;]*cqmin/);
		expect(chip![0]).toMatch(/font-size:[^;]*cqmin/);
		expect(chip![0]).toMatch(/white-space:\s*nowrap/);
	});

	it('the Done button (drawer-open) fills with the accent colour (§2)', () => {
		expect(css).toMatch(/:root\[drawer-open\]\s+#options-toggle\s*\{[^}]*background:\s*var\(--ntt-accent/s);
	});

	it('hover actions are NOT gated on `locked` (§3c — available in normal mode)', () => {
		const hideRule = css.match(/([^}]*)\.ntt-actions\s*\{\s*[^}]*display:\s*none[^}]*\}/g) || [];
		// No rule should hide .ntt-actions / .ntt-actions-kebab via :root[locked].
		expect(css).not.toMatch(/:root\[locked="true"\]\s+\.ntt-actions/);
		expect(css).not.toMatch(/:root\[locked="true"\]\s+\.ntt-actions-kebab/);
		void hideRule;
	});
});

describe('edit mode — markup + defaults (§2)', () => {
	let html: string;
	let prefs: string;

	beforeAll(() => {
		html = readNewTabHtml();
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: pref default
		prefs = fs.readFileSync(PREFS_PATH, 'utf8');
	});

	it('the tile template carries the drag handle and add-tile elements', () => {
		expect(html).toContain('ntt-drag-handle');
		expect(html).toContain('ntt-add-tile');
	});

	it('the standalone lock checkbox is gone from the drawer (lock is now edit-mode)', () => {
		expect(html).not.toMatch(/<input[^>]*name="locked"/);
	});

	it('the board is locked by default (§2 — no accidental drags)', () => {
		expect(prefs).toMatch(/_locked:\s*true/);
	});
});

describe('edit mode — per-tile rendering (§2)', () => {
	it('renders a centred drag handle (with grip icon) on each tile', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const handle = site.node.querySelector('.ntt-drag-handle');
		expect(handle).toBeTruthy();
		expect(handle.querySelector('svg')).toBeTruthy();
		cleanup();
	});

	it('renders a "+ Pin tile" chip on each tile', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const add = site.node.querySelector('.ntt-add-tile');
		expect(add).toBeTruthy();
		const chip = add.querySelector('.ntt-add-tile-chip');
		expect(chip, 'add-tile label is an opaque chip').toBeTruthy();
		expect((chip.textContent || '').length).toBeGreaterThan(0);
		cleanup();
	});
});
