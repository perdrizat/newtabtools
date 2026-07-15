/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `Site.prototype.destroy` (site.js) — revokes the two cached blob URLs
 * (`_thumbnailObjectURL`/`_faviconObjectURL`, set by `refreshThumbnail`/
 * `applyFavicon`) and nulls them, idempotently. `Grid.refresh()` (grid.js)
 * calls it on every existing site before it flushes the grid's cells, so a
 * site's blob URLs get revoked instead of leaking until the page unloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSite } from './_helpers';
import { Prefs } from '../../webextension/prefs.js';
import { Tiles } from '../../webextension/tiles-shim.js';

let revokeSpy: ReturnType<typeof vi.fn>;
let urlCounter = 0;

beforeEach(() => {
	urlCounter = 0;
	(URL as any).createObjectURL = vi.fn(() => `blob:fake-${++urlCounter}`);
	revokeSpy = vi.fn();
	(URL as any).revokeObjectURL = revokeSpy;
});

describe('Site.prototype.destroy', () => {
	it('revokes and nulls both cached blob URLs', async () => {
		const { site } = await mountSite({ url: 'https://example.com/', image: new Blob(['t']) });
		site.applyFavicon(new Blob(['f']));

		const thumbURL = site._thumbnailObjectURL;
		const faviconURL = site._faviconObjectURL;
		expect(thumbURL).toBeTruthy();
		expect(faviconURL).toBeTruthy();

		site.destroy();

		expect(revokeSpy).toHaveBeenCalledWith(thumbURL);
		expect(revokeSpy).toHaveBeenCalledWith(faviconURL);
		expect(site._thumbnailObjectURL).toBeNull();
		expect(site._faviconObjectURL).toBeNull();
	});

	it('is idempotent — a second call revokes nothing further', async () => {
		const { site } = await mountSite({ url: 'https://example.com/', image: new Blob(['t']) });
		site.destroy();
		revokeSpy.mockClear();
		site.destroy();
		expect(revokeSpy).not.toHaveBeenCalled();
	});

	it('no-ops when neither blob URL was ever set', async () => {
		const { site } = await mountSite({ url: 'https://example.com/' });
		expect(() => site.destroy()).not.toThrow();
		expect(revokeSpy).not.toHaveBeenCalled();
	});
});

describe('Grid.refresh — destroys existing sites before flushing them', () => {
	it('revokes a flushed site\'s cached blob URL', async () => {
		const { site } = await mountSite({ url: 'https://example.com/', image: new Blob(['t']) });
		const thumbURL = site._thumbnailObjectURL;
		expect(thumbURL).toBeTruthy();

		const { Grid } = await import('../../webextension/grid.js');
		const { newTabTools } = await import('../../webextension/newTab.js');
		(Prefs as any).rows = 1;
		(Prefs as any).columns = 1;
		Grid._node = { querySelectorAll: vi.fn(() => [{}]) } as any;
		Grid._cells = [{ site, node: { firstElementChild: site.node, removeChild: vi.fn() } } as any];
		Tiles.getAllTiles = vi.fn().mockResolvedValue([]);
		newTabTools.getThumbnails = vi.fn();

		await Grid.refresh();

		expect(revokeSpy).toHaveBeenCalledWith(thumbURL);
		expect(site._thumbnailObjectURL).toBeNull();
	});
});
