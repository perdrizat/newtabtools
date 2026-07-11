/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * common.js's page-side leaf utilities (P2-P5 review finding 1, revised
 * remediation, executed 2026-07-10). `getString`/`isValidURL` were extracted
 * here from newTab.js's `newTabTools` object — a data query + two leaf
 * utilities that happened to live on the page-controller monolith only
 * because the page was historically one global scope — so awesomebar.js (and
 * any future page consumer) can `import` them directly instead of reaching
 * into a monolith or a `globalThis` bridge. `newTabTools.getString`/
 * `isValidURL` are now one-line delegates to these; this suite pins the
 * extracted implementations' own behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { getString, isValidURL, topSitesOptions } from '../../webextension/common.js';

describe('getString', () => {
	it('delegates to chrome.i18n.getMessage, collecting substitutions into an array', () => {
		const calls: Array<[string, unknown]> = [];
		const original = globalThis.chrome.i18n.getMessage;
		(globalThis as any).chrome.i18n.getMessage = (name: string, subs: unknown) => {
			calls.push([name, subs]);
			return `translated:${name}`;
		};
		try {
			expect(getString('some_key', 'a', 'b')).toBe('translated:some_key');
			expect(calls).toEqual([['some_key', ['a', 'b']]]);
		} finally {
			(globalThis as any).chrome.i18n.getMessage = original;
		}
	});

	it('passes an empty substitutions array when called with none', () => {
		const calls: Array<[string, unknown]> = [];
		const original = globalThis.chrome.i18n.getMessage;
		(globalThis as any).chrome.i18n.getMessage = (name: string, subs: unknown) => {
			calls.push([name, subs]);
			return name;
		};
		try {
			getString('bare_key');
			expect(calls).toEqual([['bare_key', []]]);
		} finally {
			(globalThis as any).chrome.i18n.getMessage = original;
		}
	});
});

describe('topSitesOptions (chrome-prep C5b: shared getBrowserInfo short-circuit, audit #6)', () => {
	it('returns the modern options object when runtime.getBrowserInfo is present and reports a post-63.0a1 version (Firefox path, unchanged)', async () => {
		const api = {
			runtime: { getBrowserInfo: vi.fn().mockResolvedValue({ version: '128.0' }) },
		};
		await expect(topSitesOptions(api)).resolves.toEqual({ limit: 100, onePerDomain: false, includeBlocked: true });
	});

	it('returns the legacy providers option when getBrowserInfo reports a pre-63.0a1 version (Firefox path, unchanged)', async () => {
		const api = {
			runtime: { getBrowserInfo: vi.fn().mockResolvedValue({ version: '60.0' }) },
		};
		await expect(topSitesOptions(api)).resolves.toEqual({ providers: ['places'] });
	});

	it('returns the modern options object without calling getBrowserInfo when runtime.getBrowserInfo is absent (Chrome-dormant path)', async () => {
		const api = { runtime: {} };
		await expect(topSitesOptions(api)).resolves.toEqual({ limit: 100, onePerDomain: false, includeBlocked: true });
	});
});

describe('isValidURL', () => {
	it('accepts http/https/ftp URLs', () => {
		expect(isValidURL('http://example.com/')).toBe(true);
		expect(isValidURL('https://example.com/')).toBe(true);
		expect(isValidURL('ftp://example.com/')).toBe(true);
	});

	it('rejects javascript:/data: URLs and unparseable garbage', () => {
		expect(isValidURL('javascript:alert(1)')).toBe(false);
		expect(isValidURL('data:text/html,hi')).toBe(false);
		expect(isValidURL('not a url')).toBe(false);
	});
});
