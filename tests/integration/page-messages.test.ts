/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: page-side runtime.onMessage listener (Slice A of the
 * MV3 migration, MV3_MIGRATION.md).
 *
 * The background can no longer reach into page globals via
 * chrome.extension.getViews() (removed in MV3); instead it broadcasts
 * 'Page.updateGrid' / 'Page.restoreComplete' and every open new-tab page
 * refreshes itself. This exercises the real `pageMessageHandler` and its
 * top-level registration, extracted from newTab.js and run in a vm context:
 *   - 'Page.updateGrid' → Updater.updateGrid()
 *   - 'Page.restoreComplete' → refreshBackgroundImage + Grid.refresh +
 *     getThumbnails (in that order — thumbnails only after the rebuild)
 *   - every other message (including page→background names like
 *     'Tiles.putTile', which fan out to this listener too) returns a falsy
 *     value and touches nothing — the listener must never claim the
 *     sendResponse channel that belongs to the background dispatcher.
 *   - `Updater`/`Grid` are defined by fx-newTab.js, which loads AFTER
 *     newTab.js — an early message must not throw.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

const REGISTRATION = 'browser.runtime.onMessage.addListener(pageMessageHandler);';

type MessageListener = (message: any, sender: any, sendResponse: any) => unknown;

/**
 * Extracts the real `pageMessageHandler` function plus its top-level
 * registration statement from newTab.js and evaluates them in a fresh vm
 * context. Globals the handler may touch (Updater, Grid, newTabTools) are
 * only defined when the caller provides them, so the "fx-newTab.js not
 * loaded yet" case is representable by omission.
 */
function loadHandler(sandbox: Record<string, unknown>) {
	// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
	const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
	const start = source.indexOf('function pageMessageHandler(');
	if (start === -1) {
		throw new Error('pageMessageHandler not found in newTab.js');
	}
	const regIndex = source.indexOf(REGISTRATION, start);
	if (regIndex === -1) {
		throw new Error('top-level onMessage registration not found in newTab.js');
	}
	const code = source.slice(start, regIndex + REGISTRATION.length);

	const addListener = vi.fn();
	const ctx = vm.createContext({
		browser: { runtime: { onMessage: { addListener } } },
		...sandbox,
	});
	vm.runInContext(code, ctx, { filename: 'page-message-harness.js' });

	const listener = addListener.mock.calls[0]?.[0] as MessageListener & { flushQueued: () => void };
	// `ctx` is returned too — MV3 review §4.3 tests mutate it after the
	// initial load (e.g. defining `Updater`/`Grid` only once fx-newTab.js
	// has "finished loading", to prove the queued-then-flushed replay takes
	// the direct branch once the globals exist).
	return { listener, addListener, ctx };
}

const sender = { id: 'newtabtools@symlink.ch' };

describe('newTab.js — page-side runtime.onMessage listener (Slice A)', () => {
	it('registers exactly one listener synchronously at script evaluation', () => {
		const { addListener, listener } = loadHandler({});
		expect(addListener).toHaveBeenCalledTimes(1);
		expect(typeof listener).toBe('function');
	});

	it('\'Page.updateGrid\' calls Updater.updateGrid and returns a falsy value', () => {
		const updateGrid = vi.fn();
		const sendResponse = vi.fn();
		const { listener } = loadHandler({ Updater: { updateGrid } });

		const result = listener({ name: 'Page.updateGrid' }, sender, sendResponse);

		expect(updateGrid).toHaveBeenCalledTimes(1);
		expect(result).toBeFalsy();
		expect(sendResponse).not.toHaveBeenCalled();
	});

	it('\'Page.updateGrid\' before fx-newTab.js has loaded (no Updater) does not throw', () => {
		const { listener } = loadHandler({});
		expect(() => listener({ name: 'Page.updateGrid' }, sender, vi.fn())).not.toThrow();
	});

	it('\'Page.restoreComplete\' refreshes wallpaper, rebuilds the grid, then pulls thumbnails', async () => {
		let resolveRefresh!: () => void;
		const refresh = vi.fn(() => new Promise<void>(res => { resolveRefresh = res; }));
		const updateGrid = vi.fn();
		const newTabTools = { refreshBackgroundImage: vi.fn(), getThumbnails: vi.fn() };
		const sendResponse = vi.fn();
		const { listener } = loadHandler({ Grid: { refresh }, Updater: { updateGrid }, newTabTools });

		const result = listener({ name: 'Page.restoreComplete' }, sender, sendResponse);

		expect(result).toBeFalsy();
		expect(newTabTools.refreshBackgroundImage).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		// Regression (formerly pinned by backup-restore-refresh.test.ts): the
		// post-restore path must NOT use Updater.updateGrid — it reuses Site
		// instances whose in-memory `_link` points at pre-restore data. Only
		// Grid.refresh() (fresh Site construction) picks up restored links.
		expect(updateGrid).not.toHaveBeenCalled();
		// Thumbnails wait for the grid rebuild — Grid.refresh has not resolved yet.
		expect(newTabTools.getThumbnails).not.toHaveBeenCalled();
		resolveRefresh();
		await vi.waitFor(() => expect(newTabTools.getThumbnails).toHaveBeenCalledTimes(1));
		expect(sendResponse).not.toHaveBeenCalled();
	});

	it('\'Page.restoreComplete\' before fx-newTab.js has loaded (no Grid) does not throw', () => {
		const newTabTools = { refreshBackgroundImage: vi.fn(), getThumbnails: vi.fn() };
		const { listener } = loadHandler({ newTabTools });
		expect(() => listener({ name: 'Page.restoreComplete' }, sender, vi.fn())).not.toThrow();
	});

	it('leaves page→background messages (e.g. \'Tiles.putTile\') untouched', () => {
		const updateGrid = vi.fn();
		const refresh = vi.fn();
		const newTabTools = { refreshBackgroundImage: vi.fn(), getThumbnails: vi.fn() };
		const sendResponse = vi.fn();
		const { listener } = loadHandler({ Updater: { updateGrid }, Grid: { refresh }, newTabTools });

		const result = listener(
			{ name: 'Tiles.putTile', tile: { url: 'https://example.com' } },
			sender, sendResponse,
		);

		// Never `true`, never a response — response routing stays with the
		// background dispatcher.
		expect(result).toBeFalsy();
		expect(sendResponse).not.toHaveBeenCalled();
		expect(updateGrid).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(newTabTools.refreshBackgroundImage).not.toHaveBeenCalled();
		expect(newTabTools.getThumbnails).not.toHaveBeenCalled();
	});

	it('returns a falsy value for unknown names, missing names, and null messages', () => {
		const { listener } = loadHandler({});
		expect(listener({ name: 'NoSuchThing' }, sender, vi.fn())).toBeFalsy();
		expect(listener({}, sender, vi.fn())).toBeFalsy();
		expect(listener(null, sender, vi.fn())).toBeFalsy();
	});

	// -----------------------------------------------------------------------
	// MV3 review §4.3 (folded into MODERNIZATION.md M5): early broadcasts are
	// queued (not silently dropped) and replayed once fx-newTab.js's globals
	// exist, via `pageMessageHandler.flushQueued()` — the one line
	// fx-newTab.js adds at the very end of its own top-level execution.
	// -----------------------------------------------------------------------

	describe('early-broadcast queue + flushQueued (§4.3)', () => {
		it('an early \'Page.updateGrid\' (no Updater yet) is queued, not dropped, and does not throw', () => {
			const { listener } = loadHandler({});
			expect(() => listener({ name: 'Page.updateGrid' }, sender, vi.fn())).not.toThrow();
			expect(listener.flushQueued).toBeDefined();
		});

		it('flushQueued() replays a queued \'Page.updateGrid\' exactly once, after Updater exists', () => {
			const updateGrid = vi.fn();
			const { listener, ctx } = loadHandler({});

			// Arrives before fx-newTab.js's globals exist — queued.
			listener({ name: 'Page.updateGrid' }, sender, vi.fn());
			expect(updateGrid).not.toHaveBeenCalled();

			// fx-newTab.js finishes loading — Updater now exists in this
			// context — then calls flushQueued() (the one added line).
			(ctx as Record<string, unknown>).Updater = { updateGrid };
			listener.flushQueued();

			expect(updateGrid).toHaveBeenCalledTimes(1);
		});

		it('two queued \'Page.updateGrid\' broadcasts dedupe to a single flush-time refresh', () => {
			const updateGrid = vi.fn();
			const { listener, ctx } = loadHandler({});

			listener({ name: 'Page.updateGrid' }, sender, vi.fn());
			listener({ name: 'Page.updateGrid' }, sender, vi.fn());

			(ctx as Record<string, unknown>).Updater = { updateGrid };
			listener.flushQueued();

			expect(updateGrid).toHaveBeenCalledTimes(1);
		});

		it('flushQueued() replays a queued \'Page.restoreComplete\' exactly once, after Grid/newTabTools exist', async () => {
			let resolveRefresh!: () => void;
			const refresh = vi.fn(() => new Promise<void>(res => { resolveRefresh = res; }));
			const newTabTools = { refreshBackgroundImage: vi.fn(), getThumbnails: vi.fn() };
			const { listener, ctx } = loadHandler({});

			listener({ name: 'Page.restoreComplete' }, sender, vi.fn());
			expect(newTabTools.refreshBackgroundImage).not.toHaveBeenCalled();

			(ctx as Record<string, unknown>).Grid = { refresh };
			(ctx as Record<string, unknown>).newTabTools = newTabTools;
			listener.flushQueued();

			expect(newTabTools.refreshBackgroundImage).toHaveBeenCalledTimes(1);
			resolveRefresh();
			await vi.waitFor(() => expect(newTabTools.getThumbnails).toHaveBeenCalledTimes(1));
		});

		it('flushQueued() with nothing queued does not throw and calls nothing', () => {
			const updateGrid = vi.fn();
			const { listener } = loadHandler({ Updater: { updateGrid } });
			expect(() => listener.flushQueued()).not.toThrow();
			expect(updateGrid).not.toHaveBeenCalled();
		});

		it('a LATE message (globals already present, nothing queued) still works directly, without going through the queue', () => {
			const updateGrid = vi.fn();
			const { listener } = loadHandler({ Updater: { updateGrid } });
			listener({ name: 'Page.updateGrid' }, sender, vi.fn());
			expect(updateGrid).toHaveBeenCalledTimes(1);
		});
	});
});
