/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: IndexedDB connection lifecycle in lib/db.js
 * (MODERNIZATION.md, Stage M, slice M2 — "the readiness redesign").
 *
 * This is the M2 replacement for the "IndexedDB reconnect" describe block
 * that used to live in event-page-resilience.test.ts (MV3 migration Slice
 * B): that version poked `globalThis.db`/`globalThis.waitForDB()` directly,
 * which no longer exist — the connection is now module-private to
 * lib/db.js, reachable only through `withStore()`. This file loads lib/db.js
 * via a REAL native `import` (not vm.runInThisContext — it's a real ES
 * module, no globalThis bridge involved) and characterizes:
 *
 *   1. `onclose`/`onversionchange` are attached to a freshly-opened connection.
 *   2. Both handlers clear the cached connection so the NEXT `withStore()`
 *      call reopens it via `indexedDB.open()`.
 *   3. Concurrent `withStore()` callers dedupe onto one in-flight open.
 *   4. A failed open rejects the in-flight callers; a LATER call retries
 *      from scratch (not doomed for the module's lifetime).
 *
 * `_resetForTests()` forces a clean slate between tests (see its own doc
 * comment in lib/db.js) — there's no raw `db` global to poke instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withStore, _resetForTests } from '../../webextension/lib/db.js';

type ControllableOpen = 'success' | 'error';

describe('lib/db.js — connection lifecycle (withStore readiness gate)', () => {
	let mockDB: Record<string, unknown>;
	let openQueue: ControllableOpen[];
	let openMock: ReturnType<typeof vi.fn>;

	function installControllableIndexedDB() {
		openQueue = [];
		openMock = vi.fn(() => {
			const behavior: ControllableOpen = openQueue.length ? openQueue.shift()! : 'success';
			const handlers: Record<string, Function> = {};
			const req: Record<string, unknown> = {};
			for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
				Object.defineProperty(req, prop, {
					set(cb: Function) { handlers[prop] = cb; },
					configurable: true,
				});
			}
			// Fire after the synchronous handler-assignment block in initDB()
			// completes, mirroring IndexedDB's real async open.
			Promise.resolve().then(() => {
				if (behavior === 'error' && handlers.onerror) {
					handlers.onerror(new Event('error'));
				} else if (handlers.onsuccess) {
					handlers.onsuccess.call({ result: mockDB });
				}
			});
			return req;
		});
		(globalThis as any).indexedDB = { open: openMock };
	}

	beforeEach(() => {
		// Force a clean slate: no cached connection, no in-flight open promise.
		_resetForTests();
		mockDB = {
			objectStoreNames: { contains: () => true },
			transaction: vi.fn(() => ({ objectStore: vi.fn(() => ({})) })),
			createObjectStore: vi.fn(),
			// Real onversionchange handlers call db.close() before clearing db.
			close: vi.fn(),
		};
		installControllableIndexedDB();
	});

	it('attaches onclose/onversionchange handlers after a successful open', async () => {
		await withStore('tiles', 'readonly', () => undefined);
		expect(typeof mockDB.onclose).toBe('function');
		expect(typeof mockDB.onversionchange).toBe('function');
	});

	it('reopens the connection after onclose fires, resolving a later withStore() call again', async () => {
		await withStore('tiles', 'readonly', () => undefined);
		const callsBefore = openMock.mock.calls.length;

		(mockDB.onclose as Function)();

		await withStore('tiles', 'readonly', () => undefined);
		expect(openMock.mock.calls.length).toBe(callsBefore + 1);
	});

	it('reopens the connection after onversionchange fires (closes then clears)', async () => {
		await withStore('tiles', 'readonly', () => undefined);
		const callsBefore = openMock.mock.calls.length;

		(mockDB.onversionchange as Function)();
		expect(mockDB.close).toHaveBeenCalled();

		await withStore('tiles', 'readonly', () => undefined);
		expect(openMock.mock.calls.length).toBe(callsBefore + 1);
	});

	it('dedupes concurrent callers onto a single in-flight open', async () => {
		const p1 = withStore('tiles', 'readonly', () => undefined);
		const p2 = withStore('tiles', 'readonly', () => undefined);

		// Both calls happened before the mocked open() resolved (still
		// microtask-pending) — only one indexedDB.open() call for the pair.
		expect(openMock.mock.calls.length).toBe(1);

		await Promise.all([p1, p2]);
	});

	it('rejects current callers on open failure, then a later call retries and resolves', async () => {
		openQueue.push('error');
		await expect(withStore('tiles', 'readonly', () => undefined)).rejects.toBeDefined();

		// A LATER call (after the failed one settled) retries from scratch —
		// queue is empty now, so the mock defaults to success.
		const callsBefore = openMock.mock.calls.length;
		await withStore('tiles', 'readonly', () => undefined);
		expect(openMock.mock.calls.length).toBe(callsBefore + 1);
	});

	it('a single-store call hands fn the IDBObjectStore directly', async () => {
		let received: unknown;
		await withStore('tiles', 'readonly', store => { received = store; });
		expect(received).toEqual({});
	});

	it('a multi-store (array) call hands fn the IDBTransaction, not a store', async () => {
		let received: unknown;
		await withStore(['thumbnails', 'tiles'], 'readwrite', tx => { received = tx; });
		expect(received).toHaveProperty('objectStore');
	});
});
