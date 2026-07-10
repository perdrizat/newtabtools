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
 *   - Dispatches DIRECTLY and synchronously, with no queue: chrome-prep C3a
 *     (CHROME_PREP.md) retired the MV3-review-§4.3/MODERNIZATION.md-M5
 *     early-broadcast queue + `flushQueued()` replay it used to fall back to.
 *     `Updater`/`Grid` are real ES-module imports (updater.js/grid.js)
 *     (PAGE_MODULES.md P5), and the P5 import cycle guarantees grid.js's
 *     own top-level evaluation completes before newTab.js's
 *     `browser.runtime.onMessage.addListener(pageMessageHandler)` call can
 *     ever be invoked — so both names are always initialized by the time a
 *     broadcast arrives; there is no "arrived too early" case left to cover.
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
 * context. `Updater`/`Grid`/`newTabTools` must be supplied by the caller —
 * production always has them by the time the listener can be invoked (see
 * the header comment above), so every test below provides them up front.
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
		console,
		...sandbox,
	});
	vm.runInContext(code, ctx, { filename: 'page-message-harness.js' });

	const listener = addListener.mock.calls[0]?.[0] as MessageListener;
	return { listener, addListener };
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

	it('\'Page.restoreComplete\' refreshes wallpaper, rebuilds the grid, then pulls thumbnails', async () => {
		let resolveRefresh!: () => void;
		const refresh = vi.fn(() => new Promise<void>(res => { resolveRefresh = res; }));
		const updateGrid = vi.fn();
		const newTabTools = { getThumbnails: vi.fn() };
		// chrome-prep C4d (CHROME_PREP.md): `refreshBackgroundImage` moved to
		// wallpaper.js — `pageMessageHandler`'s extracted body now calls it as
		// a bare identifier, so it's supplied at the top level of the vm
		// sandbox instead of nested under `newTabTools`.
		const refreshBackgroundImage = vi.fn();
		const sendResponse = vi.fn();
		const { listener } = loadHandler({ Grid: { refresh }, Updater: { updateGrid }, newTabTools, refreshBackgroundImage });

		const result = listener({ name: 'Page.restoreComplete' }, sender, sendResponse);

		expect(result).toBeFalsy();
		expect(refreshBackgroundImage).toHaveBeenCalledTimes(1);
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

	it('leaves page→background messages (e.g. \'Tiles.putTile\') untouched', () => {
		const updateGrid = vi.fn();
		const refresh = vi.fn();
		const newTabTools = { getThumbnails: vi.fn() };
		const refreshBackgroundImage = vi.fn();
		const sendResponse = vi.fn();
		const { listener } = loadHandler({ Updater: { updateGrid }, Grid: { refresh }, newTabTools, refreshBackgroundImage });

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
		expect(refreshBackgroundImage).not.toHaveBeenCalled();
		expect(newTabTools.getThumbnails).not.toHaveBeenCalled();
	});

	it('returns a falsy value for unknown names, missing names, and null messages', () => {
		const { listener } = loadHandler({});
		expect(listener({ name: 'NoSuchThing' }, sender, vi.fn())).toBeFalsy();
		expect(listener({}, sender, vi.fn())).toBeFalsy();
		expect(listener(null, sender, vi.fn())).toBeFalsy();
	});

	// -------------------------------------------------------------------------
	// chrome-prep C3a (CHROME_PREP.md): the MV3-review-§4.3/MODERNIZATION.md-M5
	// early-broadcast queue (`_queue`/`_enqueue`/`flushQueued()`) is retired —
	// it existed only for a load-order hazard (the page monolith's globals
	// not yet existing when a broadcast arrived) that PAGE_MODULES.md's P5 import cycle
	// made provably unreachable. These tests replace the old queue-behavior
	// suite: they assert the apparatus is actually gone, and that both
	// broadcasts dispatch straight through with no deferral of any kind.
	// -------------------------------------------------------------------------
	describe('direct dispatch, no queue (chrome-prep C3a)', () => {
		it('exposes no flushQueued/_queue/_enqueue on the listener — the replay apparatus is gone, not just unreachable', () => {
			const { listener } = loadHandler({ Updater: { updateGrid: vi.fn() }, Grid: { refresh: vi.fn() } });
			expect((listener as any).flushQueued).toBeUndefined();
			expect((listener as any)._queue).toBeUndefined();
			expect((listener as any)._enqueue).toBeUndefined();
		});

		it('\'Page.updateGrid\' calls Updater.updateGrid immediately — no queue, no replay step needed', () => {
			const updateGrid = vi.fn();
			const { listener } = loadHandler({ Updater: { updateGrid } });

			listener({ name: 'Page.updateGrid' }, sender, vi.fn());

			expect(updateGrid).toHaveBeenCalledTimes(1);
		});

		it('\'Page.restoreComplete\' calls refreshBackgroundImage + Grid.refresh immediately — no queue, no replay step needed', () => {
			const refresh = vi.fn(() => Promise.resolve());
			const newTabTools = { getThumbnails: vi.fn() };
			const refreshBackgroundImage = vi.fn();
			const { listener } = loadHandler({ Grid: { refresh }, newTabTools, refreshBackgroundImage });

			listener({ name: 'Page.restoreComplete' }, sender, vi.fn());

			expect(refreshBackgroundImage).toHaveBeenCalledTimes(1);
			expect(refresh).toHaveBeenCalledTimes(1);
		});
	});
});
