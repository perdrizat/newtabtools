/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * chrome-prep C5b (CHROME_PREP.md, `audit/2026-07-11-chrome-api-divergence.md`
 * #3): unit coverage for api.js's `searchWeb` wrapper. The gating logic under
 * test is the SELECTION direction, not mere presence: Firefox has shipped
 * both `search.search` and `search.query` since Firefox 94 (MDN), so this
 * must keep picking `search.search` whenever it exists — even alongside
 * `query` — rather than presence-testing `query` (which would flip Firefox
 * onto the Chrome-shaped call).
 */

import { describe, it, expect, vi } from 'vitest';
import { searchWeb } from '../../webextension/api.js';

describe('searchWeb', () => {
	it('calls search.search (Firefox path) when only search.search exists', () => {
		const searchMock = vi.fn();
		const original = (globalThis as any).browser.search;
		(globalThis as any).browser.search = { search: searchMock };
		try {
			searchWeb({ query: 'cats', newTab: false });
			expect(searchMock).toHaveBeenCalledWith({ query: 'cats', disposition: 'CURRENT_TAB' });
		} finally {
			(globalThis as any).browser.search = original;
		}
	});

	it('prefers search.search over search.query when BOTH exist (real Firefox 94+ shape) — must not flip to the Chrome path', () => {
		const searchMock = vi.fn();
		const queryMock = vi.fn();
		const original = (globalThis as any).browser.search;
		(globalThis as any).browser.search = { search: searchMock, query: queryMock };
		try {
			searchWeb({ query: 'dogs', newTab: true });
			expect(searchMock).toHaveBeenCalledWith({ query: 'dogs', disposition: 'NEW_TAB' });
			expect(queryMock).not.toHaveBeenCalled();
		} finally {
			(globalThis as any).browser.search = original;
		}
	});

	it('falls back to search.query (Chrome-dormant path, {text, disposition} shape) when search.search is absent', () => {
		const queryMock = vi.fn();
		const original = (globalThis as any).browser.search;
		(globalThis as any).browser.search = { query: queryMock };
		try {
			searchWeb({ query: 'birds', newTab: false });
			expect(queryMock).toHaveBeenCalledWith({ text: 'birds', disposition: 'CURRENT_TAB' });
		} finally {
			(globalThis as any).browser.search = original;
		}
	});
});
