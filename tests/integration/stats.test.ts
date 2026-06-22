/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Audit 2026-06-10 §5.2 — edge-case coverage for `stats.js` (`TileStats`).
 *
 * `formatCount`/`formatAge` are pure; `compute` orchestrates them over
 * `browser.history`/`permissions`. The gaps the audit named — 0 visits, very
 * large counts, clock-skew (negative age / future visitTime) — plus the
 * stat-type branches are exercised here. Loaded via `loadModule` (vm) with a
 * fixed `Date.now()` so clock-dependent branches are deterministic.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadModule } from './_helpers';

// Fixed "now" for compute() — clock-dependent branches are deterministic.
const NOW = Date.UTC(2026, 5, 22, 12, 0, 0);
const HOUR = 3_600_000;

function loadStats(sandbox: Record<string, unknown> = {}) {
	const ctx = loadModule('../../webextension/stats.js', { Date: { now: () => NOW }, ...sandbox });
	return (ctx as Record<string, any>).TileStats;
}

function browserWith(hasPerm: boolean, visits: Array<{ visitTime: number }> = []) {
	return {
		permissions: { contains: vi.fn().mockResolvedValue(hasPerm) },
		history: { getVisits: vi.fn().mockResolvedValue(visits) },
		storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
	};
}

describe('TileStats.formatCount', () => {
	const S = loadStats();
	it('renders sub-1000 verbatim', () => {
		expect(S.formatCount(0)).toBe('0');
		expect(S.formatCount(7)).toBe('7');
		expect(S.formatCount(999)).toBe('999');
	});
	it('renders thousands with a k suffix, trimming a whole .0', () => {
		expect(S.formatCount(1000)).toBe('1k');
		expect(S.formatCount(1500)).toBe('1.5k');
		expect(S.formatCount(1234)).toBe('1.2k'); // toFixed(1) rounds
	});
	it('does not overflow on very large counts', () => {
		expect(S.formatCount(1_000_000)).toBe('1000k');
	});
});

describe('TileStats.formatAge', () => {
	const S = loadStats();
	it('sub-minute → "now"', () => {
		expect(S.formatAge(0)).toBe('now');
		expect(S.formatAge(59_999)).toBe('now');
	});
	it('minutes / hours / days boundaries', () => {
		expect(S.formatAge(60_000)).toBe('1m');
		expect(S.formatAge(59 * 60_000)).toBe('59m');
		expect(S.formatAge(HOUR)).toBe('1h');
		expect(S.formatAge(23 * HOUR)).toBe('23h');
		expect(S.formatAge(24 * HOUR)).toBe('1d');
	});
	it('clock-skew: negative age clamps to "now" (does not produce "-1m")', () => {
		expect(S.formatAge(-5_000)).toBe('now');
		expect(S.formatAge(-HOUR)).toBe('now');
	});
});

describe('TileStats.compute', () => {
	it('statType "none" → null (no history hit)', async () => {
		const S = loadStats({ browser: browserWith(true) });
		expect(await S.compute('https://x.test/', 'none')).toBeNull();
	});

	it('"rank" returns the 1-based rank without touching history', async () => {
		const browser = browserWith(true);
		const S = loadStats({ browser });
		expect(await S.compute('https://x.test/', 'rank', 3)).toEqual({ type: 'rank', value: '3' });
		expect(browser.history.getVisits).not.toHaveBeenCalled();
	});

	it('no history permission → null', async () => {
		const S = loadStats({ browser: browserWith(false, [{ visitTime: NOW }]) });
		expect(await S.compute('https://x.test/', 'visits')).toBeNull();
	});

	it('zero visits → null', async () => {
		const S = loadStats({ browser: browserWith(true, []) });
		expect(await S.compute('https://x.test/', 'visits')).toBeNull();
	});

	it('"visits" → count via formatCount', async () => {
		const visits = Array.from({ length: 5 }, () => ({ visitTime: NOW - HOUR }));
		const S = loadStats({ browser: browserWith(true, visits) });
		expect(await S.compute('https://x.test/', 'visits')).toEqual({ type: 'visits', value: '5' });
	});

	it('"last" with a future visitTime (clock skew) → "now", not a negative age', async () => {
		const S = loadStats({ browser: browserWith(true, [{ visitTime: NOW + 10_000 }]) });
		expect(await S.compute('https://x.test/', 'last')).toEqual({ type: 'last', value: 'now' });
	});

	it('"fresh" within 24h → {type:fresh}; older → null', async () => {
		const fresh = loadStats({ browser: browserWith(true, [{ visitTime: NOW - HOUR }]) });
		expect(await fresh.compute('https://x.test/', 'fresh')).toEqual({ type: 'fresh', value: '' });
		const stale = loadStats({ browser: browserWith(true, [{ visitTime: NOW - 48 * HOUR }]) });
		expect(await stale.compute('https://x.test/', 'fresh')).toBeNull();
	});

	it('a rejected history query → null (no throw)', async () => {
		const browser = browserWith(true);
		browser.history.getVisits = vi.fn().mockRejectedValue(new Error('history unavailable'));
		const S = loadStats({ browser });
		await expect(S.compute('https://x.test/', 'visits')).resolves.toBeNull();
	});
});
