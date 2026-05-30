/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phase 4-3 — Awesome bar. The data layer (`AwesomeBar.buildResults`) is a pure
 * function: given a query and the three local sources (tiles, bookmarks,
 * history), it produces the ordered, de-duplicated, sectioned result list the
 * dropdown renders. The list always ends with a single "search the web" entry.
 * `AwesomeBar.nextIndex` is the wrap-around cursor math for Up/Down nav.
 *
 * Loaded through the shared `loadModule` vm harness so the module's `browser`/
 * `chrome`/`document` references at init don't need a real browser.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadModule } from './_helpers.ts';

describe('AwesomeBar.buildResults — pure result model', () => {
	let AwesomeBar: any;

	beforeAll(() => {
		const ctx = loadModule('../../webextension/awesomebar.js');
		AwesomeBar = ctx.AwesomeBar;
	});

	const sources = () => ({
		tiles: [{ url: 'https://github.com/', title: 'GitHub' }],
		bookmarks: [{ url: 'https://gitlab.com/', title: 'GitLab' }],
		history: [{ url: 'https://git-scm.com/', title: 'Git SCM' }],
	});

	it('returns an empty list for a blank query', () => {
		expect(AwesomeBar.buildResults('', sources())).toEqual([]);
		expect(AwesomeBar.buildResults('   ', sources())).toEqual([]);
	});

	it('always ends with exactly one web-search entry carrying the query', () => {
		const r = AwesomeBar.buildResults('git', sources());
		const web = r.filter((x: any) => x.type === 'search');
		expect(web).toHaveLength(1);
		expect(r[r.length - 1].type).toBe('search');
		expect(web[0].section).toBe('web');
		expect(web[0].query).toBe('git');
	});

	it('promotes a single top match (highest priority: tile > bookmark > history)', () => {
		const r = AwesomeBar.buildResults('git', sources());
		const top = r.filter((x: any) => x.section === 'top');
		expect(top).toHaveLength(1);
		expect(top[0].url).toBe('https://github.com/');
		expect(top[0].type).toBe('tile');
	});

	it('does not repeat the promoted top match in the match section', () => {
		const r = AwesomeBar.buildResults('git', sources());
		const githubEntries = r.filter((x: any) => x.url === 'https://github.com/');
		expect(githubEntries).toHaveLength(1);
	});

	it('groups tiles + bookmarks under the "match" section, history under "history"', () => {
		const r = AwesomeBar.buildResults('git', sources());
		const sectionsByUrl = Object.fromEntries(r.filter((x: any) => x.url).map((x: any) => [x.url, x.section]));
		// gitlab is a bookmark match (not promoted) → "match"; git-scm is history.
		expect(sectionsByUrl['https://gitlab.com/']).toBe('match');
		expect(sectionsByUrl['https://git-scm.com/']).toBe('history');
	});

	it('matches case-insensitively on title or URL, all terms required', () => {
		const r = AwesomeBar.buildResults('GIT hub', sources());
		const urls = r.filter((x: any) => x.url).map((x: any) => x.url);
		expect(urls).toContain('https://github.com/');   // "git" + "hub" both in github.com / GitHub
		expect(urls).not.toContain('https://gitlab.com/'); // lacks "hub"
	});

	it('de-duplicates by URL with tile winning over bookmark/history', () => {
		const dup = {
			tiles: [{ url: 'https://x.example/', title: 'X tile' }],
			bookmarks: [{ url: 'https://x.example/', title: 'X bookmark' }],
			history: [{ url: 'https://x.example/', title: 'X history' }],
		};
		const r = AwesomeBar.buildResults('x.example', dup);
		const xs = r.filter((e: any) => e.url === 'https://x.example/');
		expect(xs).toHaveLength(1);
		expect(xs[0].type).toBe('tile');
	});

	it('caps the match and history sections at the given limit', () => {
		const many = {
			tiles: [],
			bookmarks: Array.from({ length: 20 }, (_, i) => ({ url: `https://b${i}.example/`, title: `Site ${i}` })),
			history: Array.from({ length: 20 }, (_, i) => ({ url: `https://h${i}.example/`, title: `Hist ${i}` })),
		};
		const r = AwesomeBar.buildResults('site', many, { limit: 5 });
		// "site" matches the bookmark titles ("Site N"); history titles ("Hist N") don't match.
		const match = r.filter((x: any) => x.section === 'match');
		expect(match.length).toBeLessThanOrEqual(5);
	});

	it('with no local matches, yields only the web entry (no empty top)', () => {
		const r = AwesomeBar.buildResults('zzzznomatch', sources());
		expect(r).toHaveLength(1);
		expect(r[0].type).toBe('search');
		expect(r[0].section).toBe('web');
	});

	it('tolerates missing/empty sources', () => {
		expect(() => AwesomeBar.buildResults('git', {})).not.toThrow();
		const r = AwesomeBar.buildResults('git', {});
		expect(r[r.length - 1].type).toBe('search');
	});
});

describe('AwesomeBar.nextIndex — wrap-around cursor', () => {
	let AwesomeBar: any;

	beforeAll(() => {
		AwesomeBar = loadModule('../../webextension/awesomebar.js').AwesomeBar;
	});

	it('moves down and wraps from last to first', () => {
		expect(AwesomeBar.nextIndex(0, 3, +1)).toBe(1);
		expect(AwesomeBar.nextIndex(2, 3, +1)).toBe(0);
	});

	it('moves up and wraps from first to last', () => {
		expect(AwesomeBar.nextIndex(1, 3, -1)).toBe(0);
		expect(AwesomeBar.nextIndex(0, 3, -1)).toBe(2);
	});

	it('returns -1 (no selection) for an empty list', () => {
		expect(AwesomeBar.nextIndex(-1, 0, +1)).toBe(-1);
		expect(AwesomeBar.nextIndex(-1, 0, -1)).toBe(-1);
	});

	it('a fresh Down from no-selection lands on the first item', () => {
		expect(AwesomeBar.nextIndex(-1, 3, +1)).toBe(0);
	});

	it('a fresh Up from no-selection lands on the last item', () => {
		expect(AwesomeBar.nextIndex(-1, 3, -1)).toBe(2);
	});
});
