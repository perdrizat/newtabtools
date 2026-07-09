/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration tests for the NeverCapture model in prefs.js.
 *
 * NeverCapture holds a list of host patterns that opt-out of auto-thumbnail
 * capture. Entry semantics match Tiles._hostFilteredOut:
 *   'example.com'  — exact host only
 *   '.example.com' — apex AND any subdomain
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadModule } from './_helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPrefs(sandbox: Record<string, unknown> = {}) {
	const ctx = loadModule('../../webextension/prefs.js', sandbox);
	return ctx as Record<string, any>;
}

function makeChrome() {
	return {
		runtime: { sendMessage: vi.fn() },
		tabs: { create: vi.fn() },
		i18n: { getMessage: vi.fn(() => '') },
		storage: {
			local: {
				get: vi.fn((cb: Function) => cb({})),
				set: vi.fn(),
				remove: vi.fn(),
				onChanged: { addListener: vi.fn() },
			},
		},
		storage_onChanged_addListener: vi.fn(),
	};
}

// prefs.js now calls the promise-based `browser.storage.local.*` (Slice C of
// the MV3 migration). Under `loadModule`'s `vm.createContext` harness `chrome`
// and `browser` are separate mock objects (unlike the shared-object alias
// used by jest-webextension-mock elsewhere), so NeverCapture's persistence
// path needs its own `browser` sandbox entry.
function makeBrowser() {
	return {
		storage: {
			local: {
				get: vi.fn().mockResolvedValue({}),
				set: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
			},
		},
	};
}

// ---------------------------------------------------------------------------
// NeverCapture.matches
// ---------------------------------------------------------------------------

describe('NeverCapture.matches', () => {
	let NC: any;
	let chrome: ReturnType<typeof makeChrome>;

	beforeEach(() => {
		chrome = makeChrome();
		const ctx = loadPrefs({ chrome });
		NC = ctx.NeverCapture;
		NC._list = [];
	});

	it('empty list → false for any URL', () => {
		expect(NC.matches('https://example.com/x')).toBe(false);
	});

	it('exact entry matches only the apex host, not subdomains', () => {
		NC._list = ['example.com'];
		expect(NC.matches('https://example.com/x')).toBe(true);
		expect(NC.matches('https://example.com/')).toBe(true);
		expect(NC.matches('https://www.example.com/')).toBe(false);
		expect(NC.matches('https://sub.example.com/')).toBe(false);
	});

	it('dot-prefixed entry matches apex AND subdomains', () => {
		NC._list = ['.example.com'];
		expect(NC.matches('https://example.com/')).toBe(true);
		expect(NC.matches('https://sub.example.com/')).toBe(true);
		expect(NC.matches('https://deep.sub.example.com/')).toBe(true);
		expect(NC.matches('https://notexample.com/')).toBe(false);
	});

	it('unparseable URL → false', () => {
		NC._list = ['example.com'];
		expect(NC.matches('not a url')).toBe(false);
		expect(NC.matches('')).toBe(false);
	});

	it('port-less entry matches a URL served on a nonstandard port', () => {
		// matches() keys on URL.hostname (port-less), so a listed bare host also
		// covers the same host on any port — no port-based exfil gap.
		NC._list = ['example.com'];
		expect(NC.matches('https://example.com:8443/')).toBe(true);
		NC._list = ['.example.com'];
		expect(NC.matches('https://sub.example.com:3000/')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.matchingEntry
// ---------------------------------------------------------------------------

describe('NeverCapture.matchingEntry', () => {
	let NC: any;

	beforeEach(() => {
		const chrome = makeChrome();
		const ctx = loadPrefs({ chrome });
		NC = ctx.NeverCapture;
		NC._list = [];
	});

	it('returns the matching entry for an exact host', () => {
		NC._list = ['example.com'];
		expect(NC.matchingEntry('example.com')).toBe('example.com');
	});

	it('returns the dot entry when host matches via leading dot', () => {
		NC._list = ['.example.com'];
		expect(NC.matchingEntry('example.com')).toBe('.example.com');
		expect(NC.matchingEntry('sub.example.com')).toBe('.example.com');
	});

	it('returns undefined when no entry matches', () => {
		NC._list = ['other.com'];
		expect(NC.matchingEntry('example.com')).toBeUndefined();
	});

	it('returns undefined for empty list', () => {
		expect(NC.matchingEntry('example.com')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.add
// ---------------------------------------------------------------------------

describe('NeverCapture.add', () => {
	let NC: any;
	let mockSet: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockSet = vi.fn().mockResolvedValue(undefined);
		const chrome = makeChrome();
		const browser = makeBrowser();
		// Override set so we can spy on calls; cast to bypass the strict Mock subtype.
		(browser.storage.local as any).set = mockSet;
		const ctx = loadPrefs({ chrome, browser });
		NC = ctx.NeverCapture;
		NC._list = [];
	});

	it('normalizes a full URL input to host only (lowercased)', () => {
		NC.add('https://Sub.Example.COM/path');
		expect(NC._list).toContain('sub.example.com');
	});

	it('maps *.x.com wildcard to .x.com form', () => {
		NC.add('*.x.com');
		expect(NC._list).toContain('.x.com');
	});

	it('dedupes: second add of same host does not duplicate', () => {
		NC.add('example.com');
		NC.add('example.com');
		expect(NC._list.filter((h: string) => h === 'example.com').length).toBe(1);
	});

	it('empty / whitespace-only input is a no-op', () => {
		NC.add('');
		NC.add('   ');
		expect(NC._list.length).toBe(0);
	});

	it('persists via browser.storage.local.set with key neverCaptureHosts', () => {
		NC.add('example.com');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ neverCaptureHosts: expect.arrayContaining(['example.com']) }),
		);
	});

	it('strips a :port so the stored entry is a bare hostname', () => {
		NC.add('localhost:3000');
		expect(NC._list).toContain('localhost');
		expect(NC._list).not.toContain('localhost:3000');
	});

	it('always returns a thenable — including for a no-op (duplicate / empty) add', () => {
		// Regression: the Advanced-tab handler chains .then() on add(); a bare
		// `undefined` return on a duplicate/empty add threw a TypeError.
		expect(typeof NC.add('example.com').then).toBe('function');
		expect(typeof NC.add('example.com').then).toBe('function'); // duplicate
		expect(typeof NC.add('').then).toBe('function'); // empty
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.remove
// ---------------------------------------------------------------------------

describe('NeverCapture.remove', () => {
	let NC: any;
	let mockSet: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockSet = vi.fn().mockResolvedValue(undefined);
		const chrome = makeChrome();
		const browser = makeBrowser();
		(browser.storage.local as any).set = mockSet;
		const ctx = loadPrefs({ chrome, browser });
		NC = ctx.NeverCapture;
		NC._list = [];
	});

	it('removes an exact entry by host', () => {
		NC._list = ['a.com', 'b.com'];
		NC.remove('a.com');
		expect(NC._list).not.toContain('a.com');
		expect(NC._list).toContain('b.com');
	});

	it('removing by host removes the matching entry (e.g. host a.example.com removes .example.com)', () => {
		NC._list = ['.example.com'];
		NC.remove('a.example.com');
		expect(NC._list).not.toContain('.example.com');
	});

	it('persists after removal via browser.storage.local.set', () => {
		NC._list = ['remove.me'];
		NC.remove('remove.me');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ neverCaptureHosts: expect.not.arrayContaining(['remove.me']) }),
		);
	});

	it('no-op when entry not in list', () => {
		NC._list = ['other.com'];
		NC.remove('missing.com');
		expect(NC._list).toEqual(['other.com']);
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.getList
// ---------------------------------------------------------------------------

describe('NeverCapture.getList', () => {
	let NC: any;

	beforeEach(() => {
		const ctx = loadPrefs({ chrome: makeChrome() });
		NC = ctx.NeverCapture;
		NC._list = ['a.com', '.b.org'];
	});

	it('returns a copy of the internal list', () => {
		const copy = NC.getList();
		expect(copy).toEqual(['a.com', '.b.org']);
	});

	it('mutating the copy does not affect internal state', () => {
		const copy = NC.getList();
		copy.push('injected.com');
		expect(NC._list).not.toContain('injected.com');
	});
});

// ---------------------------------------------------------------------------
// Prefs.parsePrefs — neverCaptureHosts validation
// ---------------------------------------------------------------------------

describe('Prefs.parsePrefs — neverCaptureHosts', () => {
	let ctx: Record<string, any>;

	beforeEach(() => {
		ctx = loadPrefs({ chrome: makeChrome() });
		ctx.NeverCapture._list = [];
	});

	it('populates valid string hosts, ignores non-string and empty entries', () => {
		ctx.Prefs.parsePrefs({ neverCaptureHosts: ['a.com', 42, '', '.b.org', null] });
		const list = ctx.NeverCapture._list;
		expect(list).toContain('a.com');
		expect(list).toContain('.b.org');
		expect(list).not.toContain(42);
		expect(list).not.toContain('');
		expect(list).not.toContain(null);
	});

	it('non-array value leaves the list unchanged', () => {
		ctx.NeverCapture._list = ['existing.com'];
		ctx.Prefs.parsePrefs({ neverCaptureHosts: 'not-an-array' });
		expect(ctx.NeverCapture._list).toEqual(['existing.com']);
	});

	it('missing key leaves the list unchanged', () => {
		ctx.NeverCapture._list = ['existing.com'];
		ctx.Prefs.parsePrefs({});
		expect(ctx.NeverCapture._list).toEqual(['existing.com']);
	});

	it('key present with null/undefined value clears the list (storage reset / removal)', () => {
		// Regression: a storage removal (change.newValue === undefined) must drop
		// the stale in-memory list so it stops suppressing captures.
		ctx.NeverCapture._list = ['existing.com'];
		ctx.Prefs.parsePrefs({ neverCaptureHosts: undefined });
		expect(ctx.NeverCapture._list).toEqual([]);
	});
});
