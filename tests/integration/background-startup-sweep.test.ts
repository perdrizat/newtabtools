/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: startup tab sweep (MV3 migration regression, UAT finding
 * 2026-07-09, see MV3_MIGRATION.md).
 *
 * Under MV2 (persistent background) the top-level `browser.tabs.query({})`
 * sweep in background.js ran exactly once per browser session, so its
 * "reload stale new-tab pages" branch was a harmless one-shot. Under MV3
 * the background is an event page whose top-level code re-runs on every
 * respawn (~30s idle cycle) — so a top-level reload sweep reloaded the
 * user's open new-tab pages continuously (observed 4x in one UAT scenario,
 * destroying the open drawer/edit-mode state).
 *
 * Fix under test: the reload behavior moved into a `runtime.onInstalled`
 * listener (fires once per install/update, matching the original MV2
 * intent); the top-level sweep keeps only the harmless per-respawn
 * action-button enable/disable, now skipping new-tab-page tabs entirely
 * (`continue`) rather than letting them fall into the disable branch.
 *
 * This loads the real `background.js` (script-mode) the same way
 * `background-messages.test.ts` / `event-page-resilience.test.ts` do.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { withStore } from '../../webextension/lib/db.js';
import { SAFE_PROTOCOLS } from '../../webextension/lib/constants.js';
import { getTZDateString, resetNetworkIdleTimer } from '../../webextension/lib/capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND_PATH = path.resolve(__dirname, '../../webextension/background.js');
const EXTENSION_ID = 'newtabtools@symlink.ch';
const NEW_TAB_URL = 'moz-extension://test-uuid/newTab.xhtml';

/**
 * Simulates an IDB cursor iteration (see background-messages.test.ts for the
 * canonical version — duplicated here per the project's existing per-file
 * mocking convention).
 */
function mockCursorIteration(entries: Array<Record<string, unknown>>) {
	let index = 0;
	let handler: Function;
	const request: Record<string, unknown> = {};

	const advance = () => {
		if (index < entries.length) {
			const entry = entries[index++];
			const cursor = {
				value: { ...entry },
				update: vi.fn(),
				continue: () => advance(),
				delete: vi.fn(),
			};
			handler.call({ result: cursor });
		} else {
			handler.call({ result: null });
		}
	};

	Object.defineProperty(request, 'onsuccess', {
		set(cb: Function) { handler = cb; advance(); },
		configurable: true,
	});

	return request;
}

describe('background.js — startup tab sweep (reload vs. onInstalled)', () => {
	let onInstalledListener: Function;
	let tabsQueryMock: ReturnType<typeof vi.fn>;
	let reloadMock: ReturnType<typeof vi.fn>;
	let enableMock: ReturnType<typeof vi.fn>;
	let disableMock: ReturnType<typeof vi.fn>;

	// Snapshots of each mock's calls made by the top-level sweep during the
	// single script load in beforeAll (taken before any test's beforeEach
	// clears the mocks, and before the onInstalled-dispatch tests add more
	// calls of their own).
	let loadReloadCalls: unknown[][];
	let loadEnableCalls: unknown[][];
	let loadDisableCalls: unknown[][];

	const httpTab = { id: 1, url: 'https://example.com/' };
	const newTabPageTab = { id: 2, url: NEW_TAB_URL };
	const aboutTab = { id: 3, url: 'about:preferences' };

	beforeAll(async () => {
		// --- Tiles / Background / Prefs / Blocked / Filters / NeverCapture ---
		(globalThis as any).Tiles = {
			ensureReady: vi.fn().mockResolvedValue({ cache: [], list: [] }),
			isPinned: vi.fn().mockReturnValue(false),
			getGridTiles: vi.fn().mockResolvedValue([]),
			getTile: vi.fn().mockResolvedValue(null),
			putTile: vi.fn().mockResolvedValue(undefined),
			removeTile: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
			pinTile: vi.fn().mockResolvedValue(1),
			_list: [],
			_cache: [],
			_ready: false,
		};
		(globalThis as any).Background = {
			getBackground: vi.fn().mockResolvedValue(null),
			setBackground: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).Prefs = {
			init: vi.fn().mockResolvedValue(undefined),
			version: -1,
			rows: 3,
			columns: 3,
		};
		(globalThis as any).Blocked = { _list: [] };
		(globalThis as any).Filters = { _list: Object.create(null) };
		(globalThis as any).NeverCapture = {
			_list: [] as string[],
			matches: vi.fn().mockReturnValue(false),
			matchingEntry: vi.fn().mockReturnValue(undefined),
			hostMatchesPattern: vi.fn().mockReturnValue(false),
		};
		(globalThis as any).makeZip = vi.fn().mockResolvedValue(new Blob(['zip-data']));
		(globalThis as any).readZip = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).compareVersions = vi.fn().mockReturnValue(0);

		// --- Mock DB (IndexedDB) ---
		const thumbnailStore = {
			put: vi.fn(),
			get: vi.fn(),
			delete: vi.fn(),
			openCursor: vi.fn(() => mockCursorIteration([])),
			index: vi.fn(() => ({ openCursor: vi.fn(() => mockCursorIteration([])) })),
		};
		const stores: Record<string, unknown> = {
			tiles: {
				put: vi.fn(), get: vi.fn(), getAll: vi.fn(),
				openCursor: vi.fn(() => mockCursorIteration([])), createIndex: vi.fn(),
				indexNames: { contains: () => true },
			},
			thumbnails: thumbnailStore,
			background: { put: vi.fn(), get: vi.fn() },
		};
		const mockDB = {
			objectStoreNames: { contains: (n: string) => n in stores },
			transaction: vi.fn(() => ({ objectStore: vi.fn((n: string) => stores[n]) })),
			createObjectStore: vi.fn(),
			close: vi.fn(),
		};
		const dbReq: Record<string, unknown> = {};
		for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
			Object.defineProperty(dbReq, prop, {
				set: prop === 'onsuccess'
					? function (cb: Function) { cb.call({ result: mockDB }); }
					: function () { /* no-op */ },
				configurable: true,
			});
		}
		(globalThis as any).indexedDB = { open: vi.fn(() => dbReq) };
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		// M2: bridge the real lib/db.js withStore() onto globalThis, same as
		// production's lib/background-main.js does — background.js still
		// reads it as a bare identifier (bridge-mode file, see db-wake-race
		// test for the canonical explanation of this pattern).
		(globalThis as any).withStore = withStore;
		(globalThis as any).SAFE_PROTOCOLS = SAFE_PROTOCOLS;

		// M3: bridge lib/capture.js's exports background.js needs at its own
		// top level (the webRequest listeners' resetNetworkIdleTimer closure —
		// see background.js's own comment) and lazily (getTZDateString, used by
		// cleanupThumbnails/idleListener, unused by this test's flows but still
		// referenced by the message dispatcher).
		(globalThis as any).getTZDateString = getTZDateString;
		(globalThis as any).resetNetworkIdleTimer = resetNetworkIdleTimer;

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn(() => NEW_TAB_URL);
		(globalThis as any).chrome.management = {
			getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }),
		};
		(globalThis as any).browser.menus = {
			create: vi.fn((_props: unknown, cb?: Function) => { if (cb) { cb(); } }),
			update: vi.fn(),
			refresh: vi.fn(),
			onShown: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.idle = {
			onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		};
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({});
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };

		// The startup sweep queries tabs at top level (per respawn) — return a
		// mix of an http tab, a new-tab-page tab, and a non-http tab so both
		// the enable/disable branches and the new-tab-page skip are exercised
		// at load time.
		reloadMock = vi.fn();
		(globalThis as any).chrome.tabs.reload = reloadMock;
		enableMock = vi.fn().mockResolvedValue(undefined);
		disableMock = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.action = {
			enable: enableMock,
			disable: disableMock,
		};
		tabsQueryMock = vi.fn().mockResolvedValue([httpTab, newTabPageTab, aboutTab]);
		(globalThis as any).chrome.tabs.query = tabsQueryMock;

		// --- Load background.js (script-mode, runs in global scope) ---
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const code = fs.readFileSync(BACKGROUND_PATH, 'utf8');
		vm.runInThisContext(code, { filename: 'background.js' });

		// Flush microtasks so the top-level tabs.query().then(...) sweep and
		// the init Promise.all resolve.
		await new Promise(resolve => setTimeout(resolve, 0));
		await new Promise(resolve => setTimeout(resolve, 0));
		await new Promise(resolve => setTimeout(resolve, 0));

		// --- Capture the runtime.onInstalled listener ---
		const calls = (globalThis as any).chrome.runtime.onInstalled.addListener.mock.calls;
		expect(calls.length).toBe(1);
		onInstalledListener = calls[0][0] as Function;

		// Snapshot what the top-level sweep did during load, BEFORE any test
		// clears the mocks or dispatches onInstalled.
		loadReloadCalls = reloadMock.mock.calls.slice();
		loadEnableCalls = enableMock.mock.calls.slice();
		loadDisableCalls = disableMock.mock.calls.slice();
	});

	it('does NOT call tabs.reload at load time, even though tabs.query resolved a new-tab-page tab', () => {
		// This is the regression under test: under MV3 the top-level sweep
		// re-runs on every event-page respawn. If the reload branch were
		// still top-level, this would already have reloaded newTabPageTab.
		expect(loadReloadCalls).toEqual([]);
	});

	it('enables the action for the http tab and disables it for the non-http tab, but skips the new-tab-page tab entirely, at load time', () => {
		expect(loadEnableCalls).toEqual([[httpTab.id]]);
		expect(loadDisableCalls).toEqual([[aboutTab.id]]);
	});

	it('dispatching runtime.onInstalled reloads exactly the new-tab-page tabs, and nothing else', async () => {
		reloadMock.mockClear();
		tabsQueryMock.mockResolvedValueOnce([httpTab, newTabPageTab, aboutTab]);

		onInstalledListener();
		await Promise.resolve();
		await Promise.resolve();

		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(reloadMock).toHaveBeenCalledWith(newTabPageTab.id);
	});

	it('onInstalled sweep does not reload non-new-tab tabs', async () => {
		reloadMock.mockClear();
		tabsQueryMock.mockResolvedValueOnce([httpTab, aboutTab]);

		onInstalledListener();
		await Promise.resolve();
		await Promise.resolve();

		expect(reloadMock).not.toHaveBeenCalled();
	});
});
