/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * IndexedDB connection lifecycle for New Tab Tools (MODERNIZATION.md, Stage
 * M, slice M2 — "the readiness redesign").
 *
 * Supersedes background.js's `initDB`/`waitForDB`/`globalThis.db` trio (and
 * the ~10 hand-wrapped `waitForDB()` call sites the pre-release fix queue
 * added — audit §2.1). The raw connection is a MODULE-PRIVATE binding: it is
 * never exported, and nothing outside this file can read or write it. Every
 * caller — Tiles/Background (lib/tiles-store.js, real `import`) and
 * background.js/export.js's remaining raw store access (bridged onto
 * `globalThis.withStore` in lib/background-main.js — background.js is still
 * a bridge-mode file per Decision 2 and can't use `import` syntax until its
 * own carve-up in M3/M5) — goes through `withStore()`, which awaits
 * readiness itself. An unguarded db access is therefore unrepresentable:
 * there is no `db` identifier anywhere else in the codebase to unguard.
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
			db = this.result;
			// `this.transaction` is non-null during `upgradeneeded` (IndexedDB
			// spec guarantee) — lib.dom.d.ts types it nullable generally, so
			// a local JSDoc-cast alias avoids repeating a cast at every use.
			let transaction = /** @type {IDBTransaction} */ (this.transaction);

			if (!db.objectStoreNames.contains('tiles')) {
				db.createObjectStore('tiles', { autoIncrement: true, keyPath: 'id' });
			}
			if (!transaction.objectStore('tiles').indexNames.contains('url')) {
				transaction.objectStore('tiles').createIndex('url', 'url');
			}

			if (!db.objectStoreNames.contains('background')) {
				db.createObjectStore('background', { autoIncrement: true });
			}

			if (!db.objectStoreNames.contains('thumbnails')) {
				db.createObjectStore('thumbnails', { keyPath: 'url' });
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
 * fights the generic per-overload template). Every call site in the actually
 * type-checked lib/tiles-store.js is single-store only, so it goes through
 * that file's own `withObjectStore()` wrapper (a thin, precisely-typed
 * single-store view onto this function) instead of narrowing here —
 * background.js's multi-store `purgeNeverCaptureHost` call is outside the
 * type-checked program (see tsconfig.json's `exclude` comment) and unaffected.
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
