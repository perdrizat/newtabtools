/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * IndexedDB connection lifecycle for New Tab Tools (MODERNIZATION.md, Stage
 * M, slice M2 — "the readiness redesign").
 *
 * Supersedes the former webextension/background.js's `initDB`/`waitForDB`/
 * `globalThis.db` trio (and the ~10 hand-wrapped `waitForDB()` call sites the
 * pre-release fix queue added — audit §2.1). The raw connection is a
 * MODULE-PRIVATE binding: it is never exported, and nothing outside this
 * file can read or write it. Every caller — Tiles/Background
 * (lib/tiles-store.js), lib/messages.js's `Thumbnails.*` handlers, and
 * lib/background-main.js's `cleanupThumbnails` — reaches it via a real
 * `import { withStore } from './db.js'` (background.js dissolved in
 * MODERNIZATION.md Stage M slice M5; there is no more `globalThis` bridge for
 * it) — goes through `withStore()`, which awaits readiness itself. An
 * unguarded db access is therefore unrepresentable: there is no `db`
 * identifier anywhere else in the codebase to unguard.
 */

/** @type {IDBDatabase|undefined} The live connection. Module-private — never exported. */
let db;

/**
 * Memoizes the in-flight `initDB()` call so concurrent `waitForDB()` callers
 * share one open request; cleared on settle (success or failure) so a LATER
 * call retries from scratch.
 * @type {Promise<void>|undefined}
 */
let dbInitPromise;

/**
 * Open (or reopen) the IndexedDB connection, resolving once `db` is set.
 * Attaches `onclose`/`onversionchange` handlers that clear `db` when the
 * connection drops — independent of event-page respawn (e.g. another
 * context bumping the DB version) — so `waitForDB()` knows to reopen it.
 * Schema (version 9, three stores + indexes) is unchanged from the pre-M2
 * background.js implementation — byte-identical, this is user data.
 * @returns {Promise<void>} Rejects with the triggering event on a genuine
 *   open failure (`onblocked`/`onerror`).
 */
function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 9);

		request.onsuccess = function(/* event */) {
			db = this.result;
			db.onclose = function() {
				db = undefined;
			};
			// `this` inside an IDBDatabase event handler is the database
			// itself (same object as `db`) — using it instead of the outer
			// `db` here avoids a redundant possibly-undefined narrow (the
			// outer `db` binding's declared type spans every assignment
			// anywhere in this closure, including `db = undefined` above and
			// below, which the type system can't rule out at this point;
			// `this` is contextually typed as non-nullable `IDBDatabase` from
			// the `onversionchange` handler's own type instead).
			db.onversionchange = function() {
				this.close();
				db = undefined;
			};
			resolve();
		};

		request.onblocked = request.onerror = function(event) {
			reject(event);
		};

		request.onupgradeneeded = function(/* event */) {
			// CHROME.md D3 slice 3 finding (2026-07-16, real Chrome capture
			// round-trip): this handler must NOT assign the module-private `db`
			// binding. Real IndexedDB fires `onupgradeneeded` BEFORE its
			// versionchange transaction commits, and only fires `onsuccess`
			// once it has; `waitForDB()`'s fast path (`if (db) return
			// Promise.resolve();`) checks only `db`'s truthiness. Assigning `db`
			// here let a concurrent `withStore()` caller landing in the
			// onupgradeneeded→onsuccess window bypass the `dbInitPromise` dedup
			// and immediately call `db.transaction(...)` against a database
			// whose upgrade transaction hadn't committed yet — which real
			// IndexedDB rejects with `InvalidStateError: A version change
			// transaction is running.` (reproduced in
			// tests/integration/db-connection.test.ts). A local `database`
			// binding gives this handler everything it needs (create the
			// stores/indexes) without exposing the connection early; `onsuccess`
			// below still assigns the real module-private `db`, correctly only
			// once the upgrade has fully committed.
			let database = this.result;
			// `this.transaction` is non-null during `upgradeneeded` (IndexedDB
			// spec guarantee) — lib.dom.d.ts types it nullable generally, so
			// a local JSDoc-cast alias avoids repeating a cast at every use.
			let transaction = /** @type {IDBTransaction} */ (this.transaction);

			if (!database.objectStoreNames.contains('tiles')) {
				database.createObjectStore('tiles', { autoIncrement: true, keyPath: 'id' });
			}
			if (!transaction.objectStore('tiles').indexNames.contains('url')) {
				transaction.objectStore('tiles').createIndex('url', 'url');
			}

			if (!database.objectStoreNames.contains('background')) {
				database.createObjectStore('background', { autoIncrement: true });
			}

			if (!database.objectStoreNames.contains('thumbnails')) {
				database.createObjectStore('thumbnails', { keyPath: 'url' });
			}
			if (!transaction.objectStore('thumbnails').indexNames.contains('used')) {
				transaction.objectStore('thumbnails').createIndex('used', 'used');
			}
		};
	});
}

/**
 * Resolve once the IndexedDB connection is ready, (re)opening it if needed.
 * Concurrent callers dedupe onto the same in-flight `initDB()` call via
 * `dbInitPromise`; once that call settles the dedup is cleared, so a LATER
 * call — after a dropped connection (`onclose`/`onversionchange`) or a
 * failed open — retries `initDB()` from scratch instead of being doomed for
 * the lifetime of the context.
 * @returns {Promise<void>}
 */
function waitForDB() {
	if (db) {
		return Promise.resolve();
	}
	if (!dbInitPromise) {
		dbInitPromise = initDB().finally(function() {
			dbInitPromise = undefined;
		});
	}
	return dbInitPromise;
}

/**
 * Await DB readiness, open a transaction, and hand the caller either a
 * single `IDBObjectStore` or the raw `IDBTransaction` — no caller ever
 * touches the connection itself.
 *
 * - `storeNames` a string (the common case — single-store cursor walks,
 *   get/put/getAll/clear): `fn` receives that store directly.
 * - `storeNames` an array (purgeNeverCaptureHost's thumbnails+tiles pass is
 *   the one multi-store call site): `fn` receives the `IDBTransaction` so it
 *   can call `tx.objectStore(name)` per store — atomically, in one
 *   transaction, unlike the pre-M2 code's two sequential transactions.
 *
 * Typed as one general union signature rather than `@overload`s: a generic
 * `@overload` pair here didn't survive TypeScript's overload/implementation
 * compatibility check cleanly (the `fn` parameter's contravariant position
 * fights the generic per-overload template). Most single-store call sites
 * (lib/tiles-store.js, lib/messages.js, lib/capture.js's own single-store
 * calls) go through this file's own `withObjectStore()` export (a thin,
 * precisely-typed single-store view onto this function) instead of narrowing
 * here; lib/background-main.js's one call site (`cleanupThumbnails`) casts
 * the parameter to `IDBObjectStore` inline instead of adding a wrapper for a
 * single use. `purgeNeverCaptureHost` (lib/capture.js) is the one multi-store
 * call site and casts the union to `IDBTransaction` inline at its own call
 * site (see that function's own doc comment).
 *
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(storeOrTx: IDBObjectStore|IDBTransaction) => any} fn
 * @returns {Promise<any>}
 */
export async function withStore(storeNames, mode, fn) {
	await waitForDB();
	// waitForDB() having resolved is the invariant that guarantees `db` is
	// set — the cast documents that instead of repeating a truthiness guard
	// that could only ever be dead code here.
	let tx = /** @type {IDBDatabase} */ (db).transaction(storeNames, mode);
	if (Array.isArray(storeNames)) {
		return fn(tx);
	}
	return fn(tx.objectStore(storeNames));
}

/**
 * Thin single-store view onto `withStore()` — narrows `fn`'s parameter to
 * `IDBObjectStore` once, here, instead of a cast at every single-store call
 * site. Every lib/ module whose IndexedDB access is entirely single-store
 * (lib/tiles-store.js, lib/messages.js, lib/capture.js's own single-store
 * calls) imports this shared wrapper rather than each keeping its own
 * byte-identical copy (code-review audit finding #5, 2026-07-09: three copies
 * were kept in sync only by a cross-referencing comment in each file — a pure
 * type cast carries no per-file behavior, so one exported implementation
 * serves all three). `purgeNeverCaptureHost` (lib/capture.js) is the one
 * multi-store call site and keeps calling `withStore()` directly.
 * @template T
 * @param {string} storeName
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => T|Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withObjectStore(storeName, mode, fn) {
	return withStore(storeName, mode, /** @type {(storeOrTx: IDBObjectStore|IDBTransaction) => T|Promise<T>} */ (fn));
}

/**
 * Test-only escape hatch: force-drop the cached connection state so the
 * NEXT `withStore()` call reopens from scratch via `indexedDB.open()`. Real
 * production code never needs this — `onclose`/`onversionchange` already
 * clear `db` on any real disconnect. Exists because tests need to simulate
 * "the connection dropped mid-flight" (e.g. auto-thumbnail.test.ts's
 * pickAndStore re-guard regression) or start each test from a clean slate
 * without a raw `db` global to poke — mocking the effect of a real
 * disconnect through the public surface, rather than adding a second
 * production code path.
 * @returns {void}
 */
export function _resetForTests() {
	db = undefined;
	dbInitPromise = undefined;
}
