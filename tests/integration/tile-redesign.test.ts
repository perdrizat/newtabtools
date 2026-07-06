/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountSite } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.xhtml');

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

	it('.ntt-overlay gradient ramps into a near-solid dark floor (§3a)', () => {
		// §3a: a pure fade-to-transparent gave white titles nothing to sit on
		// over light thumbnails. The ramp now starts lower (12%), reaches a
		// mid-strength floor by 50%, and lands near-solid at the bottom.
		const overlayBlock = css.match(/\.ntt-overlay\s*\{[^}]*\}/s);
		expect(overlayBlock).toBeTruthy();
		const bg = overlayBlock![0];
		expect(bg).toMatch(/linear-gradient/);
		expect(bg).toMatch(/transparent\s+12%/);
		expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.45\)\s*50%/);
		expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.85\)\s*100%/);
	});

	it('.newtab-title has text-shadow for contrast (§3a — strengthened to 0.6)', () => {
		const titleBlock = css.match(/\.newtab-title\s*\{[^}]*\}/s);
		expect(titleBlock).toBeTruthy();
		expect(titleBlock![0]).toMatch(/text-shadow:\s*0\s+1px\s+3px\s+rgba\(0,\s*0,\s*0,\s*[.0-9]*0\.6\)/);
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

// The fx-newTab.js behaviours that used to be asserted as source-string matches
// (`expect(fxSource).toContain('_renderActions')`, etc.) are now covered
// behaviorally: action buttons + the removed "open" action in the §4.2 suite
// below, brand-color sanitisation there too, and objectURL revocation in
// objecturl-revoke.test.ts. The two stat-chip checks and the siteGlyph-sharing
// claim had no behavioral counterpart — they're real tests now.
describe('Tile redesign — stat chip + favicon glyph (behavioral, §3.2/§3.4)', () => {
	const tick = () => new Promise(r => setTimeout(r, 0));

	function mountWithStat(stat: unknown) {
		(globalThis as any).Prefs = (globalThis as any).Prefs || {};
		(globalThis as any).Prefs.statType = 'visits';
		(globalThis as any).TileStats = (globalThis as any).TileStats || {};
		(globalThis as any).TileStats.compute = vi.fn().mockResolvedValue(stat);
		return mountSite({ url: 'https://example.com/', title: 'Example' });
	}

	afterEach(() => {
		// Restore the shared globals so later blocks see the default 'none'.
		if ((globalThis as any).Prefs) { (globalThis as any).Prefs.statType = 'none'; }
		if ((globalThis as any).TileStats) { (globalThis as any).TileStats.compute = vi.fn().mockResolvedValue(null); }
	});

	it('a fresh stat sets [data-stat-fresh] and shows no text', async () => {
		const { site, cleanup } = mountWithStat({ type: 'fresh' });
		await tick();
		const chip = site.node.querySelector('.ntt-stat-chip');
		expect(chip.hasAttribute('data-stat-fresh')).toBe(true);
		expect(chip.textContent).toBe('');
		cleanup();
	});

	it('a non-fresh (trend) stat clears [data-stat-fresh] and shows the value', async () => {
		const { site, cleanup } = mountWithStat({ type: 'trend', dir: 'up', value: 5 });
		await tick();
		const chip = site.node.querySelector('.ntt-stat-chip');
		expect(chip.hasAttribute('data-stat-fresh')).toBe(false);
		expect(chip.textContent).toBe('↑5');
		cleanup();
	});

	it('statType none leaves the chip empty with no [data-stat-fresh]', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const chip = site.node.querySelector('.ntt-stat-chip');
		expect(chip.hasAttribute('data-stat-fresh')).toBe(false);
		expect(chip.textContent).toBe('');
		cleanup();
	});

	it('_renderFavicon renders the domain glyph via the shared siteGlyph helper', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const favicon = site.node.querySelector('.ntt-favicon');
		// Same glyph the logo-fallback test asserts (siteGlyph is shared by both).
		expect(favicon.textContent).toBe('E');
		cleanup();
	});
});

describe('Tile redesign — controller wiring (newTab.js, §3.1)', () => {
	it('updateUI re-renders stat chips when the statType pref changes', () => {
		// Structural wiring check on the controller: updateUI must branch on a
		// statType key change and call the per-tile stat renderer — there's no
		// behavioral seam without booting the full newTabTools controller.
		// eslint-disable-next-line ntt/no-source-grep -- controller wiring, not behavior-substitutable
		const jsSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.js'), 'utf8'
		);
		expect(jsSource).toMatch(/keys\.includes\('statType'\)/);
		expect(jsSource).toMatch(/_renderStatChip/);
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

	it('_renderActions produces 4 buttons in §3c order (no "open in new tab")', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btns = site.node.querySelectorAll('.ntt-action-btn');
		expect(btns.length).toBe(4);
		const actions = Array.from(btns).map((b: any) => b.getAttribute('data-action'));
		expect(actions).toEqual(['edit', 'never-capture', 'pin', 'remove']);
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

	it('_renderLogoFallback rejects malicious backgroundColor — falls back to a safe domain-hash color', () => {
		// Phase 4-5 + follow-up: instead of the fixed `#666` grey, an invalid
		// `link.backgroundColor` falls through to the domain-hash colour,
		// which now emits OKLCH (was HSL). The security intent (CSS
		// injection rejected) is unchanged — only the colour-space changed.
		const { site, cleanup } = mountSite({
			url: 'https://evil.com/', title: 'Evil',
			backgroundColor: '#ff0000); url(http://attacker.example/x',
		});
		const fallback = site.node.querySelector('.ntt-logo-fallback');
		expect(fallback).toBeTruthy();
		const brand = fallback.style.getPropertyValue('--ntt-brand');
		// The malicious payload must NOT have leaked into the inline style.
		expect(brand).not.toMatch(/url\(/);
		expect(brand).not.toMatch(/attacker/);
		// And the fallback shape is a deterministic safe oklch() value.
		expect(brand).toMatch(/^oklch\(65% 0\.13 \d+(\.\d+)?\)$/);
		cleanup();
	});
});

describe('Tile redesign — never-capture action button (slice 4)', () => {
	beforeEach(() => {
		// Reset NeverCapture to default (not listed) before each test.
		(globalThis as any).NeverCapture = {
			matches: vi.fn(() => false),
			matchingEntry: vi.fn(() => undefined),
			add: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			getList: vi.fn(() => []),
		};
		// Reset sendMessage spy.
		(globalThis as any).chrome.runtime.sendMessage = vi.fn();
	});

	it('never-capture button has data-action="never-capture", data-icon="camera-off", correct title, and no never-capture attribute when not listed', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]');
		expect(btn).toBeTruthy();
		expect(btn.getAttribute('data-icon')).toBe('camera-off');
		expect(btn.getAttribute('title')).toBe('tile_never_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(false);
		cleanup();
	});

	it('never-capture button shows camera icon and allow title when site is listed', () => {
		(globalThis as any).NeverCapture.matches = vi.fn(() => true);
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]');
		expect(btn).toBeTruthy();
		expect(btn.getAttribute('data-icon')).toBe('camera');
		expect(btn.getAttribute('title')).toBe('tile_allow_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(true);
		cleanup();
	});

	it('click when unlisted calls NeverCapture.add with host and sends purgeHost message', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		expect((globalThis as any).NeverCapture.add).toHaveBeenCalledWith('example.com');
		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.purgeHost', host: 'example.com' }),
			expect.any(Function),
		);
		cleanup();
	});

	it('click when unlisted flips button to camera icon and sets never-capture attribute', () => {
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		// After click the site is now listed; button should reflect listed state.
		expect(btn.getAttribute('data-icon')).toBe('camera');
		expect(btn.getAttribute('title')).toBe('tile_allow_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(true);
		cleanup();
	});

	it('click when listed calls NeverCapture.remove and does NOT send purgeHost message', () => {
		(globalThis as any).NeverCapture.matches = vi.fn(() => true);
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		expect((globalThis as any).NeverCapture.remove).toHaveBeenCalledWith('example.com');
		expect((globalThis as any).chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.purgeHost' }),
			expect.anything(),
		);
		cleanup();
	});

	it('click when listed flips button back to camera-off icon and removes never-capture attribute', () => {
		(globalThis as any).NeverCapture.matches = vi.fn(() => true);
		const { site, cleanup } = mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		expect(btn.getAttribute('data-icon')).toBe('camera-off');
		expect(btn.getAttribute('title')).toBe('tile_never_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(false);
		cleanup();
	});
});
