/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: startup tab sweep (MV3 migration regression, UAT finding
 * 2026-07-09, see MV3_MIGRATION.md; reworked again for MODERNIZATION.md's
 * folded-in MV3 review §3.1, Stage M slice M5).
 *
 * Under MV2 (persistent background) the top-level `browser.tabs.query({})`
 * sweep in background.js ran exactly once per browser session, so its
 * "reload stale new-tab pages" branch was a harmless one-shot. Under MV3
 * the background is an event page whose top-level code re-runs on every
 * respawn (~30s idle cycle) — so a top-level reload sweep reloaded the
 * user's open new-tab pages continuously (observed 4x in one UAT scenario,
 * destroying the open drawer/edit-mode state). The pre-§3.1 fix moved only
 * the RELOAD branch into `runtime.onInstalled`, keeping a harmless top-level
 * per-respawn action-button enable/disable sweep.
 *
 * §3.1 goes further: per-tab action state (enabled/disabled) persists for
 * the whole browser session once set, independent of the event page
 * suspending/respawning — so even the "harmless" per-respawn sweep is
 * unnecessary work every ~30s. lib/background-main.js now has NO top-level
 * `tabs.query` sweep of any kind. Instead, a seed sweep
 * (`seedActionSweep()`) runs from THREE places: `runtime.onInstalled`
 * (alongside the pre-existing reload-stale-pages behavior), `runtime.onStartup`
 * (covering a full browser restart with no install/update, so `onInstalled`
 * never fires), and — per the 2026-07-09 code-review audit's finding #1 — a
 * `browser.storage.session`-backed once-per-session seed that also self-heals
 * after an extension disable→re-enable from about:addons, which fires NEITHER
 * `onInstalled` NOR `onStartup` but still resets every open tab's per-tab
 * action state to Firefox's default (enabled). `storage.session` is cleared by
 * exactly the two events that reset that per-tab state (a full browser
 * restart, and a disable→re-enable), so a flag there lets the first wake of a
 * session reseed the sweep once, and every later respawn in that same session
 * skip it (cheap `storage.session.get()` only). Between all of these,
 * per-navigation maintenance in the (unchanged) `webNavigation.onCompleted`
 * listener keeps each tab's action state current as the user navigates.
 *
 * MODERNIZATION.md slice M5 dissolves the former webextension/background.js;
 * this natively imports the real lib/background-main.js entry point instead
 * of vm-loading background.js.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const EXTENSION_ID = 'newtabtools@symlink.ch';
const NEW_TAB_URL = 'moz-extension://test-uuid/newTab.html';

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

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

describe('lib/background-main.js — startup tab sweep (§3.1: onInstalled + onStartup seed, no per-respawn sweep)', () => {
	let onInstalledListener: Function;
	let onStartupListener: Function;
	let tabsQueryMock: ReturnType<typeof vi.fn>;
	let reloadMock: ReturnType<typeof vi.fn>;
	let enableMock: ReturnType<typeof vi.fn>;
	let disableMock: ReturnType<typeof vi.fn>;

	const httpTab = { id: 1, url: 'https://example.com/' };
	const newTabPageTab = { id: 2, url: NEW_TAB_URL };
	const aboutTab = { id: 3, url: 'about:preferences' };

	beforeAll(async () => {
		// --- Mock DB (IndexedDB) — background-main.js's idle listener holds a
		// reference to withStore(); nothing in this file dispatches a message
		// that would touch it, but the module graph resolving cleanly requires
		// `indexedDB` to at least exist. ---
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

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn(() => NEW_TAB_URL);
		(globalThis as any).chrome.management = { getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }) };
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
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({});
		(globalThis as any).chrome.i18n.getMessage = vi.fn((k: string) => k);
		(globalThis as any).chrome.permissions.contains = vi.fn().mockResolvedValue(true);

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
		(globalThis as any).browser.runtime.onStartup = { addListener: vi.fn() };

		// --- Native import() of the real background entry point ---
		await import(/* @vite-ignore */ webext('lib/background-main.js'));

		// Flush microtasks so the top-level Prefs.init() chain resolves.
		await new Promise(resolve => setTimeout(resolve, 0));
		await new Promise(resolve => setTimeout(resolve, 0));
		await new Promise(resolve => setTimeout(resolve, 0));

		// --- Capture the runtime.onInstalled / runtime.onStartup listeners ---
		const installedCalls = (globalThis as any).browser.runtime.onInstalled.addListener.mock.calls;
		expect(installedCalls.length).toBe(1);
		onInstalledListener = installedCalls[0][0] as Function;

		const startupCalls = (globalThis as any).browser.runtime.onStartup.addListener.mock.calls;
		expect(startupCalls.length).toBe(1);
		onStartupListener = startupCalls[0][0] as Function;
	});

	it('does NOT reload any tab at plain import time — §3.1 removes the per-respawn top-level RELOAD sweep entirely', () => {
		// The session-seed (finding #1, below) DOES run the action-button sweep
		// at import time when the storage.session flag is unset (the common
		// first-wake-of-a-session case, which this fresh test file's freshly-
		// empty mock store always is) — but it must never reload any tab; only
		// `runtime.onInstalled` does that.
		expect(reloadMock).not.toHaveBeenCalled();
	});

	describe('session-seed at wake (audit finding #1, 2026-07-09 code review)', () => {
		it('runs the action sweep exactly once at the first wake of a session (storage.session flag unset), and marks the flag', () => {
			// Observed straight out of beforeAll's import + microtask flush,
			// before any other test has cleared these mocks — this is the
			// first-wake-with-flag-unset case (a freshly-empty
			// browser.storage.session, per this test file's own mock instance).
			expect(tabsQueryMock).toHaveBeenCalledTimes(1);
			expect(enableMock).toHaveBeenCalledWith(httpTab.id);
			expect(disableMock).toHaveBeenCalledWith(aboutTab.id);
			expect(enableMock).not.toHaveBeenCalledWith(newTabPageTab.id);
			expect(disableMock).not.toHaveBeenCalledWith(newTabPageTab.id);
			expect((globalThis as any).browser.storage.session.set)
				.toHaveBeenCalledWith({ actionSeeded: true });
		});
	});

	describe('runtime.onInstalled dispatch', () => {
		it('reloads exactly the new-tab-page tabs, and nothing else', async () => {
			reloadMock.mockClear();
			tabsQueryMock.mockClear();
			tabsQueryMock.mockResolvedValue([httpTab, newTabPageTab, aboutTab]);

			onInstalledListener();
			await Promise.resolve();
			await Promise.resolve();

			expect(reloadMock).toHaveBeenCalledTimes(1);
			expect(reloadMock).toHaveBeenCalledWith(newTabPageTab.id);
		});

		it('does not reload non-new-tab tabs', async () => {
			reloadMock.mockClear();
			tabsQueryMock.mockClear();
			tabsQueryMock.mockResolvedValue([httpTab, aboutTab]);

			onInstalledListener();
			await Promise.resolve();
			await Promise.resolve();

			expect(reloadMock).not.toHaveBeenCalled();
		});

		it('also seeds the action-button sweep: enables http tabs, disables non-http tabs, skips new-tab-page tabs entirely', async () => {
			enableMock.mockClear();
			disableMock.mockClear();
			tabsQueryMock.mockClear();
			tabsQueryMock.mockResolvedValue([httpTab, newTabPageTab, aboutTab]);

			onInstalledListener();
			await vi.waitFor(() => expect(enableMock).toHaveBeenCalled());

			expect(enableMock).toHaveBeenCalledWith(httpTab.id);
			expect(disableMock).toHaveBeenCalledWith(aboutTab.id);
			expect(enableMock).not.toHaveBeenCalledWith(newTabPageTab.id);
			expect(disableMock).not.toHaveBeenCalledWith(newTabPageTab.id);
		});
	});

	describe('runtime.onStartup dispatch', () => {
		it('seeds the action-button sweep (enable/disable), but never reloads any tab', async () => {
			reloadMock.mockClear();
			enableMock.mockClear();
			disableMock.mockClear();
			tabsQueryMock.mockClear();
			tabsQueryMock.mockResolvedValue([httpTab, newTabPageTab, aboutTab]);

			onStartupListener();
			await vi.waitFor(() => expect(enableMock).toHaveBeenCalled());

			expect(enableMock).toHaveBeenCalledWith(httpTab.id);
			expect(disableMock).toHaveBeenCalledWith(aboutTab.id);
			expect(reloadMock).not.toHaveBeenCalled();
		});
	});

	describe('session-seed at a LATER wake in the same session (audit finding #1)', () => {
		it('does NOT run the sweep again once the storage.session flag is already set', async () => {
			// Pre-seed the flag, as if an earlier wake in this same browser
			// session already ran the seed and set it.
			await (globalThis as any).browser.storage.session.set({ actionSeeded: true });

			tabsQueryMock.mockClear();
			enableMock.mockClear();
			disableMock.mockClear();
			reloadMock.mockClear();
			((globalThis as any).browser.storage.session.set as ReturnType<typeof vi.fn>).mockClear();
			tabsQueryMock.mockResolvedValue([httpTab, newTabPageTab, aboutTab]);

			// Simulate a fresh event-page respawn: force the whole module graph
			// to re-evaluate from scratch (a real respawn re-runs every
			// top-level statement in it), then re-import the real background
			// entry point — this is the "later wake" the flag is meant to skip.
			vi.resetModules();
			await import(/* @vite-ignore */ webext('lib/background-main.js'));
			await new Promise(resolve => setTimeout(resolve, 0));
			await new Promise(resolve => setTimeout(resolve, 0));
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(tabsQueryMock).not.toHaveBeenCalled();
			expect(enableMock).not.toHaveBeenCalled();
			expect(disableMock).not.toHaveBeenCalled();
			expect(reloadMock).not.toHaveBeenCalled();
			expect((globalThis as any).browser.storage.session.set).not.toHaveBeenCalled();
		});
	});
});
