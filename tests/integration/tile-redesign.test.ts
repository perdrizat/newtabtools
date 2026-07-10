/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountSite, ensureSiteEnv, readNewTabHtml } from './_helpers';
// page-modules P5 (PAGE_MODULES.md): fx-newTab.js's Site now real-imports
// `Prefs`/`TileStats`/`NeverCapture` (from prefs.js/stats.js) instead of
// reading them off `globalThis` — a stand-in object assigned over
// `globalThis.X` is invisible to that binding (the P3/P4 "second-order
// fallout" precedent), so this suite mutates the same real singletons'
// properties/methods in place instead of replacing them. Static imports of
// these leaf modules are fine here (unlike the monoliths) — they were
// already part of the typed program since P2/P3.
import { Prefs, NeverCapture } from '../../webextension/prefs.js';
import { TileStats } from '../../webextension/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

// The tile-template markup claims that used to live here as source-string
// assertions (`.newtab-site` draggable, `.newtab-link`/`.newtab-thumbnail`,
// `.ntt-pin-stripe`, `.ntt-overlay`/`.ntt-favicon`/`.newtab-title`,
// `.ntt-actions`, `.ntt-stat-chip`, the retired `.newtab-control-*` classes)
// are deleted — audit 2026-06-10-code-review.md §5.5's "redundant layer"
// finding: they duplicated a genuinely good E2E suite
// (tests/e2e/tile-redesign.test.ts, which exercises every one of these
// against the real rendered page: draggable via
// tests/e2e/css-grid-layout.test.ts:196, .newtab-link via
// tests/e2e/lock-grid.test.ts:188 and drawer.test.ts:325, .ntt-overlay/
// .ntt-favicon/.newtab-title/.ntt-actions/.ntt-pin-stripe/.newtab-thumbnail
// and the "old .newtab-control gone" check all in
// tests/e2e/tile-redesign.test.ts) — so the source-string layer was pure
// noise sitting on top of it, breaking on harmless refactors without adding
// coverage. See the per-assertion disposition table in the H-cleanup task
// report for the full mapping.

// Direct regression test for MODERNIZATION.md Stage H, slice H2's named risk
// ("H2 silent mis-nesting"): self-closed non-void tags (`<span ... />`) parse
// fine under XML but, under an HTML5 parser, the "/" is ignored and every
// following sibling is silently swallowed as a *descendant* instead of a
// sibling. This used to hardcode the tile template's 8-class sibling manifest
// (audit 2026-07-09-modernization-h-code-review.md #6 — any legitimate
// template edit broke the test and forced a hand-sync). It's generalized here
// into a structural invariant that covers EVERY `<template>` in newTab.html
// (audit #2's other mitigation option) without naming any class: for each
// template, independently compute the element-count-per-nesting-depth the
// source markup INTENDS (honoring `<tag ... />` as a literal self-close,
// regardless of whether HTML5 treats that tag as void) and compare it to the
// depth profile the real HTML5 parser actually produced. A non-void
// self-closed tag makes the two profiles diverge — the "/" is ignored, the
// tag stays open, and every following sibling becomes its descendant instead,
// shifting depth counts. Template edits that stay well-formed leave both
// profiles equal; a template edit is free to add/remove/reorder elements.
describe('Tile template structural integrity — HTML5 mis-nesting regression guard (Stage H2)', () => {
	const VOID_ELEMENTS = new Set([
		'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
		'link', 'meta', 'source', 'track', 'wbr',
	]);

	/**
	 * Element count per nesting depth (depth 1 = direct children of `root`) as
	 * an HTML5 parser (jsdom / Firefox) actually built the tree.
	 */
	function domDepthProfile(root: DocumentFragment | Element): Record<number, number> {
		const profile: Record<number, number> = {};
		function walk(el: Element, depth: number) {
			profile[depth] = (profile[depth] || 0) + 1;
			Array.from(el.children).forEach(child => walk(child, depth + 1));
		}
		Array.from(root.children).forEach(child => walk(child as Element, 1));
		return profile;
	}

	/**
	 * The same depth profile computed by naively honoring what the markup
	 * SOURCE says: a tag written `<span ... />` is a self-close (a leaf),
	 * full stop — regardless of whether the tag is HTML5-void. This is what
	 * the author of a self-closed tag intends; comparing it against
	 * `domDepthProfile` is what catches the Stage H2 bug class.
	 */
	function naiveDepthProfile(rawInnerHtml: string): Record<number, number> {
		const profile: Record<number, number> = {};
		const stack: string[] = [];
		const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g;
		let m: RegExpExecArray | null;
		while ((m = tagRe.exec(rawInnerHtml))) {
			const closing = m[1];
			const tag = m[2].toLowerCase();
			const selfClose = m[3];
			if (closing) {
				const idx = stack.lastIndexOf(tag);
				if (idx !== -1) { stack.length = idx; }
				continue;
			}
			const depth = stack.length + 1;
			profile[depth] = (profile[depth] || 0) + 1;
			if (!selfClose && !VOID_ELEMENTS.has(tag)) {
				stack.push(tag);
			}
		}
		return profile;
	}

	it('every <template> in newTab.html: the real HTML5 parse matches what the source markup intends (no swallowed siblings)', () => {
		const realHtml = readNewTabHtml();
		const doc = new DOMParser().parseFromString(realHtml, 'text/html');
		const templates = Array.from(doc.querySelectorAll('template')) as HTMLTemplateElement[];
		expect(templates.length).toBeGreaterThan(0);

		const rawTemplates = [...realHtml.matchAll(/<template[^>]*>([\s\S]*?)<\/template>/g)].map(match => match[1]);
		expect(rawTemplates.length).toBe(templates.length);

		templates.forEach((template, i) => {
			const actual = domDepthProfile(template.content);
			const intended = naiveDepthProfile(rawTemplates[i]);
			expect(
				actual,
				`template #${i} (id="${template.id || '(anonymous)'}") mis-nests: ` +
				`the real parse ${JSON.stringify(actual)} does not match what the source intends ${JSON.stringify(intended)}`,
			).toEqual(intended);
		});
	});

	it('detection check: the profile comparison DOES catch a self-closed non-void tag swallowing its siblings', () => {
		// The pre-H2 tile-template shape verbatim (self-closed non-void spans,
		// as newTab.xhtml had it). Parsing it with the SAME DOMParser as above
		// confirms the invariant above is genuinely capable of catching the
		// mis-nesting bug, not just checking a tautology against markup that
		// was already fixed.
		const badTemplateInner = `
			<div class="newtab-site">
				<a class="newtab-link"><span class="newtab-thumbnail" /></a>
				<span class="ntt-pin-stripe" />
				<span class="ntt-stat-chip" />
			</div>
		`;
		const doc = new DOMParser().parseFromString(
			`<!DOCTYPE html><html><body><template id="bad">${badTemplateInner}</template></body></html>`,
			'text/html',
		);
		const template = doc.getElementById('bad') as HTMLTemplateElement;
		const actual = domDepthProfile(template.content);
		const intended = naiveDepthProfile(badTemplateInner);
		// The bug: `.ntt-pin-stripe`'s ignored "/" leaves it open, so
		// `.ntt-stat-chip` becomes its descendant instead of staying a direct
		// sibling of `.newtab-link` — the two profiles disagree.
		expect(actual).not.toEqual(intended);
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

	it('.ntt-action-btn stacks an extra hairline + drop shadow on the shared float shadow (UAT scenario 23 — light chip separation)', () => {
		// The base (light) chip blended white-on-white against mostly-white
		// thumbnails. A second box-shadow layer — a hairline ring using the
		// theme-adaptive --ntt-line token plus a soft drop shadow — is stacked
		// on top of the shared --ntt-float-shadow token so the chip stays
		// legible without changing the overall light-chip design.
		const rule = css.match(/\.ntt-action-btn\s*\{[^}]*\}/);
		expect(rule).toBeTruthy();
		const body = rule![0];
		expect(body).toMatch(/box-shadow:\s*var\(--ntt-float-shadow\)\s*,/);
		expect(body).toMatch(/var\(--ntt-line\)/);
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

	async function mountWithStat(stat: unknown) {
		// Force the one-time site-env setup (which seeds Prefs.statType = 'none')
		// to have already run before overriding it below — otherwise, if this is
		// the first mountSite()-family call in the file, that seed would run
		// AFTER this override (inside mountSite itself) and clobber it.
		await ensureSiteEnv();
		Prefs.statType = 'visits';
		TileStats.compute = vi.fn().mockResolvedValue(stat);
		return await mountSite({ url: 'https://example.com/', title: 'Example' });
	}

	afterEach(() => {
		// Restore the shared singletons so later blocks see the default 'none'.
		Prefs.statType = 'none';
		TileStats.compute = vi.fn().mockResolvedValue(null);
	});

	it('a fresh stat sets [data-stat-fresh] and shows no text', async () => {
		const { site, cleanup } = await mountWithStat({ type: 'fresh' });
		await tick();
		const chip = site.node.querySelector('.ntt-stat-chip');
		expect(chip.hasAttribute('data-stat-fresh')).toBe(true);
		expect(chip.textContent).toBe('');
		cleanup();
	});

	it('a non-fresh (trend) stat clears [data-stat-fresh] and shows the value', async () => {
		const { site, cleanup } = await mountWithStat({ type: 'trend', dir: 'up', value: 5 });
		await tick();
		const chip = site.node.querySelector('.ntt-stat-chip');
		expect(chip.hasAttribute('data-stat-fresh')).toBe(false);
		expect(chip.textContent).toBe('↑5');
		cleanup();
	});

	it('statType none leaves the chip empty with no [data-stat-fresh]', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const chip = site.node.querySelector('.ntt-stat-chip');
		expect(chip.hasAttribute('data-stat-fresh')).toBe(false);
		expect(chip.textContent).toBe('');
		cleanup();
	});

	it('_renderFavicon renders the domain glyph via the shared siteGlyph helper', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
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
	it('Site with no thumbnail renders .ntt-logo-fallback with glyph and brand color', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example', backgroundColor: '#c96442' });
		const fallback = site.node.querySelector('.ntt-logo-fallback');
		expect(fallback).toBeTruthy();
		expect(fallback.style.getPropertyValue('--ntt-brand')).toBe('#c96442');
		const glyph = fallback.querySelector('.ntt-logo-glyph');
		expect(glyph).toBeTruthy();
		expect(glyph.textContent).toBe('E');
		cleanup();
	});

	it('Site with link.image does NOT render a fallback', async () => {
		const { site, cleanup } = await mountSite({
			url: 'https://example.com/', title: 'Example',
			image: new Blob(['img'], { type: 'image/png' }),
			imageIsThumbnail: true,
		});
		const fallback = site.node.querySelector('.ntt-logo-fallback');
		expect(fallback).toBeNull();
		cleanup();
	});

	it('updateAttributes(true) sets [pinned] on site node and updates pin button title', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		site.updateAttributes(true);
		expect(site.node.hasAttribute('pinned')).toBe(true);
		const pinBtn = site.node.querySelector('.ntt-action-btn[data-action="pin"]');
		expect(pinBtn).toBeTruthy();
		expect(pinBtn.getAttribute('title')).toBe('tile_unpin');
		cleanup();
	});

	it('updateAttributes(false) removes [pinned] from site node', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		site.updateAttributes(true);
		site.updateAttributes(false);
		expect(site.node.hasAttribute('pinned')).toBe(false);
		const pinBtn = site.node.querySelector('.ntt-action-btn[data-action="pin"]');
		expect(pinBtn.getAttribute('title')).toBe('tile_pin');
		cleanup();
	});

	it('_renderActions produces 4 buttons in §3c order (no "open in new tab")', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btns = site.node.querySelectorAll('.ntt-action-btn');
		expect(btns.length).toBe(4);
		const actions = Array.from(btns).map((b: any) => b.getAttribute('data-action'));
		expect(actions).toEqual(['edit', 'never-capture', 'pin', 'remove']);
		cleanup();
	});

	it('action button SVG icons are 16px (medium size)', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const svg = site.node.querySelector('.ntt-action-btn svg');
		expect(svg).toBeTruthy();
		expect(svg.getAttribute('width')).toBe('16');
		expect(svg.getAttribute('height')).toBe('16');
		cleanup();
	});

	it('_renderLogoFallback rejects malicious backgroundColor — falls back to a safe domain-hash color', async () => {
		// Phase 4-5 + follow-up: instead of the fixed `#666` grey, an invalid
		// `link.backgroundColor` falls through to the domain-hash colour,
		// which now emits OKLCH (was HSL). The security intent (CSS
		// injection rejected) is unchanged — only the colour-space changed.
		const { site, cleanup } = await mountSite({
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
		// Reset the real NeverCapture singleton's methods to default (not
		// listed) before each test.
		NeverCapture.matches = vi.fn(() => false);
		NeverCapture.matchingEntry = vi.fn(() => undefined);
		NeverCapture.add = vi.fn().mockResolvedValue(undefined);
		NeverCapture.remove = vi.fn().mockResolvedValue(undefined);
		NeverCapture.getList = vi.fn(() => []);
		// Reset sendMessage spy.
		(globalThis as any).chrome.runtime.sendMessage = vi.fn();
	});

	it('never-capture button has data-action="never-capture", data-icon="camera-off", correct title, and no never-capture attribute when not listed', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]');
		expect(btn).toBeTruthy();
		expect(btn.getAttribute('data-icon')).toBe('camera-off');
		expect(btn.getAttribute('title')).toBe('tile_never_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(false);
		cleanup();
	});

	it('never-capture button shows camera icon and allow title when site is listed', async () => {
		NeverCapture.matches = vi.fn(() => true);
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]');
		expect(btn).toBeTruthy();
		expect(btn.getAttribute('data-icon')).toBe('camera');
		expect(btn.getAttribute('title')).toBe('tile_allow_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(true);
		cleanup();
	});

	it('click when unlisted calls NeverCapture.add with host and sends purgeHost message', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		expect(NeverCapture.add).toHaveBeenCalledWith('example.com');
		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.purgeHost', host: 'example.com' }),
			expect.any(Function),
		);
		cleanup();
	});

	it('click when unlisted flips button to camera icon and sets never-capture attribute', async () => {
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		// After click the site is now listed; button should reflect listed state.
		expect(btn.getAttribute('data-icon')).toBe('camera');
		expect(btn.getAttribute('title')).toBe('tile_allow_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(true);
		cleanup();
	});

	it('click when listed calls NeverCapture.remove and does NOT send purgeHost message', async () => {
		NeverCapture.matches = vi.fn(() => true);
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		expect(NeverCapture.remove).toHaveBeenCalledWith('example.com');
		expect((globalThis as any).chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.purgeHost' }),
			expect.anything(),
		);
		cleanup();
	});

	it('click when listed flips button back to camera-off icon and removes never-capture attribute', async () => {
		NeverCapture.matches = vi.fn(() => true);
		const { site, cleanup } = await mountSite({ url: 'https://example.com/', title: 'Example' });
		const btn = site.node.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement;
		btn.click();
		expect(btn.getAttribute('data-icon')).toBe('camera-off');
		expect(btn.getAttribute('title')).toBe('tile_never_capture');
		expect(site.node.hasAttribute('never-capture')).toBe(false);
		cleanup();
	});
});
