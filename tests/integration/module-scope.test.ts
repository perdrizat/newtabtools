/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * THE load-bearing module-scope regression test (MODERNIZATION.md, slices
 * M1 → M5; chrome-prep C3d retires the last survivors).
 *
 * M1's premise: with the background flipped to `{"scripts":
 * ["lib/background-main.js"], "type": "module"}`, every file
 * `background-main.js` side-effect-imports loads as a real ES module. In
 * module scope, top-level `var X = …` / `function X() {}` declarations
 * create bindings local to that module's scope — they do NOT attach to
 * `globalThis`, unlike the exact same syntax in a classic script. A file that
 * still used bare `var`/`function` for a cross-file symbol would pass every
 * vm-loaded test while being silently broken in production.
 *
 * M5 dissolves the former background.js entirely: its message dispatch moved
 * to lib/messages.js (real module, real imports of Tiles/Background/
 * withStore/the capture pipeline/makeZip/readZip) and every listener
 * registration moved into lib/background-main.js itself (also real imports).
 * NONE of those M2/M3/M4 `globalThis` bridge assignments
 * (`withStore`/`SAFE_PROTOCOLS`/`Tiles`/`Background`/the capture-pipeline
 * exports/`makeZip`/`readZip`) exist anymore — every consumer reaches them
 * via real `import` bindings instead.
 *
 * The Decision-2 dual-scope bridge (`Prefs`/`Blocked`/`Filters`/
 * `NeverCapture` from prefs.js; `compareVersions` from common.js) was
 * expected to survive PERMANENTLY, since the page read it as a classic
 * `<script>` global. chrome-prep C3d (CHROME_PREP.md maintainer directive 1)
 * retires it too: newTab.js/site.js/grid.js/awesomebar.js now import these for
 * real, so this file's job flips fully to negative assertions — prove every
 * bridge, Decision-2 survivors included, is actually gone from `globalThis`.
 *
 * This natively `import()`s lib/background-main.js — the manifest's actual
 * background entry — with the browser/chrome surface it touches at its own
 * top level mocked just enough that import doesn't throw (no listener body
 * is invoked; only registration + the top-level `Prefs.init()` chain runs).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { Prefs, Blocked, Filters, NeverCapture } from '../../webextension/prefs.js';
import { compareVersions } from '../../webextension/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const EXTENSION_ID = 'newtabtools@symlink.ch';

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// ---------------------------------------------------------------------------
// Lazy-loaded lib/backup.js (code-review audit, 2026-07-09, adjudicated):
// lib/messages.js no longer has a static `import ... from './backup.js'` —
// its 'Export:backup'/'Import:restore' cases each do a dynamic
// `import('./backup.js')` instead, so backup.js's own import graph (the
// vendored ~25-file `lib/zip/**` ESM tree) is no longer parsed on every
// event-page respawn, only when a backup/restore actually happens. Mocking
// the module (mirroring backup-restore.test.ts's convention) lets this file
// observe WHEN the module factory actually runs — not just whether
// makeZip/readZip get called — which is what distinguishes "not in the
// static graph" from "in the graph but its exports happen not to be called".
// ---------------------------------------------------------------------------
const backupModuleState = vi.hoisted(() => ({ loadCount: 0 }));
const mockMakeZip = vi.hoisted(() => vi.fn().mockResolvedValue(42));
const mockReadZip = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../webextension/lib/backup.js', () => {
	backupModuleState.loadCount++;
	return { makeZip: mockMakeZip, readZip: mockReadZip };
});

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock — auto-resolves indexedDB.open() on a
// microtask (crib: tests/integration/event-page-resilience.test.ts). Nothing
// in this file dispatches a message or navigation event that would actually
// touch a store, but lib/db.js is in the import graph (via lib/messages.js),
// so `indexedDB` must at least exist and be well-behaved if anything lazily
// probes it.
// ---------------------------------------------------------------------------

function installAutoResolvingIndexedDB() {
	const mockDB: Record<string, unknown> = {
		objectStoreNames: { contains: () => true },
		createObjectStore: () => ({ createIndex: () => {} }),
		close: () => {},
		transaction: () => ({
			objectStore: () => ({
				getAll: () => ({ onsuccess: null }),
			}),
		}),
	};
	const openMock = vi.fn(() => {
		const handlers: Record<string, Function> = {};
		const req: Record<string, unknown> = {};
		for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
			Object.defineProperty(req, prop, {
				set(cb: Function) { handlers[prop] = cb; },
				configurable: true,
			});
		}
		Promise.resolve().then(() => {
			handlers.onsuccess && handlers.onsuccess.call({ result: mockDB });
		});
		return req;
	});
	(globalThis as any).indexedDB = { open: openMock };
}

describe('module-scope bridge — lib/background-main.js\'s globalThis surface after M5', () => {
	beforeAll(async () => {
		installAutoResolvingIndexedDB();
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		// --- Browser / Chrome API gaps (crib: event-page-resilience.test.ts) ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn((p: string) => `moz-extension://test-uuid/${p}`);
		(globalThis as any).chrome.management = { getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }) };
		// browser.menus (create/update/refresh/onShown/onClicked) is now a
		// shared mock in tests/setup.js, covering this file's and
		// page-module-scope.test.ts's needs (code review,
		// 2026-07-10-page-modules-p1-code-review.md finding 7).
		(globalThis as any).chrome.idle = { onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.webNavigation = { onCompleted: { addListener: vi.fn() } };
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };
		(globalThis as any).browser.runtime.onInstalled = { addListener: vi.fn() };
		(globalThis as any).browser.runtime.onStartup = { addListener: vi.fn() };
		(globalThis as any).chrome.storage.local = {
			get: vi.fn().mockResolvedValue({ thumbnailSize: 600 }),
			set: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage.onChanged = { addListener: vi.fn() };

		// --- Native import() of the manifest's real background entry ---
		await import(/* @vite-ignore */ webext('lib/background-main.js'));

		// Flush the top-level Prefs.init() chain. `Prefs` is now a real,
		// statically-imported binding (no globalThis bridge survives to read
		// it off) — the object itself is available synchronously on import;
		// this waits on its `init`-populated shape as the settle signal.
		await vi.waitFor(() => expect(typeof Prefs.init).toBe('function'));
	});

	// ------------------------------------------------------------------
	// Decision-2 dual-scope bridge — retired as of chrome-prep C3d. Real
	// imports (above) are the only way anything reaches these now; verify
	// the objects themselves still have their expected shape...
	// ------------------------------------------------------------------
	it('prefs.js/common.js export Prefs/Blocked/Filters/NeverCapture/compareVersions with their expected shape', () => {
		expect(typeof compareVersions).toBe('function');
		expect(typeof Prefs.init).toBe('function');
		expect(typeof Blocked.isBlocked).toBe('function');
		expect(typeof Filters.getList).toBe('function');
		expect(typeof NeverCapture.matches).toBe('function');
	});

	// ...and that NONE of them ever leak onto globalThis anymore (the
	// chrome-prep C3d retirement itself).
	it('does NOT bridge globalThis.compareVersions', () => {
		expect((globalThis as any).compareVersions).toBeUndefined();
	});

	it('does NOT bridge globalThis.Prefs', () => {
		expect((globalThis as any).Prefs).toBeUndefined();
	});

	it('does NOT bridge globalThis.Blocked', () => {
		expect((globalThis as any).Blocked).toBeUndefined();
	});

	it('does NOT bridge globalThis.Filters', () => {
		expect((globalThis as any).Filters).toBeUndefined();
	});

	it('does NOT bridge globalThis.NeverCapture', () => {
		expect((globalThis as any).NeverCapture).toBeUndefined();
	});

	// ------------------------------------------------------------------
	// Retired M2/M3/M4 bridges (MODERNIZATION.md M5) — must NOT leak.
	// Every consumer now reaches these via a real `import` instead.
	// ------------------------------------------------------------------
	it('does NOT bridge globalThis.Tiles (real import in lib/messages.js / lib/background-main.js now)', () => {
		expect((globalThis as any).Tiles).toBeUndefined();
	});

	it('does NOT bridge globalThis.Background', () => {
		expect((globalThis as any).Background).toBeUndefined();
	});

	it('does NOT bridge globalThis.withStore', () => {
		expect((globalThis as any).withStore).toBeUndefined();
	});

	it('does NOT bridge globalThis.SAFE_PROTOCOLS', () => {
		expect((globalThis as any).SAFE_PROTOCOLS).toBeUndefined();
	});

	it('does NOT bridge globalThis.getTZDateString', () => {
		expect((globalThis as any).getTZDateString).toBeUndefined();
	});

	it('does NOT bridge globalThis.resetNetworkIdleTimer / disarmNetworkIdle', () => {
		expect((globalThis as any).resetNetworkIdleTimer).toBeUndefined();
		expect((globalThis as any).disarmNetworkIdle).toBeUndefined();
	});

	it('does NOT bridge globalThis.startCaptureSession / removeCaptureSession', () => {
		expect((globalThis as any).startCaptureSession).toBeUndefined();
		expect((globalThis as any).removeCaptureSession).toBeUndefined();
	});

	it('does NOT bridge globalThis.addPendingCapture / takePendingCapture / removePendingCapture', () => {
		expect((globalThis as any).addPendingCapture).toBeUndefined();
		expect((globalThis as any).takePendingCapture).toBeUndefined();
		expect((globalThis as any).removePendingCapture).toBeUndefined();
	});

	it('does NOT bridge globalThis.purgeNeverCaptureHost', () => {
		expect((globalThis as any).purgeNeverCaptureHost).toBeUndefined();
	});

	it('does NOT bridge globalThis.makeZip / readZip', () => {
		expect((globalThis as any).makeZip).toBeUndefined();
		expect((globalThis as any).readZip).toBeUndefined();
	});

	// ------------------------------------------------------------------
	// lib/backup.js is a STATIC import of lib/messages.js: dynamic import()
	// is spec-disallowed in service workers (w3c/ServiceWorker#1356), so the
	// former lazy-load design (2026-07-09) could never dispatch
	// Export:backup/Import:restore on Chrome.
	// ------------------------------------------------------------------
	describe('lib/backup.js is statically imported (no dynamic import in the background graph)', () => {
		it('IS loaded by importing background-main.js (part of the settled static graph)', () => {
			expect(backupModuleState.loadCount).toBe(1);
			expect(mockMakeZip).not.toHaveBeenCalled();
			expect(mockReadZip).not.toHaveBeenCalled();
		});

		it('round-trips when Export:backup is dispatched, with no further module load', async () => {
			const { handleMessage } = await import('../../webextension/lib/messages.js');
			const sendResponse = vi.fn();

			const result = handleMessage(
				{ name: 'Export:backup' },
				{ id: EXTENSION_ID },
				sendResponse,
			);

			expect(result).toBe(true);
			await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(42));
			expect(backupModuleState.loadCount).toBe(1);
			expect(mockMakeZip).toHaveBeenCalledTimes(1);
		});
	});
});
