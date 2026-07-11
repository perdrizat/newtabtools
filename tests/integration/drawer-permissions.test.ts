/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: history-permission auto-request and stat chip rank wiring.
 *
 * Covers two Phase 3-1 review regressions:
 *   1. `_ensureHistoryPermission` must call `chrome.permissions.request`
 *      synchronously from the click handler — Firefox loses the user-gesture
 *      context across async callbacks. The earlier `permissions.contains` →
 *      callback → `permissions.request` chain silently failed.
 *   2. `_renderStatChip` must pass the tile's index as `rank` so the rank
 *      stat type renders without requiring the optional `history`
 *      permission.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const SITE_PATH = path.resolve(__dirname, '../../webextension/site.js');

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

describe('History permission auto-request — gesture-safe path', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const ensure = extractMethod(source, '_ensureHistoryPermission');

		// chrome-prep C5a (CHROME_PREP.md): `_ensureHistoryPermission` now reads
		// the module-level `api` namespace leaf instead of a bare `chrome.*`
		// reference — declared here as a live-resolving stand-in (mirrors
		// webextension/api.js's own Proxy) so each test's `globalThis.chrome`
		// override below still takes effect at call time.
		const code = `var api = new Proxy({}, { get(_t, p) { return Reflect.get(globalThis.browser ?? globalThis.chrome, p); } }); var _permHarness = { ${ensure} };`;
		vm.runInThisContext(code, { filename: 'perm-harness.js' });
		harness = (globalThis as any)._permHarness;
	});

	beforeEach(() => {
		(globalThis as any).TileStats = { _hasHistoryPermission: false };
		(globalThis as any).Grid = { sites: [] };
	});

	it('regression: calls chrome.permissions.request directly (not gated on .contains)', () => {
		// Firefox treats `permissions.request` as a privileged call that
		// MUST originate from a synchronous user-gesture handler. Routing
		// through `permissions.contains` first puts the request inside an
		// async callback and Firefox rejects it without showing a dialog.
		const requestSpy = vi.fn((_args, cb) => cb(false));
		const containsSpy = vi.fn();
		// chrome-prep C5a (CHROME_PREP.md): `api` resolves `globalThis.browser ??
		// chrome` — `browser` must mirror this test's `chrome` override (not the
		// untouched baseline jest-webextension-mock object) or `api.permissions`
		// would resolve to the wrong mock.
		(globalThis as any).chrome = {
			permissions: { request: requestSpy, contains: containsSpy },
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		harness._ensureHistoryPermission();
		expect(requestSpy).toHaveBeenCalledTimes(1);
		expect(containsSpy).not.toHaveBeenCalled();
	});

	it('on accepted=true, clears the TileStats cache and re-renders chips', () => {
		const renderSpy = vi.fn();
		(globalThis as any).Grid = { sites: [
			{ _renderStatChip: renderSpy },
			null,
			{ _renderStatChip: renderSpy },
		] };
		(globalThis as any).chrome = {
			permissions: { request: (_args: any, cb: any) => cb(true) },
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		harness._ensureHistoryPermission();
		expect((globalThis as any).TileStats._hasHistoryPermission).toBe(true);
		expect(renderSpy).toHaveBeenCalledTimes(2);
	});

	it('on accepted=false, does not touch the cache or re-render', () => {
		const renderSpy = vi.fn();
		(globalThis as any).Grid = { sites: [{ _renderStatChip: renderSpy }] };
		(globalThis as any).chrome = {
			permissions: { request: (_args: any, cb: any) => cb(false) },
		};
		(globalThis as any).browser = (globalThis as any).chrome;
		harness._ensureHistoryPermission();
		expect((globalThis as any).TileStats._hasHistoryPermission).toBe(false);
		expect(renderSpy).not.toHaveBeenCalled();
	});

	it('no-op when chrome.permissions is unavailable (does not throw)', () => {
		(globalThis as any).chrome = {};
		(globalThis as any).browser = (globalThis as any).chrome;
		expect(() => harness._ensureHistoryPermission()).not.toThrow();
	});
});

describe('Stat chip rank wiring — _renderStatChip', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(SITE_PATH, 'utf8');
		const renderStatChip = extractMethod(source, '_renderStatChip');
		const code = `var _renderHarness = { ${renderStatChip} };`;
		vm.runInThisContext(code, { filename: 'render-harness.js' });
		harness = (globalThis as any)._renderHarness;
	});

	function makeSite(opts: { url: string; cellIndex: number | null }): any {
		const chip = document.createElement('span');
		chip.className = 'ntt-stat-chip';
		return {
			url: opts.url,
			cell: opts.cellIndex == null ? null : { index: opts.cellIndex },
			node: document.createElement('div'),
			_querySelector(sel: string): HTMLElement | null {
				return sel === '.ntt-stat-chip' ? chip : null;
			},
		};
	}

	it('regression: passes the tile\'s cell index + 1 as `rank` to TileStats.compute', () => {
		// Rank renders as the tile's 1-indexed position. Without passing
		// `rank` to compute(), `statType === "rank"` falls through to the
		// history-permission branch and returns null — so rank chips never
		// appear even though the data is local.
		const computeSpy = vi.fn().mockResolvedValue(null);
		(globalThis as any).TileStats = { compute: computeSpy };
		(globalThis as any).Prefs = { statType: 'rank' };

		harness._renderStatChip.call(makeSite({ url: 'https://example.com/', cellIndex: 4 }));
		expect(computeSpy).toHaveBeenCalledWith('https://example.com/', 'rank', 5);
	});

	it('passes null as rank when the site has no cell (e.g. detached during drag)', () => {
		const computeSpy = vi.fn().mockResolvedValue(null);
		(globalThis as any).TileStats = { compute: computeSpy };
		(globalThis as any).Prefs = { statType: 'visits' };

		harness._renderStatChip.call(makeSite({ url: 'https://example.com/', cellIndex: null }));
		expect(computeSpy).toHaveBeenCalledWith('https://example.com/', 'visits', null);
	});
});
