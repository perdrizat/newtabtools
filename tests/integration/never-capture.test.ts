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
 *
 * PAGE_MODULES.md P3: prefs.js has a real `export` now — `loadModule`'s
 * `vm.createContext` harness (a script-mode loader) can no longer parse it.
 * Natively imports the real `NeverCapture`/`Prefs` module singletons instead;
 * each describe block installs its own `chrome`/`browser` mocks on
 * `globalThis` per test (NeverCapture's methods read them as bare
 * identifiers at call time, same as production) and resets `NeverCapture._list`
 * in `beforeEach` for isolation (crib: P2's stats.js singleton-state-reset
 * precedent).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeverCapture, Prefs } from '../../webextension/prefs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function installChrome() {
	(globalThis as any).chrome = {
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
	};
}

// prefs.js's NeverCapture methods call the promise-based
// `browser.storage.local.*` (Slice C of the MV3 migration) — install a
// dedicated `browser` mock (kept distinct from `chrome`, matching this
// file's original vm-sandbox convention) whenever a test needs to
// observe/persist a write.
function installBrowser(overrides: { set?: ReturnType<typeof vi.fn> } = {}) {
	(globalThis as any).browser = {
		storage: {
			local: {
				get: vi.fn().mockResolvedValue({}),
				set: overrides.set ?? vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
			},
		},
	};
}

// ---------------------------------------------------------------------------
// NeverCapture.matches
// ---------------------------------------------------------------------------

describe('NeverCapture.matches', () => {
	beforeEach(() => {
		installChrome();
		NeverCapture._list = [];
	});

	it('empty list → false for any URL', () => {
		expect(NeverCapture.matches('https://example.com/x')).toBe(false);
	});

	it('exact entry matches only the apex host, not subdomains', () => {
		NeverCapture._list = ['example.com'];
		expect(NeverCapture.matches('https://example.com/x')).toBe(true);
		expect(NeverCapture.matches('https://example.com/')).toBe(true);
		expect(NeverCapture.matches('https://www.example.com/')).toBe(false);
		expect(NeverCapture.matches('https://sub.example.com/')).toBe(false);
	});

	it('dot-prefixed entry matches apex AND subdomains', () => {
		NeverCapture._list = ['.example.com'];
		expect(NeverCapture.matches('https://example.com/')).toBe(true);
		expect(NeverCapture.matches('https://sub.example.com/')).toBe(true);
		expect(NeverCapture.matches('https://deep.sub.example.com/')).toBe(true);
		expect(NeverCapture.matches('https://notexample.com/')).toBe(false);
	});

	it('unparseable URL → false', () => {
		NeverCapture._list = ['example.com'];
		expect(NeverCapture.matches('not a url')).toBe(false);
		expect(NeverCapture.matches('')).toBe(false);
	});

	it('port-less entry matches a URL served on a nonstandard port', () => {
		// matches() keys on URL.hostname (port-less), so a listed bare host also
		// covers the same host on any port — no port-based exfil gap.
		NeverCapture._list = ['example.com'];
		expect(NeverCapture.matches('https://example.com:8443/')).toBe(true);
		NeverCapture._list = ['.example.com'];
		expect(NeverCapture.matches('https://sub.example.com:3000/')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.matchingEntry
// ---------------------------------------------------------------------------

describe('NeverCapture.matchingEntry', () => {
	beforeEach(() => {
		installChrome();
		NeverCapture._list = [];
	});

	it('returns the matching entry for an exact host', () => {
		NeverCapture._list = ['example.com'];
		expect(NeverCapture.matchingEntry('example.com')).toBe('example.com');
	});

	it('returns the dot entry when host matches via leading dot', () => {
		NeverCapture._list = ['.example.com'];
		expect(NeverCapture.matchingEntry('example.com')).toBe('.example.com');
		expect(NeverCapture.matchingEntry('sub.example.com')).toBe('.example.com');
	});

	it('returns undefined when no entry matches', () => {
		NeverCapture._list = ['other.com'];
		expect(NeverCapture.matchingEntry('example.com')).toBeUndefined();
	});

	it('returns undefined for empty list', () => {
		expect(NeverCapture.matchingEntry('example.com')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.add
// ---------------------------------------------------------------------------

describe('NeverCapture.add', () => {
	let mockSet: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		installChrome();
		mockSet = vi.fn().mockResolvedValue(undefined);
		installBrowser({ set: mockSet });
		NeverCapture._list = [];
	});

	it('normalizes a full URL input to host only (lowercased)', () => {
		NeverCapture.add('https://Sub.Example.COM/path');
		expect(NeverCapture._list).toContain('sub.example.com');
	});

	it('maps *.x.com wildcard to .x.com form', () => {
		NeverCapture.add('*.x.com');
		expect(NeverCapture._list).toContain('.x.com');
	});

	it('dedupes: second add of same host does not duplicate', () => {
		NeverCapture.add('example.com');
		NeverCapture.add('example.com');
		expect(NeverCapture._list.filter((h: string) => h === 'example.com').length).toBe(1);
	});

	it('empty / whitespace-only input is a no-op', () => {
		NeverCapture.add('');
		NeverCapture.add('   ');
		expect(NeverCapture._list.length).toBe(0);
	});

	it('persists via browser.storage.local.set with key neverCaptureHosts', () => {
		NeverCapture.add('example.com');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ neverCaptureHosts: expect.arrayContaining(['example.com']) }),
		);
	});

	it('strips a :port so the stored entry is a bare hostname', () => {
		NeverCapture.add('localhost:3000');
		expect(NeverCapture._list).toContain('localhost');
		expect(NeverCapture._list).not.toContain('localhost:3000');
	});

	it('always returns a thenable — including for a no-op (duplicate / empty) add', () => {
		// Regression: the Advanced-tab handler chains .then() on add(); a bare
		// `undefined` return on a duplicate/empty add threw a TypeError.
		expect(typeof NeverCapture.add('example.com').then).toBe('function');
		expect(typeof NeverCapture.add('example.com').then).toBe('function'); // duplicate
		expect(typeof NeverCapture.add('').then).toBe('function'); // empty
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.remove
// ---------------------------------------------------------------------------

describe('NeverCapture.remove', () => {
	let mockSet: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		installChrome();
		mockSet = vi.fn().mockResolvedValue(undefined);
		installBrowser({ set: mockSet });
		NeverCapture._list = [];
	});

	it('removes an exact entry by host', () => {
		NeverCapture._list = ['a.com', 'b.com'];
		NeverCapture.remove('a.com');
		expect(NeverCapture._list).not.toContain('a.com');
		expect(NeverCapture._list).toContain('b.com');
	});

	it('removing by host removes the matching entry (e.g. host a.example.com removes .example.com)', () => {
		NeverCapture._list = ['.example.com'];
		NeverCapture.remove('a.example.com');
		expect(NeverCapture._list).not.toContain('.example.com');
	});

	it('persists after removal via browser.storage.local.set', () => {
		NeverCapture._list = ['remove.me'];
		NeverCapture.remove('remove.me');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ neverCaptureHosts: expect.not.arrayContaining(['remove.me']) }),
		);
	});

	it('no-op when entry not in list', () => {
		NeverCapture._list = ['other.com'];
		NeverCapture.remove('missing.com');
		expect(NeverCapture._list).toEqual(['other.com']);
	});
});

// ---------------------------------------------------------------------------
// NeverCapture.getList
// ---------------------------------------------------------------------------

describe('NeverCapture.getList', () => {
	beforeEach(() => {
		installChrome();
		NeverCapture._list = ['a.com', '.b.org'];
	});

	it('returns a copy of the internal list', () => {
		const copy = NeverCapture.getList();
		expect(copy).toEqual(['a.com', '.b.org']);
	});

	it('mutating the copy does not affect internal state', () => {
		const copy = NeverCapture.getList();
		copy.push('injected.com');
		expect(NeverCapture._list).not.toContain('injected.com');
	});
});

// ---------------------------------------------------------------------------
// Prefs.parsePrefs — neverCaptureHosts validation
// ---------------------------------------------------------------------------

describe('Prefs.parsePrefs — neverCaptureHosts', () => {
	beforeEach(() => {
		installChrome();
		NeverCapture._list = [];
	});

	it('populates valid string hosts, ignores non-string and empty entries', () => {
		Prefs.parsePrefs({ neverCaptureHosts: ['a.com', 42, '', '.b.org', null] });
		const list = NeverCapture._list;
		expect(list).toContain('a.com');
		expect(list).toContain('.b.org');
		expect(list).not.toContain(42);
		expect(list).not.toContain('');
		expect(list).not.toContain(null);
	});

	it('non-array value leaves the list unchanged', () => {
		NeverCapture._list = ['existing.com'];
		Prefs.parsePrefs({ neverCaptureHosts: 'not-an-array' });
		expect(NeverCapture._list).toEqual(['existing.com']);
	});

	it('missing key leaves the list unchanged', () => {
		NeverCapture._list = ['existing.com'];
		Prefs.parsePrefs({});
		expect(NeverCapture._list).toEqual(['existing.com']);
	});

	it('key present with null/undefined value clears the list (storage reset / removal)', () => {
		// Regression: a storage removal (change.newValue === undefined) must drop
		// the stale in-memory list so it stops suppressing captures.
		NeverCapture._list = ['existing.com'];
		Prefs.parsePrefs({ neverCaptureHosts: undefined });
		expect(NeverCapture._list).toEqual([]);
	});
});
