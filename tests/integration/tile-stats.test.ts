/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readNewTabHtml } from './_helpers';
import { TileStats } from '../../webextension/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_PATH = path.resolve(__dirname, '../../webextension/stats.js');
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');

describe('TileStats module — source presence', () => {
	it('stats.js file exists', () => {
		expect(fs.existsSync(STATS_PATH)).toBe(true);
	});

	it('exports TileStats object', () => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: exported symbol
		const source = fs.readFileSync(STATS_PATH, 'utf8');
		expect(source).toContain('TileStats');
	});

	// The former "is imported by page-main.js" test here was a source-string
	// grep (`readFileSync(page-main.js).toContain('./stats.js')`) — the
	// ntt/no-source-grep antipattern re-licensed with a disable comment (code
	// review, 2026-07-10-page-modules-p1-code-review.md finding 1). Deleted in
	// favor of tests/integration/page-main-boot.test.ts, which natively
	// imports the real page-main.js and proves the wiring behaviorally
	// (import completeness + boot order), and page-module-scope.test.ts, whose
	// PAGE_FILES_IN_LOAD_ORDER is now parsed from page-main.js's own source
	// (finding 8) rather than hardcoded.

	it('newTab.html loads page-main.js as its module entry', () => {
		const html = readNewTabHtml();
		expect(html).toMatch(/<script[^>]*type="module"[^>]*src="page-main\.js"/);
	});
});

describe('TileStats — behavioral', () => {
	// page-modules P2 (PAGE_MODULES.md): stats.js is a real ES module now
	// (`export const TileStats`), imported natively above rather than
	// vm-loaded per describe block. `globalThis.browser` stands in for the vm
	// sandbox's `browser`; `_hasHistoryPermission` (the one piece of instance
	// state) is reset every test since TileStats is now a shared singleton.
	let mockGetVisits: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		mockGetVisits = vi.fn();

		(globalThis as any).browser = {
			history: {
				getVisits: mockGetVisits,
			},
			permissions: {
				contains: vi.fn().mockResolvedValue(true),
			},
		};
	});

	beforeEach(() => {
		mockGetVisits.mockReset();
		TileStats._hasHistoryPermission = null;
	});

	it('TileStats.compute exists and is a function', () => {
		expect(typeof TileStats.compute).toBe('function');
	});

	it('returns null for "none" stat type', async () => {
		const result = await TileStats.compute('https://example.com', 'none');
		expect(result).toBeNull();
	});

	it('returns visit count for "visits" stat type', async () => {
		mockGetVisits.mockResolvedValue([
			{ visitTime: Date.now() - 1000 },
			{ visitTime: Date.now() - 2000 },
			{ visitTime: Date.now() - 3000 },
		]);
		const result = await TileStats.compute('https://example.com', 'visits');
		expect(result).toEqual({ type: 'visits', value: '3' });
	});

	it('formats large visit counts with k suffix', async () => {
		const visits = Array.from({ length: 1500 }, (_, i) => ({
			visitTime: Date.now() - i * 1000,
		}));
		mockGetVisits.mockResolvedValue(visits);
		const result = await TileStats.compute('https://example.com', 'visits');
		expect(result).toEqual({ type: 'visits', value: '1.5k' });
	});

	it('returns time since last visit for "last" stat type', async () => {
		const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
		mockGetVisits.mockResolvedValue([
			{ visitTime: twoHoursAgo },
		]);
		const result = await TileStats.compute('https://example.com', 'last');
		expect(result?.type).toBe('last');
		expect(result?.value).toBe('2h');
	});

	it('returns "just now" for very recent visits', async () => {
		mockGetVisits.mockResolvedValue([
			{ visitTime: Date.now() - 30000 },
		]);
		const result = await TileStats.compute('https://example.com', 'last');
		expect(result?.value).toBe('now');
	});

	it('returns days for old visits in "last" mode', async () => {
		const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
		mockGetVisits.mockResolvedValue([
			{ visitTime: threeDaysAgo },
		]);
		const result = await TileStats.compute('https://example.com', 'last');
		expect(result?.value).toBe('3d');
	});

	it('returns trend direction for "trend" stat type', async () => {
		const now = Date.now();
		const recentVisits = Array.from({ length: 10 }, (_, i) => ({
			visitTime: now - i * 60 * 60 * 1000,
		}));
		const olderVisits = Array.from({ length: 3 }, (_, i) => ({
			visitTime: now - (7 + i) * 24 * 60 * 60 * 1000,
		}));
		mockGetVisits.mockResolvedValue([...recentVisits, ...olderVisits]);
		const result = await TileStats.compute('https://example.com', 'trend');
		expect(result?.type).toBe('trend');
		expect(result?.dir).toBe('up');
	});

	it('returns rank for "rank" stat type', async () => {
		mockGetVisits.mockResolvedValue([
			{ visitTime: Date.now() - 1000 },
			{ visitTime: Date.now() - 2000 },
			{ visitTime: Date.now() - 3000 },
		]);
		const result = await TileStats.compute('https://example.com', 'rank', 2);
		expect(result).toEqual({ type: 'rank', value: '2' });
	});

	it('returns fresh dot for "fresh" stat type when recently visited', async () => {
		mockGetVisits.mockResolvedValue([
			{ visitTime: Date.now() - 30 * 60 * 1000 },
		]);
		const result = await TileStats.compute('https://example.com', 'fresh');
		expect(result).toEqual({ type: 'fresh', value: '' });
	});

	it('returns null for "fresh" when not recently visited', async () => {
		mockGetVisits.mockResolvedValue([
			{ visitTime: Date.now() - 25 * 60 * 60 * 1000 },
		]);
		const result = await TileStats.compute('https://example.com', 'fresh');
		expect(result).toBeNull();
	});

	it('returns null when no visits found', async () => {
		mockGetVisits.mockResolvedValue([]);
		const result = await TileStats.compute('https://example.com', 'visits');
		expect(result).toBeNull();
	});

	it('formatCount produces correct abbreviations', () => {
		expect(TileStats.formatCount(0)).toBe('0');
		expect(TileStats.formatCount(999)).toBe('999');
		expect(TileStats.formatCount(1000)).toBe('1k');
		expect(TileStats.formatCount(1500)).toBe('1.5k');
		expect(TileStats.formatCount(10000)).toBe('10k');
	});
});

describe('TileStats — history permission guard (§1.3)', () => {
	let mockGetVisits: ReturnType<typeof vi.fn>;
	let mockContains: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		mockGetVisits = vi.fn();
		mockContains = vi.fn();

		(globalThis as any).browser = {
			history: {
				getVisits: mockGetVisits,
			},
			permissions: {
				contains: mockContains,
			},
		};
	});

	beforeEach(() => {
		mockGetVisits.mockReset();
		mockContains.mockReset();
		TileStats._hasHistoryPermission = null;
	});

	it('returns null when history permission is not granted', async () => {
		mockContains.mockResolvedValue(false);
		const result = await TileStats.compute('https://example.com', 'visits');
		expect(result).toBeNull();
		expect(mockGetVisits).not.toHaveBeenCalled();
	});

	it('calls getVisits when history permission is granted', async () => {
		mockContains.mockResolvedValue(true);
		mockGetVisits.mockResolvedValue([{ visitTime: Date.now() }]);
		const result = await TileStats.compute('https://example.com', 'visits');
		expect(mockGetVisits).toHaveBeenCalled();
		expect(result).toEqual({ type: 'visits', value: '1' });
	});
});

describe('statType pref — prefs.js', () => {
	let prefsSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: pref defaults
		prefsSource = fs.readFileSync(PREFS_PATH, 'utf8');
	});

	it('declares _statType default as "none"', () => {
		expect(prefsSource).toMatch(/_statType:\s*'none'/);
	});

	it('includes statType in the pref names list', () => {
		expect(prefsSource).toContain('\'statType\'');
	});

	it('validates statType values against the allowed set', () => {
		expect(prefsSource).toMatch(/\['none',\s*'visits',\s*'last',\s*'trend',\s*'rank',\s*'fresh'\]/);
	});
});

describe('statType pref — behavioral validation (§4.6)', () => {
	// PAGE_MODULES.md P3: prefs.js has a real `export` now — `vm.runInContext`
	// can no longer parse it. Natively imports the real module singleton
	// instead (crib: prefs-persistence.test.ts).
	let Prefs: any;

	beforeAll(async () => {
		(globalThis as any).chrome = {
			...(globalThis as any).chrome,
			storage: {
				local: {
					get: vi.fn((cb: Function) => cb({})),
					set: vi.fn(),
					remove: vi.fn(),
				},
				onChanged: { addListener: vi.fn() },
			},
			i18n: { getMessage: vi.fn(() => '') },
		};
		(globalThis as any).browser = {
			...(globalThis as any).browser,
			// prefs.js's init() now calls the promise-based browser.storage.local.*
			// (Slice C of the MV3 migration).
			storage: {
				local: {
					get: vi.fn().mockResolvedValue({}),
					set: vi.fn().mockResolvedValue(undefined),
					remove: vi.fn().mockResolvedValue(undefined),
				},
			},
		};

		({ Prefs } = await import('../../webextension/prefs.js'));
		await Prefs.init();
	});

	it('invalid statType is silently dropped, default retained', () => {
		expect(Prefs.statType).toBe('none');
		Prefs.parsePrefs({ statType: 'invalid' });
		expect(Prefs.statType).toBe('none');
	});

	it('valid statType is accepted', () => {
		Prefs.parsePrefs({ statType: 'visits' });
		expect(Prefs.statType).toBe('visits');
		Prefs.parsePrefs({ statType: 'none' });
	});
});
