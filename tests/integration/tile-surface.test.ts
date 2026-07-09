/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tile surface — quick-actions affordance (DESIGNv2_REVIEW §3c) and the
 * destructive-action colour (§3c/§7).
 *
 * At rest a tile shows a single kebab; on hover it expands to a compact row of
 * in-place actions (Edit URL · Reload · Pin/Unpin · Remove). "Open in new tab"
 * was dropped (clicking the tile already opens it). The Remove (✕) action is the
 * one destructive control, so it carries the danger colour.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountSite, readNewTabHtml } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('tile surface — kebab-at-rest affordance (§3c)', () => {
	let css: string;
	let html: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS structure
		css = fs.readFileSync(CSS_PATH, 'utf8');
		html = readNewTabHtml();
	});

	it('tile template carries a .ntt-actions-kebab rest affordance', () => {
		expect(html).toContain('ntt-actions-kebab');
	});

	it('.ntt-actions-kebab sits top-right and is visible at rest', () => {
		const block = css.match(/\.ntt-actions-kebab\s*\{[^}]*\}/s);
		expect(block).toBeTruthy();
		expect(block![0]).toMatch(/position:\s*absolute/);
		expect(block![0]).toMatch(/top:\s*8px/);
		expect(block![0]).toMatch(/right:\s*8px/);
		expect(block![0]).toMatch(/opacity:\s*1/);
	});

	it('the kebab fades out on hover (the action row takes over)', () => {
		expect(css).toMatch(/\.newtab-site:hover\s+\.ntt-actions-kebab[^{]*\{[^}]*opacity:\s*0/);
	});

	it('the action row is still hidden at rest and shown on hover', () => {
		expect(css).toMatch(/\.ntt-actions\s*\{[^}]*opacity:\s*0/);
		expect(css).toMatch(/\.newtab-site:hover\s+\.ntt-actions[^-][^{]*\{[^}]*opacity:\s*1/);
	});

	it('the kebab is suppressed when the board is locked or actions are off', () => {
		// Same gate as the action row — no hover affordance when actions are off.
		expect(css).toMatch(/\.ntt-actions-kebab[^{]*\{\s*display:\s*none|(?:locked|tile-actions)[^{]*\.ntt-actions-kebab/);
	});
});

describe('tile surface — destructive action colour (§3c/§7)', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rule presence
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('the Remove (✕) action button uses the danger colour', () => {
		const block = css.match(/\.ntt-action-btn\[data-action="remove"\][^{]*\{[^}]*\}/s);
		expect(block).toBeTruthy();
		expect(block![0]).toMatch(/var\(--ntt-danger/);
	});

	it('the Remove (✕) is a FILLED danger button with background-independent separators', () => {
		const block = css.match(/\.ntt-action-btn\[data-action="remove"\][^{]*\{[^}]*\}/s);
		expect(block).toBeTruthy();
		// fill carries meaning; white ring saves it on dark/busy thumbs; drop shadow
		// saves it on white/light thumbs.
		expect(block![0]).toMatch(/background:\s*var\(--ntt-danger/);
		expect(block![0]).toMatch(/box-shadow:[^;]*rgba\(255,\s*255,\s*255[^;]*rgba\(0,\s*0,\s*0/);
		// larger than the trio (so it reads as the important one)
		expect(block![0]).toMatch(/\+\s*2px/);
	});

	it('each action button carries its own surface (shared float shadow) — no unified bar behind the cluster', () => {
		// The cluster container must NOT paint a scrim/bar behind all four buttons.
		const cluster = css.match(/\.ntt-actions\s*\{[^}]*\}/s);
		expect(cluster).toBeTruthy();
		expect(cluster![0]).not.toMatch(/background:/);
		// Each neutral button gets the shared ring + drop shadow token so it reads on
		// any background (white-on-white / dark-on-dark).
		const btn = css.match(/\.ntt-action-btn\s*\{[^}]*\}/s);
		expect(btn).toBeTruthy();
		expect(btn![0]).toMatch(/box-shadow:\s*var\(--ntt-float-shadow\)/);
	});

	it('action buttons, drag handle, and "+ Pin tile" all share the SAME float-shadow treatment', () => {
		const usesFloat = (re: RegExp) => {
			const m = css.match(re);
			expect(m, `rule not found: ${re}`).toBeTruthy();
			return /box-shadow:\s*var\(--ntt-float-shadow\)/.test(m![0]);
		};
		expect(usesFloat(/\.ntt-action-btn\s*\{[^}]*\}/s)).toBe(true);
		expect(usesFloat(/:root\[drawer-open\]\s+\.newtab-site\[pinned\]\s+\.ntt-drag-handle\s*\{[^}]*\}/s)).toBe(true);
		expect(usesFloat(/\.ntt-add-tile-chip\s*\{[^}]*\}/s)).toBe(true);
	});
});

describe('tile surface — behavioral (§3c)', () => {
	it('renders a kebab icon at rest', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const kebab = site.node.querySelector('.ntt-actions-kebab');
		expect(kebab).toBeTruthy();
		expect(kebab.querySelector('svg')).toBeTruthy();
		cleanup();
	});

	it('the hover row has exactly the 4 §3c actions, Remove last', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const actions = Array.from(site.node.querySelectorAll('.ntt-action-btn'))
			.map((b: any) => b.getAttribute('data-action'));
		expect(actions).toEqual(['edit', 'never-capture', 'pin', 'remove']);
		cleanup();
	});
});
