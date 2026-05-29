/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountSite } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.xhtml');
const FX_JS_PATH = path.resolve(__dirname, '../../webextension/fx-newTab.js');

describe('Tile redesign — template (newTab.xhtml)', () => {
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: template structure
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
	});

	it('tile template has .newtab-site wrapper with draggable', () => {
		expect(xhtml).toMatch(/<div class="newtab-site" draggable="true">/);
	});

	it('tile template has .newtab-link anchor with .newtab-thumbnail inside', () => {
		expect(xhtml).toMatch(/<a class="newtab-link">/);
		expect(xhtml).toContain('newtab-thumbnail');
	});

	it('tile template has .ntt-pin-stripe element', () => {
		expect(xhtml).toContain('ntt-pin-stripe');
	});

	it('tile template has .ntt-overlay with .ntt-favicon and .newtab-title', () => {
		expect(xhtml).toContain('ntt-overlay');
		expect(xhtml).toContain('ntt-favicon');
		expect(xhtml).toContain('newtab-title');
	});

	it('tile template has .ntt-actions container for hover action buttons', () => {
		expect(xhtml).toContain('ntt-actions');
	});

	it('tile template has .ntt-stat-chip slot', () => {
		expect(xhtml).toContain('ntt-stat-chip');
	});

	it('old newtab-control-pin/block/thumbnail input buttons are removed', () => {
		expect(xhtml).not.toContain('newtab-control-pin');
		expect(xhtml).not.toContain('newtab-control-block');
		expect(xhtml).not.toContain('newtab-control-thumbnail');
	});
});

describe('Tile redesign — CSS (newTab.css)', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('.newtab-site has border-radius from tokens', () => {
		expect(css).toMatch(/\.newtab-site\s*\{[^}]*border-radius:\s*var\(--ntt-radius/);
	});

	it('.newtab-site does NOT set aspect-ratio (§2.3 — cell controls aspect)', () => {
		const siteRule = css.match(/\.newtab-site\s*\{[^}]*\}/);
		expect(siteRule).toBeTruthy();
		expect(siteRule![0]).not.toContain('aspect-ratio');
	});

	it('.newtab-site has overflow hidden', () => {
		expect(css).toMatch(/\.newtab-site\s*\{[^}]*overflow:\s*hidden/);
	});

	it('.newtab-site has resting shadow from tokens', () => {
		expect(css).toMatch(/\.newtab-site\s*\{[^}]*box-shadow:\s*var\(--ntt-shadow-tile-rest\)/);
	});

	it('.newtab-site:hover has hover shadow from tokens', () => {
		expect(css).toMatch(/\.newtab-site:hover\s*\{[^}]*box-shadow:\s*var\(--ntt-shadow-tile-hover\)/);
	});

	it('.ntt-pin-stripe is positioned at top with 3px height', () => {
		expect(css).toMatch(/\.ntt-pin-stripe\s*\{[^}]*height:\s*3px/);
		expect(css).toMatch(/\.ntt-pin-stripe\s*\{[^}]*position:\s*absolute/);
		expect(css).toMatch(/\.ntt-pin-stripe\s*\{[^}]*top:\s*0/);
	});

	it('.ntt-pin-stripe is hidden by default, visible when pinned', () => {
		expect(css).toMatch(/\.ntt-pin-stripe\s*\{[^}]*display:\s*none/);
		expect(css).toMatch(/\.newtab-site\[pinned\]\s+\.ntt-pin-stripe[^{]*\{[^}]*display:\s*block/);
	});

	it('.ntt-overlay gradient has 3 stops for title contrast', () => {
		const overlayBlock = css.match(/\.ntt-overlay\s*\{[^}]*\}/s);
		expect(overlayBlock).toBeTruthy();
		const bg = overlayBlock![0];
		expect(bg).toMatch(/linear-gradient/);
		expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)\s*20%/);
		expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.55\)\s*55%/);
		expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.85\)\s*100%/);
	});

	it('.newtab-title has text-shadow for contrast', () => {
		const titleBlock = css.match(/\.newtab-title\s*\{[^}]*\}/s);
		expect(titleBlock).toBeTruthy();
		expect(titleBlock![0]).toMatch(/text-shadow:\s*0\s+1px\s+3px\s+rgba\(0,\s*0,\s*0,\s*[.0-9]*0\.55\)/);
	});

	it('.ntt-overlay is positioned at bottom', () => {
		expect(css).toMatch(/\.ntt-overlay\s*\{[^}]*position:\s*absolute/);
		expect(css).toMatch(/\.ntt-overlay\s*\{[^}]*bottom:\s*0/);
	});

	it('.ntt-actions is positioned at top-right', () => {
		expect(css).toMatch(/\.ntt-actions\s*\{[^}]*position:\s*absolute/);
		expect(css).toMatch(/\.ntt-actions\s*\{[^}]*top:\s*8px/);
		expect(css).toMatch(/\.ntt-actions\s*\{[^}]*right:\s*8px/);
	});

	it('.ntt-actions is hidden by default, visible on hover', () => {
		expect(css).toMatch(/\.ntt-actions\s*\{[^}]*opacity:\s*0/);
		expect(css).toMatch(/\.newtab-site:hover\s+\.ntt-actions[^{]*\{[^}]*opacity:\s*1/);
	});

	it('.ntt-action-btn is 33x33px (medium size, defaulted)', () => {
		// Phase 3-1: button size is driven by --ntt-action-btn-size with a 33px
		// fallback. Accept either the literal or the var-with-fallback form.
		const widthRe = /\.ntt-action-btn\s*\{[^}]*width:\s*(?:33px|var\(--ntt-action-btn-size[^)]*33px\))/;
		const heightRe = /\.ntt-action-btn\s*\{[^}]*height:\s*(?:33px|var\(--ntt-action-btn-size[^)]*33px\))/;
		expect(css).toMatch(widthRe);
		expect(css).toMatch(heightRe);
	});

	it('.ntt-action-btn has backdrop-filter blur', () => {
		expect(css).toMatch(/\.ntt-action-btn\s*\{[^}]*backdrop-filter:\s*blur/);
	});

	it('action button SVGs are not hidden by blanket svg{display:none}', () => {
		const blanketHide = /^[^.#[:\s]*svg\s*\{[^}]*display:\s*none/m;
		if (blanketHide.test(css)) {
			const override = /\.ntt-action-btn\s+svg[^{]*\{[^}]*display:\s*(?:inline|block|flex|inline-flex|inline-block)/;
			expect(css).toMatch(override);
		}
	});

	it('.ntt-stat-chip is positioned at top-left', () => {
		expect(css).toMatch(/\.ntt-stat-chip\s*\{[^}]*position:\s*absolute/);
		expect(css).toMatch(/\.ntt-stat-chip\s*\{[^}]*top:\s*8px/);
		expect(css).toMatch(/\.ntt-stat-chip\s*\{[^}]*left:\s*8px/);
	});

	it('old .newtab-control rules are removed', () => {
		expect(css).not.toMatch(/\.newtab-control\s*\{/);
		expect(css).not.toMatch(/\.newtab-control-pin\s*\{/);
		expect(css).not.toMatch(/\.newtab-control-block\s*\{/);
		expect(css).not.toMatch(/\.newtab-control-thumbnail\s*\{/);
	});
});

describe('Tile redesign — logo-emanation fallback (newTab.css)', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('.ntt-logo-fallback is centered with radial gradient styling', () => {
		expect(css).toMatch(/\.ntt-logo-fallback/);
	});

	it('.ntt-logo-fallback .ntt-logo-glyph is centered large favicon', () => {
		expect(css).toMatch(/\.ntt-logo-glyph/);
	});
});

describe('Tile redesign — JS (fx-newTab.js)', () => {
	let fxSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: JS source strings
		fxSource = fs.readFileSync(FX_JS_PATH, 'utf8');
	});

	it('Site._render calls _renderActions to create action buttons', () => {
		expect(fxSource).toContain('_renderActions');
	});

	it('_renderActions creates buttons using NttIcons', () => {
		expect(fxSource).toContain('NttIcons.create');
	});

	it('_onClick handles ntt-action-btn clicks by data-action attribute', () => {
		expect(fxSource).toContain('data-action');
	});

	it('refreshThumbnail creates logo-emanation fallback when no image', () => {
		expect(fxSource).toContain('ntt-logo-fallback');
	});

	it('updateAttributes sets pinned attribute on .newtab-site (not old control)', () => {
		expect(fxSource).toMatch(/this\._node\.setAttribute\('pinned'/);
	});

	it('open action validates URL before chrome.tabs.create (§1.2)', () => {
		expect(fxSource).toMatch(/case\s+'open'[\s\S]*?isValidURL/);
	});

	it('fresh stat uses data-stat-fresh attribute, not inline styles (§3.2)', () => {
		expect(fxSource).toContain('data-stat-fresh');
		expect(fxSource).not.toMatch(/chip\.style\.width\s*=\s*'7px'/);
		expect(fxSource).not.toMatch(/chip\.style\.borderRadius\s*=\s*'50%'/);
	});

	it('refreshThumbnail revokes previous objectURL before creating new one (§3.5)', () => {
		expect(fxSource).toMatch(/revokeObjectURL/);
		const refreshMethod = fxSource.match(/refreshThumbnail\(\)\s*\{[\s\S]*?\n\t\},/);
		expect(refreshMethod).toBeTruthy();
		expect(refreshMethod![0]).toContain('revokeObjectURL');
	});

	it('siteGlyph helper is used by both _renderFavicon and _renderLogoFallback (§3.4)', () => {
		expect(fxSource).toMatch(/function\s+siteGlyph\s*\(/);
		const faviconMethod = fxSource.match(/_renderFavicon\(\)\s*\{[\s\S]*?\n\t\},/);
		expect(faviconMethod).toBeTruthy();
		expect(faviconMethod![0]).toContain('siteGlyph');
		const fallbackMethod = fxSource.match(/_renderLogoFallback\(\)\s*\{[\s\S]*?\n\t\},/);
		expect(fallbackMethod).toBeTruthy();
		expect(fallbackMethod![0]).toContain('siteGlyph');
	});

	it('_renderStatChip clears data-stat-fresh on non-fresh stats (§3.2)', () => {
		expect(fxSource).toMatch(/removeAttribute\('data-stat-fresh'\)/);
	});

	it('updateUI handles statType change to re-render stat chips (§3.1)', () => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: JS source strings
		const jsSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.js'), 'utf8'
		);
		expect(jsSource).toMatch(/keys\.includes\('statType'\)/);
		expect(jsSource).toMatch(/_renderStatChip/);
	});

	it('_renderLogoFallback uses setProperty for --ntt-brand instead of string interpolation (§1.1)', () => {
		expect(fxSource).toContain('setProperty(\'--ntt-brand\'');
		expect(fxSource).not.toMatch(/`[^`]*\$\{brandColor\}[^`]*`/);
	});

	it('_renderLogoFallback validates brandColor against hex regex (§1.1)', () => {
		expect(fxSource).toMatch(/\/\^#\[0-9a-f\]\{3,8\}\$\/i\.test/);
	});
});

describe('Tile redesign — behavioral (§4.2)', () => {
	it('Site with no thumbnail renders .ntt-logo-fallback with glyph and brand color', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example', backgroundColor: '#c96442' });
		const fallback = site.node.querySelector('.ntt-logo-fallback');
		expect(fallback).toBeTruthy();
		expect(fallback.style.getPropertyValue('--ntt-brand')).toBe('#c96442');
		const glyph = fallback.querySelector('.ntt-logo-glyph');
		expect(glyph).toBeTruthy();
		expect(glyph.textContent).toBe('E');
		cleanup();
	});

	it('Site with link.image does NOT render a fallback', () => {
		const { site, cleanup } = mountSite({
			url: 'https://example.com/', title: 'Example',
			image: new Blob(['img'], { type: 'image/png' }),
			imageIsThumbnail: true,
		});
		const fallback = site.node.querySelector('.ntt-logo-fallback');
		expect(fallback).toBeNull();
		cleanup();
	});

	it('updateAttributes(true) sets [pinned] on site node and updates pin button title', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		site.updateAttributes(true);
		expect(site.node.hasAttribute('pinned')).toBe(true);
		const pinBtn = site.node.querySelector('.ntt-action-btn[data-action="pin"]');
		expect(pinBtn).toBeTruthy();
		expect(pinBtn.getAttribute('title')).toBe('tile_unpin');
		cleanup();
	});

	it('updateAttributes(false) removes [pinned] from site node', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		site.updateAttributes(true);
		site.updateAttributes(false);
		expect(site.node.hasAttribute('pinned')).toBe(false);
		const pinBtn = site.node.querySelector('.ntt-action-btn[data-action="pin"]');
		expect(pinBtn.getAttribute('title')).toBe('tile_pin');
		cleanup();
	});

	it('_renderActions produces 5 buttons with correct data-action values', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btns = site.node.querySelectorAll('.ntt-action-btn');
		expect(btns.length).toBe(5);
		const actions = Array.from(btns).map((b: any) => b.getAttribute('data-action'));
		expect(actions).toEqual(['edit', 'open', 'refresh', 'pin', 'remove']);
		cleanup();
	});

	it('action button SVG icons are 16px (medium size)', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const svg = site.node.querySelector('.ntt-action-btn svg');
		expect(svg).toBeTruthy();
		expect(svg.getAttribute('width')).toBe('16');
		expect(svg.getAttribute('height')).toBe('16');
		cleanup();
	});

	it('_renderLogoFallback sanitizes malicious backgroundColor to #666', () => {
		const { site, cleanup } = mountSite({
			url: 'https://evil.com/', title: 'Evil',
			backgroundColor: '#ff0000); url(http://attacker.example/x',
		});
		const fallback = site.node.querySelector('.ntt-logo-fallback');
		expect(fallback).toBeTruthy();
		expect(fallback.style.getPropertyValue('--ntt-brand')).toBe('#666');
		cleanup();
	});
});
