/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: history-permission auto-request.
 *
 * Covers a Phase 3-1 review regression: `_ensureHistoryPermission` must call
 * `chrome.permissions.request` synchronously from the click handler —
 * Firefox loses the user-gesture context across async callbacks. The
 * earlier `permissions.contains` → callback → `permissions.request` chain
 * silently failed.
 *
 * (The stat-chip `rank`-wiring regression this file used to also cover was
 * removed with the `rank`/`fresh` stat types themselves — issue #13.)
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

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
