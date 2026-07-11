/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Three Phase 4-5 follow-ups (all driven by user-visible bugs the prior
 * tests missed):
 *
 *   1. **Favicon overlay badge.** The captured-favicon Blob landed in IDB
 *      but the `.ntt-favicon` badge in `.ntt-overlay` still painted only a
 *      letter glyph, and `getFavicons` filtered to fallback-only tiles so
 *      the moment a screenshot covered the fallback the favicon was never
 *      read back. `applyFavicon` now also swaps the `.ntt-favicon` text for
 *      an `<img>` rendered from the blob, and `getFavicons` queries every
 *      tile whose badge isn't yet an `<img>`.
 *
 *   2. **OKLCH brand colours.** `siteBrandColor` emits
 *      `oklch(65% 0.13 <hue>)` instead of `hsl(<hue>, 55%, 52%)` — same
 *      hostname hash, but perceptually-uniform across hues so white glyph
 *      text has consistent contrast.
 *
 *   3. **State-aware pin/unpin icon.** `_renderActions` picks `pin`
 *      (Lucide-style outline thumbtack) for unpinned tiles and `unpin`
 *      (thumbtack with diagonal slash — Lucide `pin-off`) for pinned tiles.
 *      `updateAttributes` swaps the icon when state changes so toggling
 *      reflects immediately.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { el } from '../../webextension/dom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_PATH = path.resolve(__dirname, '../../webextension/site.js');
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const ICONS_PATH = path.resolve(__dirname, '../../webextension/icons.js');

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

function extractTopLevelFunction(source: string, name: string): string {
	const sig = new RegExp(`^function\\s+${name}\\s*\\(`, 'm');
	const m = source.match(sig);
	if (!m || m.index === undefined) { throw new Error(`top-level ${name} not found`); }
	let depth = 0;
	const start = m.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

// ===========================================================================
// 1. Favicon overlay badge
// ===========================================================================

describe('applyFavicon — overlay badge is updated too', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading method for behavioral test
		const source = fs.readFileSync(SITE_PATH, 'utf8');
		const body = extractMethod(source, 'applyFavicon');
		const code = `var _applyHarness = { ${body} };`;
		// chrome-prep C2: `applyFavicon`'s img-swap block now calls the
		// page-side `el()` leaf (webextension/dom.js) as a bare identifier —
		// this harness vm.runInThisContext-extracts only the method body, not
		// the real module's `import` statements, so the dependency has to be
		// exposed on the shared globalThis instead.
		(globalThis as any).el = el;
		vm.runInThisContext(code, { filename: 'apply-favicon-overlay-harness.js' });
		harness = (globalThis as any)._applyHarness;
	});

	beforeEach(() => {
		(URL as any).createObjectURL = vi.fn(() => 'blob:fake-url');
		(URL as any).revokeObjectURL = vi.fn();
	});

	function buildSite(opts: { withFallback: boolean; withOverlayBadge: boolean }) {
		document.body.innerHTML = '';
		const node = document.createElement('div');
		node.className = 'newtab-site';
		const thumb = document.createElement('div');
		thumb.className = 'newtab-thumbnail';
		node.appendChild(thumb);
		if (opts.withFallback) {
			const fb = document.createElement('div');
			fb.className = 'ntt-logo-fallback';
			const glyph = document.createElement('div');
			glyph.className = 'ntt-logo-glyph';
			glyph.textContent = 'E';
			fb.appendChild(glyph);
			thumb.appendChild(fb);
		}
		if (opts.withOverlayBadge) {
			const overlay = document.createElement('div');
			overlay.className = 'ntt-overlay';
			const badge = document.createElement('div');
			badge.className = 'ntt-favicon';
			badge.textContent = 'E';
			overlay.appendChild(badge);
			node.appendChild(overlay);
		}
		document.body.appendChild(node);
		return {
			node,
			_querySelector(sel: string) { return node.querySelector(sel); },
		};
	}

	it('replaces the .ntt-favicon badge text with an <img> when a blob is supplied', () => {
		const site = buildSite({ withFallback: false, withOverlayBadge: true });
		harness.applyFavicon.call(site, new Blob(['x'], { type: 'image/png' }));
		const badge = site.node.querySelector('.ntt-favicon')!;
		expect(badge.textContent).toBe('');
		const img = badge.querySelector('img') as HTMLImageElement;
		expect(img).not.toBeNull();
		expect(img.src).toBe('blob:fake-url');
	});

	it('updates both the big fallback glyph AND the small overlay badge in one call', () => {
		const site = buildSite({ withFallback: true, withOverlayBadge: true });
		harness.applyFavicon.call(site, new Blob(['x']));
		expect(site.node.querySelector('.ntt-logo-fallback img.ntt-logo-favicon')).not.toBeNull();
		expect(site.node.querySelector('.ntt-favicon img')).not.toBeNull();
	});

	it('still no-ops when neither target is present', () => {
		const site = buildSite({ withFallback: false, withOverlayBadge: false });
		harness.applyFavicon.call(site, new Blob(['x']));
		expect(site.node.querySelector('img')).toBeNull();
	});

	it('still no-ops on null blob', () => {
		const site = buildSite({ withFallback: true, withOverlayBadge: true });
		harness.applyFavicon.call(site, null);
		expect(site.node.querySelector('img')).toBeNull();
	});
});

describe('getFavicons — queries every tile that does not yet have a badge <img>', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading method for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const body = extractMethod(source, 'getFavicons');
		// chrome-prep C5a (CHROME_PREP.md): `getFavicons` now reads the
		// module-level `api` namespace leaf instead of a bare `chrome.*`
		// reference — declared here as a live-resolving stand-in (mirrors
		// webextension/api.js's own Proxy) so each test's `globalThis.chrome`
		// override below still takes effect at call time.
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var _favHarness = { ${body} };`;
		vm.runInThisContext(code, { filename: 'get-favicons-overlay-harness.js' });
		harness = (globalThis as any)._favHarness;
	});

	beforeEach(() => {
		(globalThis as any).Grid = undefined;
		(globalThis as any).chrome = undefined;
		(globalThis as any).browser = undefined;
	});

	function makeSite(url: string, opts: { hasFallback?: boolean; badgeHasImg?: boolean }) {
		const root = document.createElement('div');
		const badge = document.createElement('div'); badge.className = 'ntt-favicon';
		if (opts.badgeHasImg) {
			const img = document.createElement('img'); badge.appendChild(img);
		}
		root.appendChild(badge);
		const thumb = document.createElement('div'); thumb.className = 'newtab-thumbnail';
		if (opts.hasFallback) {
			const fb = document.createElement('div'); fb.className = 'ntt-logo-fallback';
			thumb.appendChild(fb);
		}
		root.appendChild(thumb);
		return {
			link: { url },
			applyFavicon: vi.fn(),
			thumbnail: thumb,
			_root: root,
			_querySelector(sel: string) { return root.querySelector(sel); },
		};
	}

	it('queries even tiles with a screenshot (no fallback) — the badge still needs the favicon', () => {
		const screenshotSite = makeSite('https://a.example/', { hasFallback: false, badgeHasImg: false });
		(globalThis as any).Grid = { sites: [screenshotSite] };
		const sendMessage = vi.fn();
		(globalThis as any).chrome = { runtime: { sendMessage } };
		(globalThis as any).browser = (globalThis as any).chrome;
		harness.getFavicons();
		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage.mock.calls[0][0].urls).toEqual(['https://a.example/']);
	});

	it('skips tiles whose badge is already an <img> (cached from a prior query)', () => {
		const done = makeSite('https://a.example/', { hasFallback: false, badgeHasImg: true });
		const todo = makeSite('https://b.example/', { hasFallback: false, badgeHasImg: false });
		(globalThis as any).Grid = { sites: [done, todo] };
		const sendMessage = vi.fn();
		(globalThis as any).chrome = { runtime: { sendMessage } };
		(globalThis as any).browser = (globalThis as any).chrome;
		harness.getFavicons();
		expect(sendMessage.mock.calls[0][0].urls).toEqual(['https://b.example/']);
	});
});

// ===========================================================================
// 2. OKLCH brand colour
// ===========================================================================

describe('siteBrandColor — emits oklch() not hsl()', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading top-level fns
		const source = fs.readFileSync(SITE_PATH, 'utf8');
		const siteHue = extractTopLevelFunction(source, 'siteHue');
		const siteBrandColor = extractTopLevelFunction(source, 'siteBrandColor');
		const code = `${siteHue}\n${siteBrandColor}\nthis.siteHue = siteHue; this.siteBrandColor = siteBrandColor;`;
		const sandbox: any = { URL: globalThis.URL };
		vm.createContext(sandbox);
		vm.runInContext(code, sandbox);
		harness = sandbox;
	});

	it('strips www. so www.heise.de and heise.de share a colour', () => {
		const a = harness.siteBrandColor({ url: 'https://www.heise.de/' });
		const b = harness.siteBrandColor({ url: 'https://heise.de/news' });
		expect(a).toBe(b);
	});

	it('emits oklch(65% 0.13 <hue>) shape', () => {
		const color = harness.siteBrandColor({ url: 'https://heise.de/' });
		expect(color).toMatch(/^oklch\(65% 0\.13 \d+(\.\d+)?\)$/);
	});

	it('keeps a hex user override (#abc) over the hash', () => {
		const color = harness.siteBrandColor({ url: 'https://heise.de/', backgroundColor: '#ff0044' });
		expect(color).toBe('#ff0044');
	});

	it('falls back to neutral #666 when the URL is unparseable', () => {
		const color = harness.siteBrandColor({ url: 'not-a-url' });
		expect(color).toBe('#666');
	});
});

// ===========================================================================
// 3. State-aware pin / unpin icon
// ===========================================================================

describe('icons.js — unpin icon variant exists', () => {
	let iconsSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check
		iconsSource = fs.readFileSync(ICONS_PATH, 'utf8');
	});

	it('defines an `unpin` icon (Lucide-style pin-off with a diagonal slash)', () => {
		// The current pin() is the outline thumbtack; unpin() adds a slash
		// so the pinned-state button reads as "click to unpin".
		expect(iconsSource).toMatch(/unpin\s*\(\s*\)\s*\{/);
	});

	it('still defines the original pin() icon (kept for unpinned state)', () => {
		// Two tabs of indent inside the ICONS object literal (one for `var
		// NttIcons = (() => {`, one for `const ICONS = {`).
		expect(iconsSource).toMatch(/\n\t\tpin\s*\(\s*\)\s*\{/);
	});
});

describe('_renderActions — picks pin vs unpin based on isPinned', () => {
	let renderActions: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: source-level branch
		const source = fs.readFileSync(SITE_PATH, 'utf8');
		renderActions = extractMethod(source, '_renderActions');
	});

	it('uses `isPinned ? \'unpin\' : \'pin\'` for the pin action icon', () => {
		// Pattern is just `icon: this.isPinned ? 'unpin' : 'pin'` (or
		// equivalent ternary) — guard that the branch exists.
		expect(renderActions).toMatch(/this\.isPinned\s*\?\s*['"]unpin['"]\s*:\s*['"]pin['"]/);
	});
});

describe('updateAttributes — swaps the pin icon when isPinned flips', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading method for behavioral test
		const source = fs.readFileSync(SITE_PATH, 'utf8');
		const updateAttrs = extractMethod(source, 'updateAttributes');
		const code = `var _attrHarness = { ${updateAttrs} };`;
		vm.runInThisContext(code, { filename: 'update-attrs-harness.js' });
		harness = (globalThis as any)._attrHarness;
	});

	function buildButton(initialIconKey = 'pin') {
		document.body.innerHTML = '';
		const node = document.createElement('div');
		const actions = document.createElement('div'); actions.className = 'ntt-actions';
		const btn = document.createElement('button');
		btn.className = 'ntt-action-btn';
		btn.setAttribute('data-action', 'pin');
		btn.setAttribute('data-icon', initialIconKey);
		actions.appendChild(btn);
		node.appendChild(actions);
		document.body.appendChild(node);
		return { node, _node: node, _querySelector(sel: string) { return node.querySelector(sel); } };
	}

	beforeEach(() => {
		(globalThis as any).newTabTools = { getString: () => 'tip' };
		(globalThis as any).NttIcons = { create: (name: string) => {
			const fake = document.createElement('span');
			fake.dataset.iconKey = name;
			return fake;
		} };
	});

	it('rewrites the pin button to the unpin icon when toggling to pinned', () => {
		const site: any = buildButton('pin');
		harness.updateAttributes.call(site, true);
		const btn = site.node.querySelector('.ntt-action-btn[data-action="pin"]')!;
		expect(btn.getAttribute('data-icon')).toBe('unpin');
		const child = btn.querySelector('[data-icon-key]') as HTMLElement;
		expect(child?.dataset.iconKey).toBe('unpin');
	});

	it('rewrites the pin button back to the pin icon when toggling to unpinned', () => {
		const site: any = buildButton('unpin');
		harness.updateAttributes.call(site, false);
		const btn = site.node.querySelector('.ntt-action-btn[data-action="pin"]')!;
		expect(btn.getAttribute('data-icon')).toBe('pin');
	});
});
