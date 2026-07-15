/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Audit 2026-06-10 §5.2 — edge-case coverage for `stats.js` (`TileStats`).
 *
 * `formatCount`/`formatAge` are pure; `compute` orchestrates them over
 * `browser.history`/`permissions`. The gaps the audit named — 0 visits, very
 * large counts, clock-skew (negative age / future visitTime) — plus the
 * stat-type branches are exercised here.
 *
 * page-modules P2 (PAGE_MODULES.md): stats.js is a real ES module now
 * (`export const TileStats`), so it's natively imported once (module-level
 * singleton) rather than vm-loaded fresh per test via `loadModule`. That
 * trades the old per-call isolation for two explicit resets each test:
 * `TileStats._hasHistoryPermission` (the one piece of instance state) is
 * cleared in `beforeEach`, and `browser` is replaced wholesale via
 * `mockBrowser()` before each `compute()` call — the same substitution
 * `loadModule`'s sandbox used to provide, just against the real `globalThis`
 * instead of a vm context. `Date.now()` is spied fixed at `NOW` for the
 * clock-dependent branches, restored after each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TileStats } from '../../webextension/stats.js';

// Fixed "now" for compute() — clock-dependent branches are deterministic.
const NOW = Date.UTC(2026, 5, 22, 12, 0, 0);
const HOUR = 3_600_000;

function mockBrowser(hasPerm: boolean, visits: Array<{ visitTime: number }> = []) {
	const browser = {
		permissions: { contains: vi.fn().mockResolvedValue(hasPerm) },
		history: { getVisits: vi.fn().mockResolvedValue(visits) },
		storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
	};
	(globalThis as any).browser = browser;
	return browser;
}

beforeEach(() => {
	TileStats._hasHistoryPermission = null;
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('TileStats.formatCount', () => {
	it('renders sub-1000 verbatim', () => {
		expect(TileStats.formatCount(0)).toBe('0');
		expect(TileStats.formatCount(7)).toBe('7');
		expect(TileStats.formatCount(999)).toBe('999');
	});
	it('renders thousands with a k suffix, trimming a whole .0', () => {
		expect(TileStats.formatCount(1000)).toBe('1k');
		expect(TileStats.formatCount(1500)).toBe('1.5k');
		expect(TileStats.formatCount(1234)).toBe('1.2k'); // toFixed(1) rounds
	});
	it('does not overflow on very large counts', () => {
		expect(TileStats.formatCount(1_000_000)).toBe('1000k');
	});
});

describe('TileStats.formatAge', () => {
	it('sub-minute → "now"', () => {
		expect(TileStats.formatAge(0)).toBe('now');
		expect(TileStats.formatAge(59_999)).toBe('now');
	});
	it('minutes / hours / days boundaries', () => {
		expect(TileStats.formatAge(60_000)).toBe('1m');
		expect(TileStats.formatAge(59 * 60_000)).toBe('59m');
		expect(TileStats.formatAge(HOUR)).toBe('1h');
		expect(TileStats.formatAge(23 * HOUR)).toBe('23h');
		expect(TileStats.formatAge(24 * HOUR)).toBe('1d');
	});
	it('clock-skew: negative age clamps to "now" (does not produce "-1m")', () => {
		expect(TileStats.formatAge(-5_000)).toBe('now');
		expect(TileStats.formatAge(-HOUR)).toBe('now');
	});
});

describe('TileStats.compute', () => {
	it('statType "none" → null (no history hit)', async () => {
		mockBrowser(true);
		expect(await TileStats.compute('https://x.test/', 'none')).toBeNull();
	});

	it('no history permission → null', async () => {
		mockBrowser(false, [{ visitTime: NOW }]);
		expect(await TileStats.compute('https://x.test/', 'visits')).toBeNull();
	});

	it('zero visits → null', async () => {
		mockBrowser(true, []);
		expect(await TileStats.compute('https://x.test/', 'visits')).toBeNull();
	});

	it('"visits" → count via formatCount', async () => {
		const visits = Array.from({ length: 5 }, () => ({ visitTime: NOW - HOUR }));
		mockBrowser(true, visits);
		expect(await TileStats.compute('https://x.test/', 'visits')).toEqual({ type: 'visits', value: '5' });
	});

	it('"last" with a future visitTime (clock skew) → "now", not a negative age', async () => {
		mockBrowser(true, [{ visitTime: NOW + 10_000 }]);
		expect(await TileStats.compute('https://x.test/', 'last')).toEqual({ type: 'last', value: 'now' });
	});

	it('a rejected history query → null (no throw)', async () => {
		const browser = mockBrowser(true);
		browser.history.getVisits = vi.fn().mockRejectedValue(new Error('history unavailable'));
		await expect(TileStats.compute('https://x.test/', 'visits')).resolves.toBeNull();
	});

	it('removed statType values ("rank", "fresh") fall through to null (issue #13)', async () => {
		mockBrowser(true, [{ visitTime: NOW - HOUR }]);
		expect(await TileStats.compute('https://x.test/', 'rank')).toBeNull();
		expect(await TileStats.compute('https://x.test/', 'fresh')).toBeNull();
	});
});
