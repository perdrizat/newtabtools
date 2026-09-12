/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `Site.prototype.unpin` (site.js) — the keep-vs-delete decision.
 *
 * Unpinning either deletes the tile record outright (`Tiles.removeTile`) or
 * keeps it minus its `position` (`Tiles.putTile`). The record is kept only
 * when it carries user data worth surviving the unpin: a custom `image`, a
 * per-tile `backgroundColor`, or a user-set title.
 *
 * `titleIsUserSet` is persisted as `false` on every title/URL edit, so its mere
 * presence is bookkeeping, not data — hence `=== true`. Both directions are
 * asserted: bookkeeping-only records delete, user-data records survive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSite } from './_helpers';
import { Tiles } from '../../webextension/tiles-shim.js';

const TEST_URL = 'https://example.com/';

let removeTileSpy: ReturnType<typeof vi.fn>;
let putTileSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	removeTileSpy = vi.fn().mockResolvedValue(undefined);
	putTileSpy = vi.fn().mockResolvedValue(undefined);
	(Tiles as any).removeTile = removeTileSpy;
	(Tiles as any).putTile = putTileSpy;
	// `unpin()` is a no-op unless the site reports pinned, and `Site#isPinned`
	// reads the real `Tiles.isPinned(url)` → `_list.includes(url)`. Seed the
	// list rather than stubbing the getter, so the pinned check stays real.
	(Tiles as any)._list = [TEST_URL];
});

/** Mount a pinned site with the given link shape and unpin it. */
async function unpinWith(link: Record<string, unknown>) {
	const { site } = await mountSite({ id: 7, position: 0, ...link } as any);

	// Stubbed only AFTER mountSite(), never via a top-level import: updater.js
	// transitively reaches newTab.js, whose top-level DOM wiring throws on a
	// document that isn't mounted yet (a static import is hoisted above the
	// mount — the same constraint _helpers.ts documents for site.js/grid.js).
	// Both unpin() branches chain into updateGrid(), which re-reads the grid
	// over the mocked message wire and would otherwise surface as an unhandled
	// rejection; stubbing keeps the assertions on the keep-vs-delete choice.
	const { Updater } = await import('../../webextension/updater.js');
	(Updater as any).updateGrid = vi.fn();

	site.unpin();
	// unpin()'s branches are promise-chained; flush the microtask queue.
	await Promise.resolve();
	await Promise.resolve();
	return site;
}

describe('Site.prototype.unpin — deletes records carrying no user data', () => {
	it('deletes a plain pinned tile', async () => {
		await unpinWith({ url: TEST_URL });
		expect(removeTileSpy).toHaveBeenCalled();
		expect(putTileSpy).not.toHaveBeenCalled();
	});

	it('deletes a tile whose title was edited and then un-set (titleIsUserSet: false)', async () => {
		// The exact zombie case: newTab.js writes `titleIsUserSet: false` on the
		// options-title-remove / options-url-set paths. It is bookkeeping, not
		// data, so it must not keep the record alive.
		await unpinWith({
			url: TEST_URL,
			title: 'Example',
			titleIsUserSet: false,
		});
		expect(removeTileSpy).toHaveBeenCalled();
		expect(putTileSpy).not.toHaveBeenCalled();
	});
});

describe('Site.prototype.unpin — keeps records carrying user data', () => {
	it('keeps a tile with a user-set title', async () => {
		await unpinWith({
			url: TEST_URL,
			title: 'My Custom Title',
			titleIsUserSet: true,
		});
		expect(putTileSpy).toHaveBeenCalled();
		expect(removeTileSpy).not.toHaveBeenCalled();
	});

	it('keeps a tile with a custom uploaded image', async () => {
		await unpinWith({ url: TEST_URL, image: new Blob(['img']) });
		expect(putTileSpy).toHaveBeenCalled();
		expect(removeTileSpy).not.toHaveBeenCalled();
	});

	it('keeps a tile with a per-tile background colour', async () => {
		await unpinWith({ url: TEST_URL, backgroundColor: '#ff0000' });
		expect(putTileSpy).toHaveBeenCalled();
		expect(removeTileSpy).not.toHaveBeenCalled();
	});

	it('drops `position` from a kept record', async () => {
		await unpinWith({ url: TEST_URL, backgroundColor: '#ff0000' });
		const kept = putTileSpy.mock.calls[0][0];
		expect(kept.position).toBeUndefined();
	});
});
