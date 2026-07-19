/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * CHROME.md Decision 11 (2026-07-18): unit coverage for the JSON-safe wire
 * codec. `_wireCodecActive()` is false in this jsdom suite (no
 * `chrome-extension:` origin), so a small `_wireCodecActive`-only case below
 * flips `globalThis.location` to prove the gate itself; every other case
 * below exercises the pure encode/decode/wrap functions directly, which is
 * how they're actually driven in production (the platform gate lives at the
 * two call sites — `api.js`/`lib/messages.js` — not inside these functions).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	_wireCodecActive,
	needsWireEncoding,
	encodeForWire,
	decodeFromWire,
	wrapRuntimeForWire,
	wrapHandlerForWire,
} from '../../webextension/wire-codec.js';

// Captured BEFORE any test stubs `location`: restoring `{value: window.
// location}` inside afterEach is a self-referential no-op in jsdom
// (globalThis IS window — it reads back the stub itself and leaks the fake
// origin into later tests in this file). Restore this descriptor instead.
const ORIGINAL_LOCATION_DESCRIPTOR =
	Object.getOwnPropertyDescriptor(globalThis, 'location') as PropertyDescriptor;

describe('_wireCodecActive — env probe', () => {
	it('is false in this jsdom suite (no chrome-extension: origin)', () => {
		expect(_wireCodecActive()).toBe(false);
	});

	afterEach(() => {
		Object.defineProperty(globalThis, 'location', ORIGINAL_LOCATION_DESCRIPTOR);
	});

	it('is true under a chrome-extension: origin', () => {
		Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
		expect(_wireCodecActive()).toBe(true);
	});

	it('is false under a moz-extension: origin', () => {
		Object.defineProperty(globalThis, 'location', { value: { protocol: 'moz-extension:' }, configurable: true });
		expect(_wireCodecActive()).toBe(false);
	});
});

describe('needsWireEncoding', () => {
	it('is false for a plain JSON-safe nested payload', () => {
		expect(needsWireEncoding({ tiles: [{ url: 'a' }, { url: 'b' }], count: 2 })).toBe(false);
	});

	it('is false for primitives/null/undefined', () => {
		expect(needsWireEncoding(1)).toBe(false);
		expect(needsWireEncoding('x')).toBe(false);
		expect(needsWireEncoding(null)).toBe(false);
		expect(needsWireEncoding(undefined)).toBe(false);
	});

	it('is true for a bare Blob and a bare Map', () => {
		expect(needsWireEncoding(new Blob(['x']))).toBe(true);
		expect(needsWireEncoding(new Map())).toBe(true);
	});

	it('is true when a Blob is nested in an array inside an object', () => {
		expect(needsWireEncoding({ tiles: [{ image: new Blob(['x']) }] })).toBe(true);
	});

	it('is true when a Map is nested inside an array inside an object', () => {
		expect(needsWireEncoding({ wrapper: [new Map([['a', new Blob(['x'])]])] })).toBe(true);
	});
});

describe('encodeForWire / decodeFromWire — round trip', () => {
	it('round-trips a Blob (bytes + MIME type preserved)', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const blob = new Blob([bytes], { type: 'image/png' });

		const encoded = await encodeForWire(blob);
		expect(encoded).toHaveProperty('__ntt_blob');

		const decoded = decodeFromWire(encoded) as Blob;
		expect(decoded).toBeInstanceOf(Blob);
		expect(decoded.type).toBe('image/png');
		expect(Array.from(new Uint8Array(await decoded.arrayBuffer()))).toEqual(Array.from(bytes));
	});

	it('round-trips a File (name, type, lastModified preserved, instanceof File)', async () => {
		const bytes = new Uint8Array([9, 8, 7]);
		const file = new File([bytes], 'thumb.png', { type: 'image/png', lastModified: 12345 });

		const encoded = await encodeForWire(file);
		const decoded = decodeFromWire(encoded) as File;
		expect(decoded).toBeInstanceOf(File);
		expect(decoded.name).toBe('thumb.png');
		expect(decoded.type).toBe('image/png');
		expect(decoded.lastModified).toBe(12345);
		expect(Array.from(new Uint8Array(await decoded.arrayBuffer()))).toEqual(Array.from(bytes));
	});

	it('round-trips a Map of string -> Blob (the Thumbnails.get shape)', async () => {
		const map = new Map([
			['example.com', new Blob([new Uint8Array([1])], { type: 'image/png' })],
			['other.com', new Blob([new Uint8Array([2])], { type: 'image/png' })],
		]);

		const encoded = await encodeForWire(map);
		const decoded = decodeFromWire(encoded) as Map<string, Blob>;
		expect(decoded).toBeInstanceOf(Map);
		expect(decoded.size).toBe(2);
		expect(decoded.get('example.com')).toBeInstanceOf(Blob);
		expect(Array.from(new Uint8Array(await decoded.get('other.com')!.arrayBuffer()))).toEqual([2]);
	});

	it('round-trips a nested payload: {tiles: [{image: Blob}]}', async () => {
		const blob = new Blob([new Uint8Array([42])], { type: 'image/png' });
		const payload = { tiles: [{ url: 'a.com', image: blob }] };

		const encoded = await encodeForWire(payload);
		const decoded = decodeFromWire(encoded) as any;
		expect(decoded.tiles[0].url).toBe('a.com');
		expect(decoded.tiles[0].image).toBeInstanceOf(Blob);
		expect(Array.from(new Uint8Array(await decoded.tiles[0].image.arrayBuffer()))).toEqual([42]);
	});

	it('round-trips a Map inside an object inside an array', async () => {
		const payload = [{ thumbs: new Map([['x', new Blob([new Uint8Array([7])])]]) }];

		const encoded = await encodeForWire(payload);
		const decoded = decodeFromWire(encoded) as any;
		expect(decoded[0].thumbs).toBeInstanceOf(Map);
		expect(decoded[0].thumbs.get('x')).toBeInstanceOf(Blob);
	});

	it('round-trips an empty Blob', async () => {
		const blob = new Blob([], { type: 'text/plain' });
		const decoded = decodeFromWire(await encodeForWire(blob)) as Blob;
		expect(decoded).toBeInstanceOf(Blob);
		expect((await decoded.arrayBuffer()).byteLength).toBe(0);
	});

	it('round-trips an empty Map', async () => {
		const decoded = decodeFromWire(await encodeForWire(new Map())) as Map<unknown, unknown>;
		expect(decoded).toBeInstanceOf(Map);
		expect(decoded.size).toBe(0);
	});

	it('encodeForWire of a plain payload deep-equals it (no tags introduced)', async () => {
		const payload = { a: 1, b: { c: [1, 2, 3] }, d: null };
		expect(await encodeForWire(payload)).toEqual(payload);
	});

	it('decodeFromWire of primitives/null/undefined returns them unchanged', () => {
		expect(decodeFromWire(1)).toBe(1);
		expect(decodeFromWire('x')).toBe('x');
		expect(decodeFromWire(null)).toBe(null);
		expect(decodeFromWire(undefined)).toBe(undefined);
		expect(decodeFromWire(true)).toBe(true);
	});
});

describe('decodeFromWire — idempotence', () => {
	it('returns a real Blob instance untouched (same reference)', () => {
		const blob = new Blob(['x']);
		expect(decodeFromWire(blob)).toBe(blob);
	});

	it('returns a real Map instance (with Blob values) untouched (same reference)', () => {
		const map = new Map([['a', new Blob(['x'])]]);
		expect(decodeFromWire(map)).toBe(map);
	});

	it('double-decoding an encoded payload equals a single decode', async () => {
		const payload = { image: new Blob([new Uint8Array([1, 2])], { type: 'image/png' }) };
		const encoded = await encodeForWire(payload);
		const once = decodeFromWire(encoded) as any;
		const twice = decodeFromWire(once) as any;
		expect(twice.image).toBeInstanceOf(Blob);
		expect(twice.image).toBe(once.image);
	});
});

describe('decodeFromWire — malformed tags never throw', () => {
	it('returns {__ntt_blob: 42} unchanged (wrong-typed tag payload)', () => {
		const malformed = { __ntt_blob: 42 };
		expect(decodeFromWire(malformed)).toEqual(malformed);
	});

	it('returns {__ntt_map: \'nope\'} unchanged (wrong-typed tag payload)', () => {
		const malformed = { __ntt_map: 'nope' };
		expect(decodeFromWire(malformed)).toEqual(malformed);
	});

	it('returns {__ntt_blob: invalid-base64} unchanged instead of throwing', () => {
		const malformed = { __ntt_blob: '%%%not-base64%%%' };
		expect(() => decodeFromWire(malformed)).not.toThrow();
		expect(decodeFromWire(malformed)).toEqual(malformed);
	});

	it('returns {__ntt_map: [42]} unchanged (entries that are not [k, v] pairs)', () => {
		const malformed = { __ntt_map: [42] };
		expect(() => decodeFromWire(malformed)).not.toThrow();
		expect(decodeFromWire(malformed)).toEqual(malformed);
	});
});

describe('wrapRuntimeForWire — promise shape', () => {
	function makeFakeRuntime() {
		return {
			sendMessage: vi.fn((msg: unknown) => Promise.resolve(
				msg && typeof msg === 'object' && '__ntt_blob' in (msg as any)
					? { echo: true, __ntt_blob: (msg as any).__ntt_blob, type: (msg as any).type }
					: msg,
			)),
			onMessage: { addListener: vi.fn() },
			id: 'fake-id',
		};
	}

	it('passes a plain JSON-safe message through structurally unchanged, synchronously', () => {
		const runtime = makeFakeRuntime();
		const wrapped = wrapRuntimeForWire(runtime);
		wrapped.sendMessage({ name: 'Ping' });
		// The underlying sendMessage was already invoked before this
		// assertion runs — no microtask needed for the JSON-safe path.
		expect(runtime.sendMessage).toHaveBeenCalledWith({ name: 'Ping' });
	});

	it('encodes a File in the outgoing message before it reaches the underlying runtime', async () => {
		const runtime = makeFakeRuntime();
		const wrapped = wrapRuntimeForWire(runtime);
		await wrapped.sendMessage({ name: 'Import:restore', file: new File(['x'], 'a.zip') });

		const sentArg = runtime.sendMessage.mock.calls[0][0] as any;
		expect(sentArg.file).toHaveProperty('__ntt_blob');
	});

	it('resolves to a real Blob when the response carries a tagged payload (e.g. Thumbnails.get shape)', async () => {
		const runtime = {
			sendMessage: vi.fn(() => Promise.resolve({ __ntt_blob: 'eA==', type: 'image/png' })),
			onMessage: { addListener: vi.fn() },
		};
		const wrapped = wrapRuntimeForWire(runtime);
		const response = await wrapped.sendMessage({ name: 'Thumbnails.get' });
		expect(response).toBeInstanceOf(Blob);
	});

	it('delegates onMessage by the same reference', () => {
		const runtime = makeFakeRuntime();
		const wrapped = wrapRuntimeForWire(runtime);
		expect(wrapped.onMessage).toBe(runtime.onMessage);
	});

	it('non-sendMessage function properties stay callable and bound to the real runtime', () => {
		const runtime = {
			sendMessage: vi.fn(),
			onMessage: { addListener: vi.fn() },
			getURL(this: unknown, path: string) {
				// Probes `this` identity — the bound-function assertion.
				expect(this).toBe(runtime);
				return `chrome-extension://fake/${path}`;
			},
		};
		const wrapped = wrapRuntimeForWire(runtime);
		expect(wrapped.getURL('x.png')).toBe('chrome-extension://fake/x.png');
	});
});

describe('wrapRuntimeForWire — callback shape', () => {
	function makeFakeCallbackRuntime() {
		return {
			sendMessage: vi.fn((msg: unknown, cb: (response: unknown) => void) => {
				cb(msg && typeof msg === 'object' && '__ntt_blob' in (msg as any)
					? { __ntt_blob: (msg as any).__ntt_blob, type: (msg as any).type }
					: msg);
			}),
			onMessage: { addListener: vi.fn() },
		};
	}

	it('the user callback receives the decoded response', () => {
		const runtime = makeFakeCallbackRuntime();
		const wrapped = wrapRuntimeForWire(runtime);
		let received: unknown;
		wrapped.sendMessage({ name: 'Ping' }, (response: unknown) => { received = response; });
		expect(received).toEqual({ name: 'Ping' });
	});

	it('the callback fires synchronously inside the fake runtime\'s own callback invocation (runtime.lastError window)', () => {
		const runtime = makeFakeCallbackRuntime();
		const wrapped = wrapRuntimeForWire(runtime);
		const order: string[] = [];
		runtime.sendMessage.mockImplementationOnce((msg: unknown, cb: (response: unknown) => void) => {
			order.push('before-cb');
			cb(msg);
			order.push('after-cb');
		});
		wrapped.sendMessage({ name: 'Ping' }, () => { order.push('user-callback'); });
		expect(order).toEqual(['before-cb', 'user-callback', 'after-cb']);
	});
});

describe('wrapHandlerForWire', () => {
	it('decodes an incoming encoded message before the handler sees it', async () => {
		const handler = vi.fn((_msg: unknown, _sender: unknown, _sendResponse: (v: unknown) => void) => false);
		const wrapped = wrapHandlerForWire(handler);
		const encoded = await encodeForWire({ file: new File(['x'], 'a.zip') });

		wrapped(encoded, {}, () => {});

		const seenMessage = handler.mock.calls[0][0] as any;
		expect(seenMessage.file).toBeInstanceOf(File);
	});

	it('sends a JSON-safe response synchronously', () => {
		const handler = vi.fn((_msg: unknown, _sender: unknown, sendResponse: (v: unknown) => void) => {
			sendResponse({ ok: true });
			return false;
		});
		const wrapped = wrapHandlerForWire(handler);
		const sendResponse = vi.fn();

		wrapped({ name: 'Ping' }, {}, sendResponse);

		// Called before any awaited microtask — no `await` above this line.
		expect(sendResponse).toHaveBeenCalledWith({ ok: true });
	});

	it('encodes a Map/Blob response before it reaches sendResponse (after a tick)', async () => {
		const handler = vi.fn((_msg: unknown, _sender: unknown, sendResponse: (v: unknown) => void) => {
			sendResponse(new Map([['a', new Blob(['x'])]]));
			return true;
		});
		const wrapped = wrapHandlerForWire(handler);
		const sendResponse = vi.fn();

		wrapped({ name: 'Thumbnails.get' }, {}, sendResponse);
		expect(sendResponse).not.toHaveBeenCalled();

		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
		const responseArg = sendResponse.mock.calls[0][0];
		expect(responseArg).toHaveProperty('__ntt_map');
	});

	it('propagates the handler\'s boolean return value', () => {
		const trueHandler = vi.fn(() => true);
		const falseHandler = vi.fn(() => false);
		expect(wrapHandlerForWire(trueHandler)({}, {}, () => {})).toBe(true);
		expect(wrapHandlerForWire(falseHandler)({}, {}, () => {})).toBe(false);
	});
});
