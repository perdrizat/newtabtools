/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: pin-URL autocomplete tolerates title-less source items
 * (adjudicated chrome-prep C3 typing finding, 2026-07-10).
 *
 * `browser.tabs.Tab` / `bookmarks.BookmarkTreeNode` / `history.HistoryItem`
 * all declare `title` optional, but `newTabTools.autocomplete()`'s
 * `maybeAddItem` used to call `item.title.toLowerCase()` unguarded — a real
 * TypeError path: one title-less history/tab entry killed the whole
 * autocomplete pass. The C3c typing pass surfaced it (report-only then);
 * maintainer adjudication (2026-07-10) approved normalizing `title` at the
 * boundary.
 *
 * Harness: the drag-reorder.test.ts pattern — mount the real newTab.html
 * body, then dynamically import newTab.js (the legal cycle with grid.js/
 * page.js — chrome-prep C4c, CHROME_PREP.md — evaluates those too; a static
 * import can't sequence "mount, then import"). `chrome.tabs.query` is
 * stubbed callback-style (the page calls it with a callback, not a promise),
 * feeding a title-less tab.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseNewTabDocument } from './_helpers';

describe('pin-URL autocomplete — title-less source items (adjudicated C3 finding)', () => {
	let newTabTools: any;

	beforeAll(async () => {
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;
		const nt = await import('../../webextension/newTab.js');
		newTabTools = nt.newTabTools;
	});

	function stubTabs(tabs: Array<{ url: string; title?: string }>) {
		(globalThis as any).chrome.tabs.query = vi.fn(
			(_query: unknown, cb: (tabs: unknown[]) => void) => cb(tabs),
		);
	}

	it('a title-less tab whose URL does not match the input does not throw', () => {
		// Input must NOT be a substring of the URL so the match predicate
		// falls through to the `title` branch — the unguarded
		// `item.title.toLowerCase()` TypeError path.
		stubTabs([{ url: 'https://example.com/article' }]);
		newTabTools.pinURLInput.value = 'zzz';
		expect(() => newTabTools.autocomplete()).not.toThrow();
	});

	it('a title-less tab whose URL matches the input is added with an empty title, not "undefined"', () => {
		stubTabs([{ url: 'https://example.com/article' }]);
		newTabTools.pinURLInput.value = 'example';
		newTabTools.autocomplete();
		const added = [...newTabTools.pinURLAutocomplete.children].find(
			(li: HTMLElement) => li.dataset.url === 'https://example.com/article',
		) as HTMLElement | undefined;
		expect(added).toBeDefined();
		// Before the fix, `option.dataset.title = <undefined>` stored the
		// literal string "undefined" — which later substring-matching would
		// then match against.
		expect(added!.dataset.title).toBe('');
	});
});
