/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * JSON-safe wire codec (CHROME.md Decision 11, 2026-07-18).
 *
 * `message_serialization: "structured_clone"` (the former Decision 10) turned
 * out to be **canary-channel-gated in branded Chrome**: stable rejects the
 * manifest key outright and silently falls back to JSON serialization, where
 * a `Blob` arrives as `{}` and a `Map` arrives as a plain Object. Structured
 * clone must therefore be a progressive enhancement that is never
 * load-bearing — on the browser real users run, it does not exist. This
 * module is the fix: it makes the ~10 binary wires (`Thumbnails.get`,
 * `getFavicons`/`getFaviconsByHost`, `Export:backup`/`Import:restore`,
 * `Background.get/setBackground`, `Tiles.*` via `tile.image`) survive plain
 * JSON messaging by tagging `Blob`/`File`/`Map` payloads with base64/entries
 * on the way out and reconstructing them on the way in.
 *
 * Dual-scope file at the `webextension/` root (like `prefs.js`/`common.js`),
 * not under `lib/`: the page cannot import `lib/**` (PAGE_MODULES.md
 * Decision 6), and both `api.js` (page) and `lib/messages.js` (background)
 * need this codec at their respective chokepoint.
 *
 * `_wireCodecActive()` is the single gate: true only under a real Chrome
 * extension page/service-worker origin (`chrome-extension:`). On Firefox
 * (`moz-extension:`) and in every jsdom/node test environment (`http:`, or
 * no `location` at all) it is false, so encode/decode never run and every
 * message flows through native structured clone (Firefox) or the test
 * harness's plain mock (`http:`) exactly as before this module existed —
 * the "Firefox unchanged" program invariant. Underscore prefix follows the
 * `_isServiceWorkerScope` test-seam idiom (`lib/thumbnail-image.js`).
 */

/**
 * @returns {boolean} true iff running under a real Chrome extension origin.
 */
export function _wireCodecActive() {
	return typeof globalThis.location !== 'undefined'
		&& globalThis.location.protocol === 'chrome-extension:';
}

/**
 * True iff `value` is a plain object — `{}`/`Object.create(null)` literal
 * shape, not a class instance (`Blob`, `Map`, `Date`, a `Site`, …). Only
 * plain objects get recursed into and rebuilt; everything else (including
 * types this codec doesn't know about) passes through untouched.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	let proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Sync, recursive scan: does `value` contain a `Blob`/`File`/`Map` anywhere
 * that would be mangled by JSON serialization? Used to skip the async
 * `encodeForWire` entirely for the common case (a plain JSON-safe payload),
 * keeping `wrapRuntimeForWire`'s `sendMessage` synchronous in that case.
 * @param {unknown} value
 * @returns {boolean}
 */
export function needsWireEncoding(value) {
	if (value instanceof Blob || value instanceof Map) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some(needsWireEncoding);
	}
	if (isPlainObject(value)) {
		return Object.values(/** @type {Record<string, unknown>} */ (value)).some(needsWireEncoding);
	}
	return false;
}

/** Chunk size for `btoa(String.fromCharCode(...))` — large enough to be
 * fast, small enough to never hit an argument-count/stack limit on a
 * multi-MB backup. */
const BASE64_CHUNK_SIZE = 0x8000;

/**
 * @param {Blob} blob
 * @returns {Promise<string>} base64 of the blob's bytes.
 */
async function blobToBase64(blob) {
	let bytes = new Uint8Array(await blob.arrayBuffer());
	let chunks = [];
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
		chunks.push(String.fromCharCode(.../** @type {any} */ (bytes.subarray(i, i + BASE64_CHUNK_SIZE))));
	}
	return btoa(chunks.join(''));
}

/**
 * Recursively encode `value` into a JSON-safe shape: `File`/`Blob` become a
 * tagged base64 object, `Map` becomes tagged entries (keys and values
 * encoded too), arrays/plain objects are rebuilt with each element/value
 * encoded, and anything else (primitives, other class instances) is
 * returned as-is.
 * @param {unknown} value
 * @returns {Promise<unknown>}
 */
export async function encodeForWire(value) {
	if (value instanceof File) {
		return {
			__ntt_blob: await blobToBase64(value),
			type: value.type,
			name: value.name,
			lastModified: value.lastModified,
		};
	}
	if (value instanceof Blob) {
		return { __ntt_blob: await blobToBase64(value), type: value.type };
	}
	if (value instanceof Map) {
		let entries = await Promise.all(
			[...value.entries()].map(async ([k, v]) => [await encodeForWire(k), await encodeForWire(v)]),
		);
		return { __ntt_map: entries };
	}
	if (Array.isArray(value)) {
		return Promise.all(value.map(encodeForWire));
	}
	if (isPlainObject(value)) {
		/** @type {Record<string, unknown>} */
		let out = {};
		for (let [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
			out[k] = await encodeForWire(v);
		}
		return out;
	}
	return value;
}

/**
 * Recursively decode a value produced by `encodeForWire` — or, on Firefox
 * (or a double-decode), a value that never went through it at all. SYNC and
 * IDEMPOTENT: a real `Blob`/`File`/`Map` instance is returned untouched, so
 * calling this on already-native data (Firefox's real structured-clone
 * payload, or a value this function already decoded) is always a no-op.
 * Never throws: a malformed tag (wrong-typed `__ntt_blob`/`__ntt_map`, or
 * invalid base64) is returned as plain data unchanged rather than crashing
 * the message dispatch.
 * @param {unknown} value
 * @returns {unknown}
 */
export function decodeFromWire(value) {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	// Idempotence: real binary instances pass through untouched.
	if (value instanceof Blob || value instanceof Map) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(decodeFromWire);
	}
	if (isPlainObject(value)) {
		let obj = /** @type {Record<string, unknown>} */ (value);
		if ('__ntt_blob' in obj) {
			return decodeBlobTag(obj);
		}
		if ('__ntt_map' in obj) {
			return decodeMapTag(obj);
		}
		/** @type {Record<string, unknown>} */
		let out = {};
		for (let [k, v] of Object.entries(obj)) {
			out[k] = decodeFromWire(v);
		}
		return out;
	}
	return value;
}

/**
 * @param {Record<string, unknown>} obj a `{__ntt_blob, type, name?,
 * lastModified?}` tag, or a malformed lookalike.
 * @returns {unknown} the reconstructed `File`/`Blob`, or `obj` unchanged if
 * the tag is malformed (wrong-typed `__ntt_blob`, or invalid base64).
 */
function decodeBlobTag(obj) {
	if (typeof obj.__ntt_blob !== 'string') {
		return obj;
	}
	let bytes;
	try {
		let binary = atob(obj.__ntt_blob);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
	} catch {
		return obj;
	}
	let type = typeof obj.type === 'string' ? obj.type : undefined;
	if (typeof obj.name === 'string') {
		return new File([bytes], obj.name, { type, lastModified: /** @type {number|undefined} */ (obj.lastModified) });
	}
	return new Blob([bytes], { type });
}

/**
 * @param {Record<string, unknown>} obj a `{__ntt_map: [[k, v], ...]}` tag,
 * or a malformed lookalike.
 * @returns {unknown} the reconstructed `Map`, or `obj` unchanged if
 * `__ntt_map` isn't an array.
 */
function decodeMapTag(obj) {
	// Every entry must itself be a [k, v] pair — a malformed entry (e.g.
	// `{__ntt_map: [42]}`) is returned as plain data, not destructured (which
	// would throw, breaking the never-throws contract).
	if (!Array.isArray(obj.__ntt_map) || !obj.__ntt_map.every(Array.isArray)) {
		return obj;
	}
	return new Map(obj.__ntt_map.map(([k, v]) => [decodeFromWire(k), decodeFromWire(v)]));
}

/**
 * Wrap the page-side `runtime` namespace so `sendMessage` transparently
 * encodes outgoing binary payloads and decodes incoming binary responses.
 * Every other property passes through to the real namespace: functions are
 * bound to it (Chrome's extension API methods throw "Illegal invocation" if
 * called with the wrong `this`), non-functions (`onMessage`, `id`,
 * `lastError`, …) pass through by reference.
 * @param {any} runtime the real `browser.runtime`/`chrome.runtime`.
 * @returns {any} a wrapped namespace with a wire-aware `sendMessage`.
 */
export function wrapRuntimeForWire(runtime) {
	/**
	 * @param {unknown} message
	 * @param {...any} rest trailing MV3 `sendMessage` args — an optional
	 * `extensionId`/`options`, and/or a trailing callback.
	 * @returns {Promise<unknown>|undefined} a promise of the DECODED response
	 * when called promise-style; `undefined` when a callback was supplied
	 * (the callback receives the decoded response instead).
	 */
	function wireSendMessage(message, ...rest) {
		let callback = typeof rest[rest.length - 1] === 'function' ? rest.pop() : undefined;
		/** @param {unknown} encoded */
		let send = encoded => callback
			// The user callback fires SYNCHRONOUSLY inside the underlying
			// callback, preserving Chrome's `runtime.lastError` window (it's
			// only valid for the duration of that synchronous callback).
			? runtime.sendMessage(encoded, ...rest, (/** @type {unknown} */ response) => callback(decodeFromWire(response)))
			: runtime.sendMessage(encoded, ...rest).then(decodeFromWire);
		// The common case (a JSON-safe payload) calls the underlying
		// sendMessage synchronously — no extra microtask, no behavior change
		// beyond decoding the response.
		return needsWireEncoding(message) ? encodeForWire(message).then(send) : send(message);
	}

	return new Proxy(runtime, {
		get(target, prop, receiver) {
			if (prop === 'sendMessage') {
				return wireSendMessage;
			}
			let value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

/**
 * Wrap a `runtime.onMessage` handler so it transparently decodes an incoming
 * binary message before the handler sees it, and encodes a binary response
 * before it goes out over `sendResponse`. Unconditional (the platform gate —
 * `_wireCodecActive()` — lives at the registration call site in
 * `lib/messages.js`), which keeps this pure and unit-testable without a
 * `globalThis.location` fixture.
 * @param {(message: any, sender: any, sendResponse: (...args: any[]) => any) => boolean} handler
 * @returns {(message: any, sender: any, sendResponse: (...args: any[]) => any) => boolean}
 */
export function wrapHandlerForWire(handler) {
	return function (message, sender, sendResponse) {
		return handler(decodeFromWire(message), sender, function (/** @type {unknown} */ value) {
			if (needsWireEncoding(value)) {
				// Defers one microtask+ — safe because every binary wire in
				// lib/messages.js returns `true` (the async channel stays
				// open for a later sendResponse call).
				encodeForWire(value).then(sendResponse);
				return;
			}
			// JSON-safe responses go out synchronously: some dispatch cases
			// call sendResponse before returning `false`, which requires the
			// synchronous path to stay legal.
			sendResponse(value);
		});
	};
}
