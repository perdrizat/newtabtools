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

	// =========================================================================
	// CHROME.md D3 slice 3 finding (2026-07-16): the real Chrome capture
	// round-trip smoke surfaced `InvalidStateError: Failed to execute
	// 'transaction' on 'IDBDatabase': A version change transaction is
	// running.` on a completely fresh profile's very first DB open. Root
	// cause: `initDB()`'s `onupgradeneeded` handler assigns the module-private
	// `db` binding (`db = this.result`) — real IndexedDB fires
	// `onupgradeneeded` BEFORE its versionchange transaction commits, and only
	// fires `onsuccess` once it has. `waitForDB()`'s fast path
	// (`if (db) return Promise.resolve();`) checks only `db`'s truthiness, so
	// a second, concurrent `withStore()` caller that lands in the window
	// between `onupgradeneeded` and `onsuccess` sees `db` already set,
	// bypasses the `dbInitPromise` dedup entirely, and immediately calls
	// `db.transaction(...)` against a database whose upgrade transaction
	// hasn't committed yet — which real IndexedDB rejects with exactly that
	// InvalidStateError. This test reproduces the race directly (no upgrade
	// needed for the OTHER db-connection tests above, which is why they never
	// caught it — they only ever exercise the plain `onsuccess` path).
	// =========================================================================

	it('a concurrent withStore() call landing between onupgradeneeded and onsuccess does not transact against the still-upgrading DB', async () => {
		let handlers: Record<string, Function> = {};
		let upgradeComplete = false;

		openMock.mockImplementationOnce(() => {
			const req: Record<string, unknown> = {};
			for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
				Object.defineProperty(req, prop, {
					set(cb: Function) { handlers[prop] = cb; },
					configurable: true,
				});
			}
			return req;
		});

		const upgradeDB = {
			objectStoreNames: { contains: () => false },
			createObjectStore: vi.fn(() => ({ createIndex: vi.fn() })),
			close: vi.fn(),
			transaction: vi.fn(() => {
				if (!upgradeComplete) {
					// Real IndexedDB's actual rejection for this exact race.
					throw new DOMException('A version change transaction is running.', 'InvalidStateError');
				}
				return { objectStore: vi.fn(() => ({})) };
			}),
		};
		const upgradeTx = {
			objectStore: vi.fn(() => ({ indexNames: { contains: () => false }, createIndex: vi.fn() })),
		};

		const p1 = withStore('tiles', 'readonly', () => 'first');

		// Real IndexedDB fires onupgradeneeded asynchronously relative to the
		// open() call, but well before onsuccess.
		await Promise.resolve();
		handlers.onupgradeneeded.call({ result: upgradeDB, transaction: upgradeTx });

		// A second, CONCURRENT withStore() call arrives while the upgrade
		// transaction is still in flight (onsuccess has not fired yet).
		const p2 = withStore('tiles', 'readonly', () => 'second');

		// Let p2's internals run (await waitForDB(), then attempt
		// db.transaction()) BEFORE the upgrade transaction "completes" — this
		// is what actually reproduces the race; completing it first would hide
		// the bug regardless of the fix.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		// NOW let the upgrade transaction complete: IndexedDB fires onsuccess.
		upgradeComplete = true;
		handlers.onsuccess.call({ result: upgradeDB });

		await expect(Promise.all([p1, p2])).resolves.toEqual(['first', 'second']);
	});
});
