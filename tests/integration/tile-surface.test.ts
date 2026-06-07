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
import { mountSite } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.xhtml');

describe('tile surface — kebab-at-rest affordance (§3c)', () => {
	let css: string;
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: template + CSS structure
		css = fs.readFileSync(CSS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: template structure
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
	});

	it('tile template carries a .ntt-actions-kebab rest affordance', () => {
		expect(xhtml).toContain('ntt-actions-kebab');
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
		expect(actions).toEqual(['edit', 'refresh', 'pin', 'remove']);
		cleanup();
	});
});
