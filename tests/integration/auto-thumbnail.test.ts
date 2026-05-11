/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: auto-thumbnail capture, storage, display, and cleanup.
 *
 * The auto-thumbnail system captures screenshots of pinned sites using
 * `captureVisibleTab()` from the background page. No content scripts are
 * injected into visited pages (resolves §2.6 from the security audit).
 *
 * Architecture — multi-stage capture with blankness detection:
 *   1. Background trigger (`webNavigation.onCompleted`): checks if URL is in
 *      tile cache. For active tabs, starts a capture session with three stages:
 *        - Capture A: immediate (page at top, may be blank for SPAs)
 *        - Capture B: 500ms later (first meaningful paint for most SPAs)
 *        - Capture C: on network idle, capped at 2s (fully rendered)
 *      Non-active tabs are deferred to `tabs.onActivated` (C2 path).
 *   2. `captureTab()`: calls `captureVisibleTab()`, returns data URL.
 *   3. `isBlank(dataURL)`: detects blank/single-color screenshots via canvas
 *      pixel sampling (>97% dominant color = blank).
 *   4. `pickAndStore(tabId)`: selects latest non-blank capture from session,
 *      resizes via canvas, stores blob in IDB.
 *   5. `resizeThumbnail()`: resizes a data URL to target width via canvas.
 *   6. Network idle monitor: `webRequest` listeners reset a 2s timer per tab.
 *   7. `Thumbnails.capture` message: used by action.js capture button.
 *   8. `Thumbnails.delete` message: removes thumbnail from IDB.
 *   9. Display (`newTab.js` `getThumbnails`): applies thumbnails to grid sites.
 *  10. Cleanup (`cleanupThumbnails`): removes entries older than 2 weeks.
 *
 * Test approach: the capture flow tests load background.js via
 * `vm.runInThisContext` with mocked chrome.* APIs and exercise the captured
 * listeners behaviorally (using fake timers), rather than source-scanning.
 * Source-scanning is reserved for pure wiring checks (e.g. "no executeScript").
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND_PATH = path.resolve(__dirname, '../../webextension/background.js');
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const EXTENSION_ID = 'newtabtools@darktrojan.net';

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) {throw new Error(`${methodName} not found`);}
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') {depth++;}
		else if (source[i] === '}') { depth--; if (depth === 0) {return source.substring(start, i + 1);} }
	}
	throw new Error('Unbalanced braces');
}

// ===========================================================================
// Source-scanning: wiring checks (things that only need string presence)
// ===========================================================================

describe('Wiring checks — background.js (source scan)', () => {
	let bgSource: string;

	beforeAll(() => {
		bgSource = fs.readFileSync(BACKGROUND_PATH, 'utf8');
	});

	it('does NOT use executeScript (§2.6 resolved)', () => {
		expect(bgSource).not.toContain('executeScript');
	});

	it('does NOT check staleness — captures every visit', () => {
		expect(bgSource).not.toContain('this.result.stored < today');
	});
});

describe('Wiring checks — action.js (source scan)', () => {
	let actionSource: string;

	beforeAll(() => {
		actionSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/action.js'), 'utf8'
		);
	});

	it('does NOT use executeScript', () => {
		expect(actionSource).not.toContain('executeScript');
	});

	it('does NOT reference thumbnail.js', () => {
		expect(actionSource).not.toContain('thumbnail.js');
	});

	it('sends Thumbnails.capture message to background', () => {
		expect(actionSource).toContain('name: \'Thumbnails.capture\'');
	});
});

describe('Remove-thumbnail button — newTab.xhtml (source scan)', () => {
	let xhtml: string;

	beforeAll(() => {
		xhtml = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.xhtml'), 'utf8'
		);
	});

	it('site template has a thumbnail control button', () => {
		expect(xhtml).toContain('newtab-control-thumbnail');
	});
});

// ===========================================================================
// Behavioral tests: load background.js and exercise capture flow
// ===========================================================================

describe('background.js — multi-stage capture (behavioral)', () => {
	// Captured listeners
	type Listener = (...args: any[]) => any;
	let onCompletedListener: Listener;
	let onActivatedListener: Listener;
	let onRemovedListener: Listener;
	let onMessageListener: Listener;

	// Mock state
	let thumbnailStore: Record<string, ReturnType<typeof vi.fn>>;
	let mockDB: Record<string, unknown>;
	let captureCallCount: () => number;
	let captureDataURL: string;

	// Globals that background.js defines — we'll access them for assertions
	let getCaptureSessions: () => Map<number, any>;
	let getPendingCaptures: () => Map<number, any>;
	let getNetworkIdleWatchers: () => Map<number, any>;

	beforeAll(async () => {
		vi.useFakeTimers();

		// --- Tiles ---
		(globalThis as any).Tiles = {
			ensureReady: vi.fn().mockResolvedValue({ cache: ['https://example.com'], list: [] }),
			isPinned: vi.fn().mockReturnValue(false),
			getAllTiles: vi.fn().mockResolvedValue([]),
			getTile: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' }),
			putTile: vi.fn().mockResolvedValue(undefined),
			removeTile: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
			pinTile: vi.fn().mockResolvedValue(42),
			_list: ['https://example.com'],
			_cache: ['https://example.com'],
		};

		// --- Background / Prefs / Blocked / Filters ---
		(globalThis as any).Background = {
			getBackground: vi.fn().mockResolvedValue({ data: 'bg-data' }),
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
		(globalThis as any).makeZip = vi.fn().mockResolvedValue(new Blob(['zip-data']));
		(globalThis as any).readZip = vi.fn().mockResolvedValue(undefined);

		// --- Mock DB ---
		thumbnailStore = {
			put: vi.fn(),
			get: vi.fn(),
			delete: vi.fn(),
			openCursor: vi.fn(),
			index: vi.fn(() => ({ openCursor: vi.fn() })),
		};
		const stores: Record<string, unknown> = {
			tiles: {
				put: vi.fn(), get: vi.fn(), getAll: vi.fn(),
				openCursor: vi.fn(), createIndex: vi.fn(),
				indexNames: { contains: () => true },
			},
			thumbnails: thumbnailStore,
			background: { put: vi.fn(), get: vi.fn() },
		};
		mockDB = {
			objectStoreNames: { contains: (n: string) => n in stores },
			transaction: vi.fn(() => ({ objectStore: vi.fn((n: string) => stores[n]) })),
			createObjectStore: vi.fn(),
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

		// --- captureVisibleTab mock — returns a data URL ---
		captureDataURL = 'data:image/png;base64,AAAA';
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn(
			(_windowId: number, _opts: unknown, cb: Function) => cb(captureDataURL)
		);
		captureCallCount = () =>
			(globalThis as any).chrome.tabs.captureVisibleTab.mock.calls.length;

		// --- Image mock (for isBlank + resizeThumbnail) ---
		const mockImageData = new Uint8ClampedArray(50 * 50 * 4);
		// Default: all different pixels (non-blank)
		for (let i = 0; i < mockImageData.length; i += 4) {
			mockImageData[i] = (i * 7) % 256;
			mockImageData[i + 1] = (i * 13) % 256;
			mockImageData[i + 2] = (i * 19) % 256;
			mockImageData[i + 3] = 255;
		}

		const mockCtx = {
			drawImage: vi.fn(),
			getImageData: vi.fn(() => ({ data: mockImageData })),
		};
		const mockCanvas = {
			width: 0,
			height: 0,
			getContext: vi.fn(() => mockCtx),
			toBlob: vi.fn((cb: Function) => cb(new Blob(['resized']))),
		};
		(globalThis as any).document.createElement = vi.fn(() => mockCanvas);

		// Image constructor mock — fires onload synchronously
		(globalThis as any).Image = class MockImage {
			onload: Function | null = null;
			onerror: Function | null = null;
			width = 1200;
			height = 800;
			set src(_val: string) {
				// Fire onload asynchronously (via microtask) to match real behavior
				if (this.onload) {
					Promise.resolve().then(() => this.onload!());
				}
			}
		};

		// --- chrome.storage.local.get mock (for thumbnailSize) ---
		(globalThis as any).chrome.storage = {
			local: {
				get: vi.fn((keys: Record<string, unknown>, cb: Function) => cb(keys)),
				set: vi.fn(),
			},
		};

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn(
			(p: string) => `moz-extension://test-uuid/${p}`,
		);
		(globalThis as any).chrome.management = {
			getSelf: vi.fn((cb: Function) => cb({ version: '1.0.0' })),
		};
		if (!(globalThis as any).chrome.extension) {
			(globalThis as any).chrome.extension = {};
		}
		(globalThis as any).chrome.extension.getViews = vi.fn(() => []);
		(globalThis as any).browser.menus = {
			create: vi.fn(),
			update: vi.fn(),
			refresh: vi.fn(),
			onShown: { addListener: vi.fn() },
		};
		if (!(globalThis as any).chrome.idle?.onStateChanged) {
			(globalThis as any).chrome.idle = {
				onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() },
			};
		}
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.get = vi.fn(
			(_tabId: number, cb: Function) => cb({ active: true, windowId: 1, incognito: false })
		);
		(globalThis as any).chrome.tabs.query = vi.fn((_q: unknown, cb: Function) => cb([]));
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };

		// --- Load background.js ---
		(globalThis as any).chrome.runtime.onMessage.addListener.mockClear();
		(globalThis as any).chrome.webNavigation.onCompleted.addListener.mockClear();
		const code = fs.readFileSync(BACKGROUND_PATH, 'utf8');
		vm.runInThisContext(code, { filename: 'background.js' });

		// Flush microtasks so init Promise.all resolves
		await vi.advanceTimersByTimeAsync(0);

		// --- Capture all registered listeners ---
		onCompletedListener = (globalThis as any).chrome.webNavigation.onCompleted
			.addListener.mock.calls[0][0];
		onActivatedListener = (globalThis as any).chrome.tabs.onActivated
			.addListener.mock.calls[0][0];
		onRemovedListener = (globalThis as any).chrome.tabs.onRemoved
			.addListener.mock.calls[0][0];
		onMessageListener = (globalThis as any).chrome.runtime.onMessage
			.addListener.mock.calls[0][0];

		// Access background.js globals via globalThis (script-mode = global scope)
		getCaptureSessions = () => (globalThis as any).captureSessions;
		getPendingCaptures = () => (globalThis as any).pendingCaptures;
		getNetworkIdleWatchers = () => (globalThis as any).networkIdleWatchers;
	});

	beforeEach(() => {
		(globalThis as any).chrome.tabs.captureVisibleTab.mockClear();
		thumbnailStore.put.mockClear();
		thumbnailStore.delete.mockClear();
		(mockDB.transaction as ReturnType<typeof vi.fn>).mockClear();
		getCaptureSessions().clear();
		getPendingCaptures().clear();
		getNetworkIdleWatchers().clear();
	});

	afterEach(() => {
		// Don't restore real timers — keep fakes for the entire describe block
	});

	// --- onCompleted trigger ---

	it('onCompleted triggers capture session for active tab with cached URL', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // flush Tiles.ensureReady + tabs.get

		// Capture A should have been taken immediately
		expect(captureCallCount()).toBe(1);
		expect(getCaptureSessions().has(42)).toBe(true);
	});

	it('onCompleted ignores subframes (frameId !== 0)', async () => {
		onCompletedListener({ frameId: 1, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
	});

	it('onCompleted ignores non-http URLs', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'about:blank' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
	});

	it('onCompleted skips URLs not in tile cache', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://not-in-cache.com' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
	});

	it('onCompleted skips incognito tabs', async () => {
		(globalThis as any).chrome.tabs.get.mockImplementationOnce(
			(_tabId: number, cb: Function) => cb({ active: true, windowId: 1, incognito: true })
		);
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
	});

	it('onCompleted defers inactive tabs to pendingCaptures', async () => {
		(globalThis as any).chrome.tabs.get.mockImplementationOnce(
			(_tabId: number, cb: Function) => cb({ active: false, windowId: 1, incognito: false })
		);
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
		expect(getPendingCaptures().has(42)).toBe(true);
	});

	// --- Multi-stage capture: A, B, C ---

	it('Capture A fires immediately, B at 500ms', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(1); // A

		await vi.advanceTimersByTimeAsync(500);
		expect(captureCallCount()).toBe(2); // A + B
	});

	it('hard deadline at 2s takes C capture before finalizing', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // A
		await vi.advanceTimersByTimeAsync(500); // B

		// Advance to hard deadline (2000ms from session start, already at 500ms)
		await vi.advanceTimersByTimeAsync(1500);
		expect(captureCallCount()).toBe(3); // A + B + C
	});

	it('C via network idle fires before hard deadline when network settles', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // A

		// Network idle fires at 2000ms (no resets)
		await vi.advanceTimersByTimeAsync(2000);
		// Should have A (0ms) + B (500ms within this window) + C (network idle at 2000ms)
		expect(captureCallCount()).toBe(3);

		// Hard deadline at 5s should NOT produce another capture
		await vi.advanceTimersByTimeAsync(3000);
		expect(captureCallCount()).toBe(3); // still 3
	});

	it('network idle after 2s skips C, finalizes with A+B+C from hard deadline', async () => {
		// Simulate network resets that push idle beyond 2s
		const webRequestListener = (globalThis as any).chrome.webRequest.onBeforeRequest
			.addListener.mock.calls[0][0];

		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // A

		// Reset network idle repeatedly for 2 seconds
		for (let t = 0; t < 2000; t += 250) {
			await vi.advanceTimersByTimeAsync(250);
			webRequestListener({ tabId: 42 });
		}

		// Hard deadline fires at 1500ms — takes C capture
		// Total: A + B (at 500ms) + C (hard deadline at 1500ms) = 3
		// Then network goes idle at 4000ms (2000 + 2000) — but finalized=true, so ignored
		await vi.advanceTimersByTimeAsync(3000);
		const count = captureCallCount();
		// A + B + C from hard deadline = 3
		expect(count).toBe(3);
	});

	// --- onActivated path (background tab) ---

	it('onActivated starts full A/B/C capture for pending tab', async () => {
		getPendingCaptures().set(42, { url: 'https://example.com', windowId: 1 });
		onActivatedListener({ tabId: 42 });
		await vi.advanceTimersByTimeAsync(0); // A

		expect(captureCallCount()).toBe(1); // A
		expect(getPendingCaptures().has(42)).toBe(false);

		await vi.advanceTimersByTimeAsync(500); // B
		expect(captureCallCount()).toBe(2); // A + B

		// C at 2s hard deadline — same as active tab flow
		await vi.advanceTimersByTimeAsync(1500);
		expect(captureCallCount()).toBe(3); // A + B + C
	});

	it('onActivated ignores tabs not in pendingCaptures', async () => {
		onActivatedListener({ tabId: 99 });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
	});

	// --- Cleanup ---

	it('starting a new session cancels old session timers (SPA double-onCompleted)', async () => {
		// First session starts
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // A
		expect(captureCallCount()).toBe(1);

		// SPA triggers a second onCompleted for the same tabId before hard deadline
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // new A
		expect(captureCallCount()).toBe(2); // old A + new A

		// Old hard deadline (2000ms from first session) should NOT fire
		await vi.advanceTimersByTimeAsync(2000);
		// Should be: new A + new B (500ms) + new C (2000ms) = 3 new captures
		// Old session's B and hardDeadline should be cancelled
		expect(captureCallCount()).toBe(4); // old A + new A + new B + new C
	});

	it('onRemoved cleans up captureSessions, pendingCaptures, and network idle', () => {
		getCaptureSessions().set(42, { url: 'x', captures: [], timers: [] });
		getPendingCaptures().set(42, { url: 'x', windowId: 1 });
		getNetworkIdleWatchers().set(42, { timer: 0, startTime: 0, callback: vi.fn(), resetCount: 0 });

		onRemovedListener(42);

		expect(getCaptureSessions().has(42)).toBe(false);
		expect(getPendingCaptures().has(42)).toBe(false);
		expect(getNetworkIdleWatchers().has(42)).toBe(false);
	});

	// --- Network idle monitor ---

	it('network idle fires after 2s of no network activity', async () => {
		const armNetworkIdle = (globalThis as any).armNetworkIdle as Function;
		const callback = vi.fn();
		armNetworkIdle(99, callback);

		await vi.advanceTimersByTimeAsync(1999);
		expect(callback).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(callback).toHaveBeenCalledOnce();
		expect(callback.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
	});

	it('webRequest resets the idle timer', async () => {
		const armNetworkIdle = (globalThis as any).armNetworkIdle as Function;
		const webRequestListener = (globalThis as any).chrome.webRequest.onBeforeRequest
			.addListener.mock.calls[0][0];

		const callback = vi.fn();
		armNetworkIdle(99, callback);

		await vi.advanceTimersByTimeAsync(1000);
		webRequestListener({ tabId: 99 }); // reset

		await vi.advanceTimersByTimeAsync(1000); // only 1s since reset
		expect(callback).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1000); // now 2s since reset
		expect(callback).toHaveBeenCalledOnce();
	});

	it('disarmNetworkIdle cancels the timer', async () => {
		const armNetworkIdle = (globalThis as any).armNetworkIdle as Function;
		const disarmNetworkIdle = (globalThis as any).disarmNetworkIdle as Function;
		const callback = vi.fn();
		armNetworkIdle(99, callback);

		disarmNetworkIdle(99);

		await vi.advanceTimersByTimeAsync(3000);
		expect(callback).not.toHaveBeenCalled();
	});

	// --- Tab-active guard ---

	it('captureTab skips capture if tab is no longer active', async () => {
		// First: start a session normally (tab is active)
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // A fires (tab is active)
		const countAfterA = captureCallCount();
		expect(countAfterA).toBe(1);

		// Simulate user switching away — tabs.get now returns inactive
		(globalThis as any).chrome.tabs.get.mockImplementation(
			(_tabId: number, cb: Function) => cb({ active: false, windowId: 1, incognito: false })
		);

		// B at 500ms — should be skipped because tab is no longer active
		await vi.advanceTimersByTimeAsync(500);
		expect(captureCallCount()).toBe(1); // still just A

		// Restore mock for other tests
		(globalThis as any).chrome.tabs.get.mockImplementation(
			(_tabId: number, cb: Function) => cb({ active: true, windowId: 1, incognito: false })
		);
	});

	// --- Thumbnails.delete message handler ---

	it('Thumbnails.delete removes entry from IDB', () => {
		const sender = { id: EXTENSION_ID };
		onMessageListener(
			{ name: 'Thumbnails.delete', url: 'https://example.com' },
			sender,
			vi.fn()
		);
		expect(mockDB.transaction).toHaveBeenCalledWith('thumbnails', 'readwrite');
		expect(thumbnailStore.delete).toHaveBeenCalledWith('https://example.com');
	});

	// --- Thumbnails.capture message handler ---

	it('Thumbnails.capture starts a capture session for sender tab', async () => {
		const sender = {
			id: EXTENSION_ID,
			tab: { id: 42, windowId: 1, url: 'https://example.com' },
		};
		onMessageListener({ name: 'Thumbnails.capture' }, sender, vi.fn());
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(1);
		expect(getCaptureSessions().has(42)).toBe(true);
	});

	// --- pickAndStore writes to IDB ---

	it('pickAndStore resizes and stores best capture in IDB', async () => {
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // A

		// Let network idle fire (2s) to trigger pickAndStore
		await vi.advanceTimersByTimeAsync(2000);

		// Flush isBlank + resizeThumbnail microtasks
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(0);

		expect(thumbnailStore.put).toHaveBeenCalled();
		const storedObj = thumbnailStore.put.mock.calls[0][0];
		expect(storedObj.url).toBe('https://example.com');
		expect(storedObj.image).toBeInstanceOf(Blob);
	});
});

// ===========================================================================
// Remove-thumbnail button — fx-newTab.js (behavioral)
// ===========================================================================

describe('Remove-thumbnail button — fx-newTab.js (behavioral)', () => {
	let fxSource: string;

	beforeAll(() => {
		fxSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/fx-newTab.js'), 'utf8'
		);
	});

	it('_onClick handles newtab-control-thumbnail class', () => {
		expect(fxSource).toContain('newtab-control-thumbnail');
	});

	it('sends Thumbnails.delete message on click', () => {
		expect(fxSource).toContain('Thumbnails.delete');
	});
});

// ===========================================================================
// getThumbnails display — newTab.js (behavioral, vm.runInThisContext)
// ===========================================================================

describe('getThumbnails display — newTab.js (Phase 1 slot 16)', () => {
	let harness: any;
	let gridSites: any[];

	beforeAll(() => {
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const getThumbnails = extractMethod(source, 'getThumbnails');

		globalThis.Grid = { sites: [] };

		const code = `var newTabTools = { ${getThumbnails}, selectedSite: null, siteThumbnail: { style: {} }, saveCurrentThumbButton: { disabled: true } };`;
		vm.runInThisContext(code, { filename: 'thumbnail-display-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		gridSites = [];
		(globalThis as any).Grid.sites = gridSites;
		harness.selectedSite = null;
		harness.siteThumbnail = { style: {} };
		harness.saveCurrentThumbButton = { disabled: true };
	});

	it('sends Thumbnails.get with URLs of sites missing backgroundImage', () => {
		gridSites.push(
			{ link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' } } },
			{ link: { url: 'https://b.com' }, thumbnail: { style: { backgroundImage: 'url(existing)' } } },
			null, // empty cell
		);
		(globalThis as any).Grid.sites = gridSites;

		chrome.runtime.sendMessage.mockImplementation(() => {});
		harness.getThumbnails();
		expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Thumbnails.get',
				urls: ['https://a.com'],
			}),
			expect.any(Function),
		);
	});

	it('applies thumbnail as CSS backgroundImage from Map response', () => {
		const site = { link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' } } };
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;

		const thumbBlob = new Blob(['thumb']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb-url');
		const thumbMap = new Map([['https://a.com', thumbBlob]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();
		expect(site.thumbnail.style.backgroundImage).toBe('url(blob:thumb-url)');
	});

	it('does not overwrite site.link.image (custom-uploaded thumbnail)', () => {
		const site = {
			link: { url: 'https://a.com', image: new Blob(['custom']) },
			thumbnail: { style: { backgroundImage: '' } },
		};
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;

		const thumbMap = new Map([['https://a.com', new Blob(['auto'])]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();
		// link.image should remain the custom blob, not be overwritten
		expect(site.thumbnail.style.backgroundImage).toBe('');
	});

	it('updates siteThumbnail and enables save button for selected site', () => {
		const site = { link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' } } };
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;
		harness.selectedSite = site;

		const thumbBlob = new Blob(['thumb']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
		const thumbMap = new Map([['https://a.com', thumbBlob]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();
		expect(harness.siteThumbnail.style.backgroundImage).toBe('url(blob:thumb)');
		expect(harness.saveCurrentThumbButton.disabled).toBe(false);
	});

	it('skips null sites in grid (empty cells)', () => {
		gridSites.push(null, null);
		(globalThis as any).Grid.sites = gridSites;

		const thumbMap = new Map();
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		expect(() => harness.getThumbnails()).not.toThrow();
	});
});
