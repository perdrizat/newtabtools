/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: filters-ui.js's fillFilterUI topSites.get call
 * (CHROME.md D5 pre-work (b)).
 *
 * common.js's topSitesOptions(api) resolves `undefined` on Chrome (no
 * `getBrowserInfo` there) and an options object on Firefox (CHROME.md D3
 * finding, see topSitesOptions's own doc comment). Chrome's `topSites.get`
 * binding rejects ANY 2-argument call — even `get(undefined, callback)` —
 * with "No matching signature" (verified empirically); only the
 * 1-argument callback form (`get(callback)`) works there. fillFilterUI's
 * autocomplete-population branch must pick the call shape from whether
 * topSitesOptions resolved undefined, not just forward whatever it got.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// grid.js pulls in the newTab.js<->grid.js<->site.js cycle (titlebar.test.ts
// precedent) — fillFilterUI only reads `Grid.sites`, so an empty stub avoids
// transitively evaluating newTab.js's own top-level boot code entirely.
vi.mock('../../webextension/grid.js', () => ({ Grid: { sites: [] } }));
vi.mock('../../webextension/prefs.js', () => ({
	Filters: { getList: vi.fn(() => ({})) },
	NeverCapture: { getList: vi.fn(() => []) },
}));
vi.mock('../../webextension/common.js', () => ({
	getString: vi.fn((key: string) => key),
	topSitesOptions: vi.fn(),
}));

import { fillFilterUI } from '../../webextension/filters-ui.js';
import { uiRefs } from '../../webextension/ui-refs.js';
import { topSitesOptions } from '../../webextension/common.js';

/** Builds the minimal real DOM fillFilterUI reads/writes through uiRefs. */
function mountFilterTable() {
	const table = document.createElement('table');
	table.appendChild(document.createElement('tbody'));
	const container = document.createElement('div');
	container.appendChild(table);
	(uiRefs as any).optionsFilter = container;
	(uiRefs as any).optionsFilterHostAutocomplete = document.createElement('datalist');
}

describe('fillFilterUI — topSites.get argument-count-aware branch (CHROME.md D5 pre-work (b))', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mountFilterTable();
	});

	it('Chrome path (topSitesOptions resolves undefined): calls api.topSites.get with ONLY the callback (1 argument)', async () => {
		(topSitesOptions as any).mockResolvedValue(undefined);
		const getMock = vi.fn((cb: (sites: any[]) => void) => cb([]));
		(globalThis as any).browser.topSites = { get: getMock };

		await fillFilterUI();

		expect(getMock).toHaveBeenCalledTimes(1);
		expect(getMock.mock.calls[0]).toHaveLength(1);
		expect(typeof getMock.mock.calls[0][0]).toBe('function');
	});

	it('Firefox path (topSitesOptions resolves an options object): calls api.topSites.get with the EXACT options object and a callback (2 arguments, unchanged)', async () => {
		const options = { limit: 100, onePerDomain: false, includeBlocked: true };
		(topSitesOptions as any).mockResolvedValue(options);
		const getMock = vi.fn((opts: unknown, cb: (sites: any[]) => void) => cb([]));
		(globalThis as any).browser.topSites = { get: getMock };

		await fillFilterUI();

		expect(getMock).toHaveBeenCalledTimes(1);
		expect(getMock.mock.calls[0]).toHaveLength(2);
		expect(getMock.mock.calls[0][0]).toBe(options);
		expect(typeof getMock.mock.calls[0][1]).toBe('function');
	});

	it('Chrome path never passes a 2-argument call, even when the result includes sites', async () => {
		(topSitesOptions as any).mockResolvedValue(undefined);
		const getMock = vi.fn((cb: (sites: any[]) => void) => cb([{ url: 'https://example.com' }]));
		(globalThis as any).browser.topSites = { get: getMock };

		await fillFilterUI();

		for (const call of getMock.mock.calls) {
			expect(call).toHaveLength(1);
		}
	});

	it('populates the autocomplete datalist from the returned sites (both paths share the same result-handling)', async () => {
		(topSitesOptions as any).mockResolvedValue(undefined);
		const sites = [{ url: 'https://example.com/foo' }, { url: 'https://sub.example.com/' }];
		(globalThis as any).browser.topSites = { get: vi.fn((cb: (sites: any[]) => void) => cb(sites)) };

		await fillFilterUI();

		const options = Array.from((uiRefs as any).optionsFilterHostAutocomplete.children).map((o: any) => o.value);
		expect(options).toEqual(['example.com', 'sub.example.com']);
	});
});
