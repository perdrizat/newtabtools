/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Audit 2026-06-10 §4.3/§8.7.4 — object-URL hygiene, split (chrome-prep C4d,
 * CHROME_PREP.md) between object-urls.js (`_freshObjectURL`/
 * `_dropObjectURL`), wallpaper.js (`refreshBackgroundImage`), titlebar.js
 * (`refreshRecent`), and newTab.js (`getThumbnails`, unmoved).
 *
 * Blob URLs are only freed on document unload, so every repeated-render site
 * must revoke its prior URL before creating a replacement (site.js's
 * `refreshThumbnail` pattern: stash on the owner, revoke on
 * replace). These tests drive the REAL exported functions (chrome-prep C4d:
 * `_freshObjectURL`/`_dropObjectURL`/`refreshBackgroundImage`/`refreshRecent`
 * are real module exports now, not vm-extracted method bodies — the C4a/b/c
 * "import from the new specifier" precedent) plus `getThumbnails`
 * (vm-extracted: still resident in newTab.js) and assert the revocation
 * contract on the highest-churn sites the audit flagged:
 *
 *   - `refreshBackgroundImage` — wallpaper blob re-rendered on pref changes
 *   - `getThumbnails`          — per-site IDB thumbnails (stash shared with
 *                                site.js's `_thumbnailObjectURL` so a later
 *                                capture's refreshThumbnail revokes ours)
 *   - `refreshRecent`          — favicon blobs, cards rebuilt every refresh
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
// titlebar.js (for `refreshRecent`, below) imports `Grid` from grid.js,
// which in turn imports newTab.js (the pre-existing newTab.js<->grid.js<->
// site.js cycle) — whose own top level runs a boot IIFE that touches real
// newTab.html DOM ids. Mocking grid.js wholesale (recent-tabs.test.ts's
// precedent) severs that edge so importing titlebar.js here doesn't
// transitively evaluate newTab.js at all; `refreshRecent`'s tileURLs check
// reads `Grid.sites`, which the mock's empty array satisfies (no test below
// exercises the tile-URL-skip behavior).
vi.mock('../../webextension/grid.js', () => ({ Grid: { sites: [] } }));
import { _freshObjectURL, _dropObjectURL } from '../../webextension/object-urls.js';
import { refreshBackgroundImage } from '../../webextension/wallpaper.js';
import { refreshRecent } from '../../webextension/titlebar.js';
import { uiRefs } from '../../webextension/ui-refs.js';
// `refreshBackgroundImage`/`refreshRecent` read the REAL `Prefs`/`Background`
// singletons now (prefs.js/tiles-shim.js) — a `(globalThis as any).Prefs =
// {...}` stand-in no longer reaches them (same "second-order fallout" class
// _helpers.ts's `ensureSiteEnv` documents). `Prefs`'s pref-name properties
// are plain, getter-less own-data properties before `Prefs.init()` (not
// called here — booting in jsdom is out of scope), so a direct assignment
// is read back synchronously with no storage round-trip (`ensureSiteEnv`'s
// `Prefs.statType = 'none'` precedent); `Background`'s methods are replaced
// in place with `vi.fn()`, the same pattern C4a/b/c's tests use for
// `Grid.refresh`/`Updater.updateGrid`.
import { Prefs } from '../../webextension/prefs.js';
import { Background } from '../../webextension/tiles-shim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

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

// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
const source = fs.readFileSync(NEWTAB_PATH, 'utf8');

let urlCounter = 0;
let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	urlCounter = 0;
	createSpy = vi.fn(() => `blob:fake-${++urlCounter}`);
	revokeSpy = vi.fn();
	(URL as any).createObjectURL = createSpy;
	(URL as any).revokeObjectURL = revokeSpy;
});

describe('object-URL helper — _freshObjectURL / _dropObjectURL', () => {
	// object-urls.js's `_objectURLs` map is module-private state (chrome-prep
	// C4d) — drop the keys this suite uses BEFORE each test resets the spies
	// above, so leftover state from a prior test doesn't pollute this test's
	// revokeSpy call count.
	beforeEach(() => {
		_dropObjectURL('bg');
		_dropObjectURL('editorThumb');
		revokeSpy.mockClear();
	});

	it('first use creates without revoking; replacement revokes the prior URL', () => {
		const url1 = _freshObjectURL('bg', new Blob(['a']));
		expect(url1).toBe('blob:fake-1');
		expect(revokeSpy).not.toHaveBeenCalled();
		const url2 = _freshObjectURL('bg', new Blob(['b']));
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		expect(url2).toBe('blob:fake-2');
	});

	it('keys are independent owners', () => {
		_freshObjectURL('bg', new Blob(['a']));
		_freshObjectURL('editorThumb', new Blob(['b']));
		expect(revokeSpy).not.toHaveBeenCalled();
	});

	it('_dropObjectURL revokes and forgets; double-drop is a no-op', () => {
		_freshObjectURL('bg', new Blob(['a']));
		_dropObjectURL('bg');
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		revokeSpy.mockClear();
		_dropObjectURL('bg');
		expect(revokeSpy).not.toHaveBeenCalled();
	});
});

describe('refreshBackgroundImage — wallpaper blob revoked on re-render', () => {
	beforeEach(() => {
		// `background` is refreshBackgroundImage's owner key (wallpaper.js) —
		// drop it before resetting spies so a prior test's stashed URL can't
		// leak an extra revoke call into this test.
		_dropObjectURL('background');
		revokeSpy.mockClear();
		uiRefs.backgroundFake = { style: {} } as any;
		uiRefs.removeBackgroundButton = { disabled: false, blur: vi.fn() } as any;
		Prefs.backgroundUrl = '';
		Prefs.backgroundColor = '';
		Prefs.backgroundPosition = '';
		Background.getBackground = vi.fn().mockResolvedValue(new Blob(['img']));
	});

	it('two consecutive IDB-blob renders revoke the first URL', async () => {
		await refreshBackgroundImage();
		expect(document.body.style.backgroundImage).toContain('blob:fake-1');
		expect(revokeSpy).not.toHaveBeenCalled();
		await refreshBackgroundImage();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		expect(document.body.style.backgroundImage).toContain('blob:fake-2');
	});

	it('switching to a CDN wallpaper revokes the stale blob URL', async () => {
		await refreshBackgroundImage();
		Prefs.backgroundUrl = 'https://firefox-settings-attachments.cdn.mozilla.net/x.jpg';
		await refreshBackgroundImage();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
	});

	it('clearing the background (no blob, no prefs) revokes the stale blob URL', async () => {
		await refreshBackgroundImage();
		Background.getBackground = vi.fn().mockResolvedValue(null);
		await refreshBackgroundImage();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
	});
});

describe('getThumbnails — per-site stash, revoked on replace', () => {
	let harness: any;
	let site: any;
	let thumbsMap: Map<string, Blob>;

	beforeAll(() => {
		const getThumbnails = extractMethod(source, 'getThumbnails');
		// chrome-prep C5a (CHROME_PREP.md): `getThumbnails` now reads the
		// module-level `api` namespace leaf instead of a bare `chrome.*`
		// reference — declared here as a live-resolving stand-in (mirrors
		// webextension/api.js's own Proxy) so the `globalThis.chrome` override
		// below still takes effect at call time.
		vm.runInThisContext(
			`var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var _thumbHarness = { ${getThumbnails} };`,
			{ filename: 'thumbs-harness.js' },
		);
		harness = (globalThis as any)._thumbHarness;
	});

	beforeEach(() => {
		site = {
			link: { url: 'https://example.com/' },
			thumbnail: { style: {}, querySelector: vi.fn(() => null) },
		};
		thumbsMap = new Map([['https://example.com/', new Blob(['t'])]]);
		(globalThis as any).Grid = { sites: [site] };
		(globalThis as any).newTabTools = {
			getFavicons: vi.fn(),
			selectedSite: null,
			siteThumbnail: { style: {} },
			saveCurrentThumbButton: { disabled: true },
		};
		(globalThis as any).chrome = {
			runtime: { sendMessage: vi.fn((_msg: unknown, cb: (m: Map<string, Blob>) => void) => cb(thumbsMap)) },
		};
		(globalThis as any).browser = (globalThis as any).chrome;
	});

	it('stashes the created URL on the site (shared with site.js refreshThumbnail)', () => {
		harness.getThumbnails();
		expect(site.thumbnail.style.backgroundImage).toContain('blob:fake-1');
		expect(site._thumbnailObjectURL).toBe('blob:fake-1');
	});

	it('re-rendering the same site revokes the prior URL', () => {
		harness.getThumbnails();
		// Simulate a grid refresh that cleared the tile's background, so the
		// site is re-requested and gets a fresh object URL.
		site.thumbnail.style.backgroundImage = '';
		harness.getThumbnails();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
		expect(site._thumbnailObjectURL).toBe('blob:fake-2');
	});
});

describe('refreshRecent — favicon blob URLs revoked on rebuild', () => {
	let faviconsByHost: Map<string, Blob>;

	function makeMockElement(): any {
		const children: any[] = [];
		return {
			href: '', className: '', title: '', style: {}, dataset: {},
			onclick: null, childNodes: [],
			appendChild: vi.fn((child: any) => { children.push(child); return child; }),
			_children: children,
		};
	}

	// `refreshRecent` (titlebar.js, chrome-prep C4d) calls `_layoutTitlebar`
	// internally — no longer an overridable `this.` method, so this suite
	// gives it real `#ntt-titlebar`/`#ntt-titlebar-recent` elements to
	// measure (clientWidth stubbed via defineProperty — jsdom has no real
	// layout engine) instead of stubbing `_layoutTitlebar` itself.
	let recentMeasureEl: HTMLElement;

	beforeAll(() => {
		const titlebarEl = document.createElement('div');
		titlebarEl.id = 'ntt-titlebar';
		document.body.appendChild(titlebarEl);
		recentMeasureEl = document.createElement('div');
		recentMeasureEl.id = 'ntt-titlebar-recent';
		Object.defineProperty(recentMeasureEl, 'clientWidth', { value: 400, configurable: true });
		document.body.appendChild(recentMeasureEl);
	});

	beforeEach(() => {
		uiRefs.recentList = {
			hidden: false,
			querySelectorAll: vi.fn(() => []),
			removeChild: vi.fn(),
			appendChild: vi.fn((el: any) => el),
		} as any;
		faviconsByHost = new Map([['example.com', new Blob(['f'])]]);
		Prefs.recent = true;
		const items = [
			// No session favIconUrl → falls back to the stored (Blob) favicon.
			{ tab: { url: 'https://example.com/article', title: 'Ex', sessionId: 's1', favIconUrl: null, incognito: false } },
		];
		(globalThis as any).chrome = {
			sessions: { getRecentlyClosed: vi.fn((cb: (i: unknown[]) => void) => cb(items)) },
			runtime: {
				sendMessage: vi.fn((msg: any, cb: (m: Map<string, Blob>) => void) => {
					if (msg && msg.name === 'Thumbnails.getFaviconsByHost') { cb(faviconsByHost); }
				}),
			},
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		// `refreshRecent` builds 'img' elements via one shape and everything else
		// (the 'a'/'span' card structure) via `makeMockElement`'s generic shape —
		// both now go through `document.createElement` (no more createElementNS
		// namespace split), so the mock dispatches on the tag name. Overriding
		// `document.createElement` here doesn't disturb `recentMeasureEl`/
		// `titlebarEl` above — those were built with the real implementation
		// in `beforeAll`, before this override is installed.
		document.createElement = vi.fn((tag: string) =>
			tag === 'img'
				? { classList: { add: vi.fn() }, onerror: null, src: '', remove: vi.fn() }
				: makeMockElement(),
		) as any;
		document.createTextNode = vi.fn((text: string) => ({ textContent: text })) as any;
	});

	// `_recentFaviconURLs` is titlebar.js's own module-private state
	// (chrome-prep C4d) — unlike the old vm-harness (a fresh object literal
	// per test), there's no way to reset it between tests from outside the
	// module. Combined into one test (rather than two, each asserting on a
	// slice of the same before/after sequence) so this suite's own
	// revokeSpy/createSpy history stays self-contained instead of depending
	// on a previous test's leftover render state.
	it('creates a blob URL for a stored favicon, then revokes it on the next rebuild', () => {
		refreshRecent();
		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(revokeSpy).not.toHaveBeenCalled();
		refreshRecent();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
	});
});
