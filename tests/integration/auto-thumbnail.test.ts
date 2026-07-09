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
 * Test approach: the capture flow tests exercise the captured listeners
 * behaviorally (using fake timers), rather than source-scanning.
 * Source-scanning is reserved for pure wiring checks (e.g. "no executeScript").
 *
 * MODERNIZATION.md slice M3: the capture pipeline itself (session/network-
 * idle state, captureTab, pickAndStore, fetchFaviconBlob, pendingCaptures,
 * purgeNeverCaptureHost) now lives in lib/capture.js, and resizeThumbnail/
 * isBlank/dataURLtoBlob in lib/thumbnail-image.js — both real ES modules,
 * natively imported below. Direct-unit-style access to
 * armNetworkIdle/disarmNetworkIdle/captureTab goes through the native import
 * bindings. `captureSessions`/`networkIdleWatchers` are module-private in
 * lib/capture.js; `_captureSessionsForTests`/`_networkIdleWatchersForTests`
 * are the documented test-only escape hatches (same convention as
 * lib/db.js's `_resetForTests`).
 *
 * MODERNIZATION.md slice M5 dissolves the former webextension/background.js:
 * the webNavigation.onCompleted/tabs.onActivated/tabs.onRemoved LISTENERS now
 * live in lib/background-main.js's own top level, and the message dispatcher
 * is `handleMessage`, a real export of lib/messages.js. This file natively
 * `import()`s lib/background-main.js (capturing the three listeners from
 * their mocked `addListener` call args, same technique as before, just
 * pointed at the real entry point instead of a vm-loaded background.js) and
 * imports `handleMessage` directly for `onMessageListener` — no vm/global
 * indirection needed for either. `Tiles`/`Background` are the REAL
 * lib/tiles-store.js singletons (mutated via `Object.assign`, the same
 * pattern established in background-messages.test.ts) rather than a
 * `globalThis` bridge — there isn't one anymore. `Prefs`/`Blocked`/`Filters`/
 * `NeverCapture` are the REAL prefs.js objects too (created by
 * lib/background-main.js's own `import '../prefs.js'`): `NeverCapture._list`
 * is mutated directly in tests exactly as before, since the real object has
 * the identical shape the old hand-rolled mock had.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { _resetForTests } from '../../webextension/lib/db.js';
import {
	armNetworkIdle,
	disarmNetworkIdle,
	captureTab,
	_captureSessionsForTests,
	_networkIdleWatchersForTests,
} from '../../webextension/lib/capture.js';
import { Tiles, Background } from '../../webextension/lib/tiles-store.js';
import { handleMessage } from '../../webextension/lib/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const CAPTURE_PATH = path.resolve(__dirname, '../../webextension/lib/capture.js');
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const EXTENSION_ID = 'newtabtools@symlink.ch';

// Captured before any describe block overwrites `document.createElement`
// (the capture-pipeline suite below stubs it to always return a mock canvas,
// and that stub outlives its own describe block within this file) — the
// fallback-overlay test needs a *real* jsdom element.
const realCreateElement = document.createElement.bind(document);

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

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

describe('Wiring checks — lib/capture.js (source scan)', () => {
	let bgSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: deprecated API absence
		bgSource = fs.readFileSync(CAPTURE_PATH, 'utf8');
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
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: deprecated API absence
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

describe('Remove-thumbnail button — newTab.html (source scan)', () => {
	let xhtml: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: template structure
		xhtml = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/newTab.html'), 'utf8'
		);
	});

	it('site template has action buttons container for thumbnail actions', () => {
		expect(xhtml).toContain('ntt-actions');
	});
});

// ===========================================================================
// Behavioral tests: load background.js and exercise capture flow
// ===========================================================================

describe('lib/background-main.js — multi-stage capture (behavioral)', () => {
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

	// Globals that background.js used to define — we'll access them for assertions
	let getCaptureSessions: () => Map<number, any>;
	let getPendingCapturesObj: () => Record<string, any>;
	let getNetworkIdleWatchers: () => Map<number, any>;

	// Mocked browser.storage.session backing store — pendingCaptures (Slice B
	// of the MV3 migration) now lives here instead of an in-memory Map, since
	// it waits for tab activation (unbounded) and must survive an event-page
	// respawn. `chrome`/`browser` are the same object under jest-webextension-
	// mock, but the beforeAll below replaces `chrome.storage` wholesale (to
	// control `local` for thumbnailSize), so `session` is re-added here.
	let sessionStore: Record<string, unknown>;

	beforeAll(async () => {
		vi.useFakeTimers();

		// --- Tiles / Background: mutate the REAL singletons lib/messages.js /
		// lib/background-main.js import (there is no globalThis bridge to
		// replace anymore — see this file's header comment). ---
		Object.assign(Tiles, {
			ensureReady: vi.fn().mockResolvedValue({ cache: ['https://example.com'], list: [] }),
			isPinned: vi.fn().mockReturnValue(false),
			getGridTiles: vi.fn().mockResolvedValue([]),
			getTile: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' }),
			putTile: vi.fn().mockResolvedValue(undefined),
			removeTile: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
			pinTile: vi.fn().mockResolvedValue(42),
			_list: ['https://example.com'],
			_cache: ['https://example.com'],
		});
		Object.assign(Background, {
			getBackground: vi.fn().mockResolvedValue({ data: 'bg-data' }),
			setBackground: vi.fn().mockResolvedValue(undefined),
		});

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
			() => Promise.resolve(captureDataURL)
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

		// --- chrome.storage.local.get mock (for thumbnailSize, AND for the real
		// prefs.js's `Prefs.init()` no-argument `get()` call — background-main.js
		// side-effect-imports the real prefs.js now, M5) + browser.storage.session
		// mock ---
		sessionStore = {};
		(globalThis as any).chrome.storage = {
			local: {
				get: vi.fn((keys?: Record<string, unknown>) => Promise.resolve(keys || {})),
				set: vi.fn(() => Promise.resolve()),
				remove: vi.fn(() => Promise.resolve()),
			},
			session: {
				get: vi.fn((key: string) => {
					if (key in sessionStore) {
						return Promise.resolve({ [key]: sessionStore[key] });
					}
					return Promise.resolve({});
				}),
				set: vi.fn((obj: Record<string, unknown>) => {
					Object.assign(sessionStore, obj);
					return Promise.resolve();
				}),
				remove: vi.fn((key: string) => {
					delete sessionStore[key];
					return Promise.resolve();
				}),
			},
			onChanged: { addListener: vi.fn() },
		};

		// --- Browser / Chrome API gaps ---
		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn(
			(p: string) => `moz-extension://test-uuid/${p}`,
		);
		(globalThis as any).chrome.management = {
			getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }),
		};
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
			() => Promise.resolve({ active: true, windowId: 1, incognito: false })
		);
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n = { getMessage: vi.fn((k: string) => k) };
		// MV3: startCaptureSession() guards on the <all_urls> host permission
		// still being held (users can revoke it at runtime); the default
		// jest-webextension-mock `permissions.contains` is a bare `jest.fn()`
		// (resolves `undefined`, i.e. "not granted") — override to "granted" so
		// the existing capture-flow tests below exercise the granted path.
		// permission-revoked behavior is covered separately below.
		(globalThis as any).chrome.permissions = { contains: vi.fn().mockResolvedValue(true) };
		// MV3: chrome.browserAction -> browser.action (Slice D rename). The
		// mock's `action`/`browserAction` alias already exists, but its
		// `enable`/`disable` are bare `jest.fn()`s (resolve `undefined`) —
		// background.js now awaits/`.catch()`s these as real Promises.
		(globalThis as any).chrome.action = {
			enable: vi.fn().mockResolvedValue(undefined),
			disable: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).browser.runtime.onStartup = { addListener: vi.fn() };

		// --- Native import() of the real background entry point ---
		(globalThis as any).chrome.webNavigation.onCompleted.addListener.mockClear();
		await import(/* @vite-ignore */ webext('lib/background-main.js'));

		// Flush microtasks so the top-level Prefs.init() chain resolves.
		await vi.advanceTimersByTimeAsync(0);

		// --- Capture the listeners lib/background-main.js registers ---
		onCompletedListener = (globalThis as any).chrome.webNavigation.onCompleted
			.addListener.mock.calls[0][0];
		onActivatedListener = (globalThis as any).chrome.tabs.onActivated
			.addListener.mock.calls[0][0];
		onRemovedListener = (globalThis as any).chrome.tabs.onRemoved
			.addListener.mock.calls[0][0];
		// lib/messages.js's handleMessage is a real export — no vm/mock-call
		// indirection needed to reach it.
		onMessageListener = handleMessage;

		// M3: captureSessions/networkIdleWatchers are module-private to
		// lib/capture.js now (no globalThis global to read) — these test-only
		// escape hatches are live references onto the real Maps.
		getCaptureSessions = () => _captureSessionsForTests;
		getPendingCapturesObj = () => (sessionStore.pendingCaptures as Record<string, any>) || {};
		getNetworkIdleWatchers = () => _networkIdleWatchersForTests;
	});

	beforeEach(() => {
		(globalThis as any).chrome.tabs.captureVisibleTab.mockClear();
		thumbnailStore.put.mockClear();
		thumbnailStore.delete.mockClear();
		(mockDB.transaction as ReturnType<typeof vi.fn>).mockClear();
		getCaptureSessions().clear();
		sessionStore = {};
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
			() => Promise.resolve({ active: true, windowId: 1, incognito: true })
		);
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
	});

	it('onCompleted defers inactive tabs to pendingCaptures', async () => {
		(globalThis as any).chrome.tabs.get.mockImplementationOnce(
			() => Promise.resolve({ active: false, windowId: 1, incognito: false })
		);
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		// pendingCaptures now round-trips through the mocked browser.storage.session
		// (get → mutate → set), an extra microtask hop beyond the in-memory Map.
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(0);
		expect(captureCallCount()).toBe(0);
		expect(42 in getPendingCapturesObj()).toBe(true);
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
		sessionStore.pendingCaptures = { 42: { url: 'https://example.com', windowId: 1 } };
		onActivatedListener({ tabId: 42 });
		// Consuming the entry round-trips through storage.session (get → delete →
		// set) before startCaptureSession fires — flush that chain, then A.
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(0); // A

		expect(captureCallCount()).toBe(1); // A
		expect(getCaptureSessions().has(42)).toBe(true);
		expect(42 in getPendingCapturesObj()).toBe(false);

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

	// Characterization test (MV3_MIGRATION.md Slice C: captureTab rewritten
	// from nested callbacks to an async function). The test above exercises
	// session invalidation via a duplicate onCompleted for the SAME URL; this
	// one drives it with a genuine navigation to a DIFFERENT URL, confirming
	// the session-identity guard (`captureSessions.get(tabId) === session`)
	// invalidates in-flight captures from the replaced session regardless of
	// whether the URL changed — there is no separate URL check anywhere in
	// the pipeline, so this must hold before AND after the captureTab rewrite.
	it('a real navigation to a different URL replaces the session and invalidates its in-flight captures', async () => {
		(Tiles.ensureReady as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ cache: ['https://example.com'], list: [] })
			.mockResolvedValueOnce({ cache: ['https://second.example.com'], list: [] });

		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
		await vi.advanceTimersByTimeAsync(0); // first session's A
		expect(captureCallCount()).toBe(1);
		const firstSession = getCaptureSessions().get(42);
		expect(firstSession.url).toBe('https://example.com');

		// Real navigation to a DIFFERENT URL on the same tab, before the first
		// session's B/hard-deadline stages fire.
		onCompletedListener({ frameId: 0, tabId: 42, url: 'https://second.example.com' });
		await vi.advanceTimersByTimeAsync(0); // second session's A
		expect(captureCallCount()).toBe(2);
		const secondSession = getCaptureSessions().get(42);
		expect(secondSession).not.toBe(firstSession);
		expect(secondSession.url).toBe('https://second.example.com');

		// The first session's B (500ms) and hard-deadline C (2000ms) timers
		// were cancelled when the second session replaced it (startCaptureSession
		// clears `oldSession.timers`) — only the SECOND session's B/C stages
		// contribute further captures.
		await vi.advanceTimersByTimeAsync(500); // second session's B
		expect(captureCallCount()).toBe(3);
		await vi.advanceTimersByTimeAsync(1500); // second session's hard-deadline C
		expect(captureCallCount()).toBe(4);
	});

	it('onRemoved cleans up captureSessions, pendingCaptures, and network idle', async () => {
		getCaptureSessions().set(42, { url: 'x', captures: [], timers: [] });
		sessionStore.pendingCaptures = { 42: { url: 'x', windowId: 1 } };
		getNetworkIdleWatchers().set(42, { timer: 0, startTime: 0, callback: vi.fn(), resetCount: 0 });

		onRemovedListener(42);
		// pendingCaptures cleanup now round-trips through storage.session
		// (get → delete → set) — captureSessions/networkIdleWatchers stay
		// synchronous, unchanged.
		expect(getCaptureSessions().has(42)).toBe(false);
		expect(getNetworkIdleWatchers().has(42)).toBe(false);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(0);
		expect(42 in getPendingCapturesObj()).toBe(false);
	});

	// --- Network idle monitor ---

	it('network idle fires after 2s of no network activity', async () => {
		const callback = vi.fn();
		armNetworkIdle(99, callback);

		await vi.advanceTimersByTimeAsync(1999);
		expect(callback).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(callback).toHaveBeenCalledOnce();
		expect(callback.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
	});

	it('webRequest resets the idle timer', async () => {
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
			() => Promise.resolve({ active: false, windowId: 1, incognito: false })
		);

		// B at 500ms — should be skipped because tab is no longer active
		await vi.advanceTimersByTimeAsync(500);
		expect(captureCallCount()).toBe(1); // still just A

		// Restore mock for other tests
		(globalThis as any).chrome.tabs.get.mockImplementation(
			() => Promise.resolve({ active: true, windowId: 1, incognito: false })
		);
	});

	// --- MV3 permission guards (host permissions are user-revocable at
	// runtime, unlike MV2's install-time-only grant — MV3_MIGRATION.md
	// "Capture pipeline & permissions") ---

	describe('MV3 permission guards', () => {
		afterEach(() => {
			// Restore the granted-by-default mock the rest of this file relies on.
			(globalThis as any).chrome.permissions.contains = vi.fn().mockResolvedValue(true);
		});

		it('startCaptureSession bails when the <all_urls> host permission has been revoked — no session, no captureVisibleTab call', async () => {
			(globalThis as any).chrome.permissions.contains = vi.fn().mockResolvedValue(false);

			onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
			// The permission check is an extra async hop ahead of session
			// creation (Tiles.ensureReady -> tabs.get -> permissions.contains) —
			// flush generously so it resolves before asserting.
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(0);

			expect(captureCallCount()).toBe(0);
			expect(getCaptureSessions().has(42)).toBe(false);
		});

		it('captureTab resolves {dataURL: null, favIconUrl: null} without throwing when captureVisibleTab is absent from the browser API', async () => {
			// Firefox hides tabs.captureVisibleTab entirely (not merely denies
			// it) when the extension lacks the host permission the API needs —
			// simulate that by deleting it, rather than mocking a throw.
			const original = (globalThis as any).chrome.tabs.captureVisibleTab;
			delete (globalThis as any).chrome.tabs.captureVisibleTab;

			try {
				const result = await captureTab(42, 1);
				expect(result).toEqual({ dataURL: null, favIconUrl: null });
			} finally {
				(globalThis as any).chrome.tabs.captureVisibleTab = original;
			}
		});
	});

	// --- Thumbnails.delete message handler ---

	it('Thumbnails.delete removes entry from IDB', async () => {
		const sender = { id: EXTENSION_ID };
		onMessageListener(
			{ name: 'Thumbnails.delete', url: 'https://example.com' },
			sender,
			vi.fn()
		);
		// M2: this handler now goes through withStore(), which awaits DB
		// readiness before opening the transaction — no longer synchronous
		// (this was background.js's one previously-UNGUARDED raw db.transaction
		// call site; withStore closes that gap as a side effect, at the cost of
		// one microtask of latency here).
		await vi.advanceTimersByTimeAsync(0);
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

	// --- pickAndStore re-guards db after its awaits (audit §2.4) ---

	it('pickAndStore re-guards the DB after the isBlank/favicon/resize awaits — a connection drop mid-chain does not raise an unhandled rejection, and the write retries after reconnect', async () => {
		const originalLocalGet = (globalThis as any).chrome.storage.local.get;
		const unhandledSpy = vi.fn();
		process.on('unhandledRejection', unhandledSpy);

		try {
			onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
			await vi.advanceTimersByTimeAsync(0); // A

			// Simulate the connection dropping (the real onclose/onversionchange
			// handlers in lib/db.js clear the module-private connection) exactly
			// while pickAndStore's chain is mid-flight — at the
			// `browser.storage.local.get` await that follows the isBlank/favicon
			// awaits. There's no raw `db` global to poke anymore (M2) — lib/db.js's
			// `_resetForTests()` is the documented public escape hatch for
			// simulating this (see its own doc comment).
			(globalThis as any).chrome.storage.local.get = vi.fn((keys: Record<string, unknown>) => {
				_resetForTests();
				return Promise.resolve(keys);
			});

			// Let network idle fire (2s) to trigger pickAndStore.
			await vi.advanceTimersByTimeAsync(2000);
			// Flush isBlank + storage.local.get (drops the connection) +
			// resizeThumbnail + the re-guarding withStore() + the final put().
			for (let i = 0; i < 6; i++) {
				await vi.advanceTimersByTimeAsync(0);
			}

			expect(unhandledSpy).not.toHaveBeenCalled();
			// withStore() reopens the connection (indexedDB.open mock always
			// succeeds here) — the write retries and lands rather than being
			// silently lost.
			expect(thumbnailStore.put).toHaveBeenCalled();
			const storedObj = thumbnailStore.put.mock.calls[0][0];
			expect(storedObj.url).toBe('https://example.com');
		} finally {
			process.off('unhandledRejection', unhandledSpy);
			(globalThis as any).chrome.storage.local.get = originalLocalGet;
		}
	});

	// --- pendingCaptures: serialized read-modify-write (audit §2.3) ---

	it('two concurrent onCompleted RMW writes for different background tabs both survive (serialized helper)', async () => {
		const originalSessionGet = (globalThis as any).chrome.storage.session.get;
		let releaseGets: Array<() => void> = [];
		(globalThis as any).chrome.storage.session.get = vi.fn((key: string) => {
			return new Promise(resolve => {
				releaseGets.push(() => resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}));
			});
		});

		try {
			// Both tabs inactive so both onCompleted calls defer into pendingCaptures.
			(globalThis as any).chrome.tabs.get = vi.fn()
				.mockResolvedValue({ active: false, windowId: 1, incognito: false });
			(Tiles.ensureReady as ReturnType<typeof vi.fn>).mockResolvedValue(
				{ cache: ['https://example.com', 'https://second.example.com'], list: [] },
			);

			onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
			onCompletedListener({ frameId: 0, tabId: 43, url: 'https://second.example.com' });

			// Flush both handlers up to (but not through) their storage.session
			// .get() calls.
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(0);
			}

			// The serialized helper funnels both writes through ONE in-flight
			// promise chain — tab 43's get() must not have been issued yet, since
			// tab 42's read-modify-write (get -> mutate -> set) hasn't completed.
			// Without the serialized helper both onCompleted calls would reach
			// storage.session.get() independently and this would be 2.
			expect(releaseGets.length).toBe(1);

			// Release every get() as it becomes available, repeatedly, until the
			// whole serialized chain has drained (each release may enqueue the
			// NEXT write's get() call).
			for (let round = 0; round < 5 && releaseGets.length; round++) {
				const pending = releaseGets.splice(0);
				pending.forEach(r => r());
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);
			}

			expect(42 in getPendingCapturesObj()).toBe(true);
			expect(43 in getPendingCapturesObj()).toBe(true);
		} finally {
			(globalThis as any).chrome.storage.session.get = originalSessionGet;
			(globalThis as any).chrome.tabs.get = vi.fn(
				() => Promise.resolve({ active: true, windowId: 1, incognito: false }),
			);
		}
	});

	// --- NeverCapture guards ---

	describe('NeverCapture guards', () => {
		beforeEach(() => {
			(globalThis as any).chrome.tabs.captureVisibleTab.mockClear();
			thumbnailStore.put.mockClear();
			(mockDB.transaction as ReturnType<typeof vi.fn>).mockClear();
			getCaptureSessions().clear();
			sessionStore = {};
			getNetworkIdleWatchers().clear();
			// Reset NeverCapture to empty before each test
			(globalThis as any).NeverCapture._list = [];
		});

		it('Thumbnails.capture message for a listed host — startCaptureSession bails, captureVisibleTab never called', async () => {
			// List the example.com host
			(globalThis as any).NeverCapture._list = ['example.com'];
			const sender = {
				id: EXTENSION_ID,
				tab: { id: 42, windowId: 1, url: 'https://example.com' },
			};
			onMessageListener({ name: 'Thumbnails.capture' }, sender, vi.fn());
			await vi.advanceTimersByTimeAsync(0);
			// Guard fires: no capture session started, no captureVisibleTab call
			expect(captureCallCount()).toBe(0);
			expect(getCaptureSessions().has(42)).toBe(false);
		});

		it('Thumbnails.capture for an unlisted host still starts a session', async () => {
			(globalThis as any).NeverCapture._list = ['other.com'];
			const sender = {
				id: EXTENSION_ID,
				tab: { id: 42, windowId: 1, url: 'https://example.com' },
			};
			onMessageListener({ name: 'Thumbnails.capture' }, sender, vi.fn());
			await vi.advanceTimersByTimeAsync(0);
			expect(captureCallCount()).toBe(1);
		});

		it('webNavigation.onCompleted for a listed cached URL — no capture session, no pendingCaptures entry (active tab)', async () => {
			(globalThis as any).NeverCapture._list = ['example.com'];
			// example.com is in the Tiles cache (see beforeAll setup)
			onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
			await vi.advanceTimersByTimeAsync(0);
			expect(captureCallCount()).toBe(0);
			expect(getCaptureSessions().has(42)).toBe(false);
			expect(42 in getPendingCapturesObj()).toBe(false);
		});

		it('webNavigation.onCompleted for a listed cached URL — no pendingCaptures entry (inactive tab)', async () => {
			(globalThis as any).NeverCapture._list = ['example.com'];
			(globalThis as any).chrome.tabs.get.mockImplementationOnce(
				() => Promise.resolve({ active: false, windowId: 1, incognito: false })
			);
			onCompletedListener({ frameId: 0, tabId: 42, url: 'https://example.com' });
			await vi.advanceTimersByTimeAsync(0);
			expect(captureCallCount()).toBe(0);
			expect(42 in getPendingCapturesObj()).toBe(false);
		});
	});
});

// ===========================================================================
// Remove-thumbnail button — fx-newTab.js (behavioral)
// ===========================================================================

describe('Thumbnail action buttons — fx-newTab.js (behavioral)', () => {
	let fxSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: action handler strings
		fxSource = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/fx-newTab.js'), 'utf8'
		);
	});

	it('_onClick handles action buttons by data-action attribute', () => {
		expect(fxSource).toContain('data-action');
	});

	it('never-capture action sends Thumbnails.purgeHost message', () => {
		// The refresh action (Thumbnails.capture) was removed with the refresh
		// button; behavioral coverage for the purge lives in tile-redesign.test.ts.
		expect(fxSource).toContain('Thumbnails.purgeHost');
	});
});

// ===========================================================================
// getThumbnails display — newTab.js (behavioral, vm.runInThisContext)
// ===========================================================================

describe('getThumbnails display — newTab.js (Phase 1 slot 16)', () => {
	let harness: any;
	let gridSites: any[];

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const getThumbnails = extractMethod(source, 'getThumbnails');

		globalThis.Grid = { sites: [] };

		const code = `var newTabTools = { ${getThumbnails}, getFavicons() {}, selectedSite: null, siteThumbnail: { style: {} }, saveCurrentThumbButton: { disabled: true } };`;
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
		const site = { link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' }, querySelector: () => null } };
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
		const site = { link: { url: 'https://a.com' }, thumbnail: { style: { backgroundImage: '' }, querySelector: () => null } };
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

	it('removes .ntt-logo-fallback overlay when thumbnail is loaded', () => {
		const thumbnailEl = realCreateElement('span');
		thumbnailEl.className = 'newtab-thumbnail';
		const fallback = realCreateElement('div');
		fallback.className = 'ntt-logo-fallback';
		thumbnailEl.appendChild(fallback);
		document.body.appendChild(thumbnailEl);

		const site = {
			link: { url: 'https://a.com' },
			thumbnail: thumbnailEl,
		};
		gridSites.push(site);
		(globalThis as any).Grid.sites = gridSites;

		const thumbBlob = new Blob(['thumb']);
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb-url');
		const thumbMap = new Map([['https://a.com', thumbBlob]]);
		chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: any) => cb(thumbMap));

		harness.getThumbnails();

		expect(thumbnailEl.style.backgroundImage).toContain('blob:thumb-url');
		expect(thumbnailEl.querySelector('.ntt-logo-fallback')).toBeNull();

		thumbnailEl.remove();
	});
});
