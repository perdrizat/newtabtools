/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: lib/thumbnail-image.js's OffscreenCanvas (service-worker)
 * path, chrome-prep D2 slice 1.
 *
 * lib/thumbnail-image.js is the designated Chrome/service-worker swap seam
 * (see the module's own header comment): `resizeThumbnail`/`isBlank` use
 * `new Image()` + `document.createElement('canvas')`, neither of which
 * exists in a Chrome MV3 service worker. This adds a second implementation
 * behind a `typeof document === 'undefined'` runtime probe, using
 * `fetch(dataURL)` -> `.blob()` -> `createImageBitmap()` to decode and
 * `OffscreenCanvas`/`convertToBlob()` to encode.
 *
 * jsdom (this suite's test environment) always provides a real `document`,
 * so the probe itself can't be flipped from a test the way a genuine
 * service worker would flip it — there's no way to "hide" jsdom's document.
 * Instead, the module exports the SW-path implementations directly
 * (`_resizeThumbnailOffscreen`/`_isBlankOffscreen`) so they can be exercised
 * here with mocks installed on `globalThis`, independently of the probe.
 * The public `resizeThumbnail`/`isBlank` stay wired to the real probe, which
 * is why every OTHER thumbnail-image suite (auto-thumbnail.test.ts,
 * favicon-data-url.test.ts) keeps passing unmodified: in jsdom the probe is
 * always false, so those suites' `Image`/canvas mocks keep exercising the
 * exact same DOM code path as before this slice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	_isServiceWorkerScope,
	_resizeThumbnailOffscreen,
	_isBlankOffscreen,
	resizeThumbnail,
	isBlank,
} from '../../webextension/lib/thumbnail-image.js';

describe('_isServiceWorkerScope — env probe', () => {
	it('is false in this jsdom suite (a real `document` exists)', () => {
		expect(_isServiceWorkerScope()).toBe(false);
	});
});

describe('_resizeThumbnailOffscreen — service-worker resize path', () => {
	let mockBitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
	let mockCtx: { drawImage: ReturnType<typeof vi.fn> };
	let mockBlob: Blob;
	let realOffscreenCanvas: unknown;
	let realCreateImageBitmap: unknown;
	let realFetch: unknown;

	beforeEach(() => {
		realOffscreenCanvas = (globalThis as any).OffscreenCanvas;
		realCreateImageBitmap = (globalThis as any).createImageBitmap;
		realFetch = (globalThis as any).fetch;

		mockBitmap = { width: 800, height: 400, close: vi.fn() };
		mockBlob = new Blob(['fake-png-bytes'], { type: 'image/png' });
		mockCtx = { drawImage: vi.fn() };

		(globalThis as any).fetch = vi.fn(async () => ({
			blob: async () => new Blob(['source-bytes']),
		}));
		(globalThis as any).createImageBitmap = vi.fn(async () => mockBitmap);
		(globalThis as any).OffscreenCanvas = vi.fn(function(this: any, width: number, height: number) {
			this.width = width;
			this.height = height;
			this.getContext = vi.fn(() => mockCtx);
			this.convertToBlob = vi.fn(async () => mockBlob);
		});
	});

	afterEach(() => {
		(globalThis as any).OffscreenCanvas = realOffscreenCanvas;
		(globalThis as any).createImageBitmap = realCreateImageBitmap;
		(globalThis as any).fetch = realFetch;
	});

	it('decodes the data URL via fetch + createImageBitmap, not new Image()', async () => {
		await _resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400);
		expect((globalThis as any).fetch).toHaveBeenCalledWith('data:image/png;base64,AAAA');
		expect((globalThis as any).createImageBitmap).toHaveBeenCalled();
	});

	it('sizes the canvas to targetWidth x (scale * bitmap.height), matching the DOM sizing math', async () => {
		// bitmap 800x400, targetWidth 400 -> scale 0.5 -> height 200 (not
		// capped, since 200 < 400).
		await _resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400);
		expect((globalThis as any).OffscreenCanvas).toHaveBeenCalledWith(400, 200);
	});

	it('caps canvas height at targetWidth (never taller than wide), matching the DOM sizing math', async () => {
		// bitmap 400x1000, targetWidth 400 -> scale 1 -> height 1000, capped
		// down to 400 (Math.min(targetWidth, scale * height)).
		mockBitmap.width = 400;
		mockBitmap.height = 1000;
		await _resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400);
		expect((globalThis as any).OffscreenCanvas).toHaveBeenCalledWith(400, 400);
	});

	it('draws the bitmap onto the canvas at the computed size', async () => {
		await _resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400);
		expect(mockCtx.drawImage).toHaveBeenCalledWith(mockBitmap, 0, 0, 400, 200);
	});

	it('resolves with the Blob from convertToBlob()', async () => {
		const result = await _resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400);
		expect(result).toBe(mockBlob);
	});

	it('closes the bitmap after use', async () => {
		await _resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400);
		expect(mockBitmap.close).toHaveBeenCalled();
	});

	it('closes the bitmap even if convertToBlob rejects', async () => {
		(globalThis as any).OffscreenCanvas = vi.fn(function(this: any, width: number, height: number) {
			this.width = width;
			this.height = height;
			this.getContext = vi.fn(() => mockCtx);
			this.convertToBlob = vi.fn(async () => { throw new Error('encode failed'); });
		});
		await expect(_resizeThumbnailOffscreen('data:image/png;base64,AAAA', 400)).rejects.toThrow('encode failed');
		expect(mockBitmap.close).toHaveBeenCalled();
	});
});

describe('_isBlankOffscreen — service-worker blankness detection', () => {
	let mockBitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
	let mockCtx: { drawImage: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> };
	let realOffscreenCanvas: unknown;
	let realCreateImageBitmap: unknown;
	let realFetch: unknown;

	beforeEach(() => {
		realOffscreenCanvas = (globalThis as any).OffscreenCanvas;
		realCreateImageBitmap = (globalThis as any).createImageBitmap;
		realFetch = (globalThis as any).fetch;

		mockBitmap = { width: 50, height: 50, close: vi.fn() };
		(globalThis as any).fetch = vi.fn(async () => ({
			blob: async () => new Blob(['source-bytes']),
		}));
		(globalThis as any).createImageBitmap = vi.fn(async () => mockBitmap);
	});

	afterEach(() => {
		(globalThis as any).OffscreenCanvas = realOffscreenCanvas;
		(globalThis as any).createImageBitmap = realCreateImageBitmap;
		(globalThis as any).fetch = realFetch;
	});

	function installCanvasWithData(data: Uint8ClampedArray) {
		mockCtx = {
			drawImage: vi.fn(),
			getImageData: vi.fn(() => ({ data })),
		};
		(globalThis as any).OffscreenCanvas = vi.fn(function(this: any, width: number, height: number) {
			this.width = width;
			this.height = height;
			this.getContext = vi.fn(() => mockCtx);
		});
	}

	it('uses a 50x50 OffscreenCanvas', async () => {
		installCanvasWithData(new Uint8ClampedArray(50 * 50 * 4));
		await _isBlankOffscreen('data:image/png;base64,AAAA');
		expect((globalThis as any).OffscreenCanvas).toHaveBeenCalledWith(50, 50);
	});

	it('resolves true when >97% of sampled pixels match the dominant color', async () => {
		const data = new Uint8ClampedArray(50 * 50 * 4);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = 10; data[i + 1] = 20; data[i + 2] = 30; data[i + 3] = 255;
		}
		installCanvasWithData(data);
		await expect(_isBlankOffscreen('data:image/png;base64,AAAA')).resolves.toBe(true);
	});

	it('resolves false when pixels vary beyond the tolerance/threshold', async () => {
		const data = new Uint8ClampedArray(50 * 50 * 4);
		for (let i = 0; i < data.length; i += 4) {
			// Every pixel a different color -> far below the 97% dominant-color
			// threshold.
			data[i] = (i * 7) % 256;
			data[i + 1] = (i * 13) % 256;
			data[i + 2] = (i * 19) % 256;
			data[i + 3] = 255;
		}
		installCanvasWithData(data);
		await expect(_isBlankOffscreen('data:image/png;base64,AAAA')).resolves.toBe(false);
	});

	it('closes the bitmap after use', async () => {
		installCanvasWithData(new Uint8ClampedArray(50 * 50 * 4));
		await _isBlankOffscreen('data:image/png;base64,AAAA');
		expect(mockBitmap.close).toHaveBeenCalled();
	});

	it('treats decode failure as blank (mirrors the DOM path\'s img.onerror -> true)', async () => {
		(globalThis as any).fetch = vi.fn(async () => { throw new Error('decode failed'); });
		await expect(_isBlankOffscreen('data:image/png;base64,AAAA')).resolves.toBe(true);
	});
});

describe('public resizeThumbnail/isBlank — stay on the DOM path in this jsdom suite', () => {
	// The public exports are driven by the REAL probe (_isServiceWorkerScope),
	// which is false whenever a real `document` exists — true for every fast-
	// tier suite. This proves the dispatch doesn't reach into the SW-only
	// globals at all under that condition, so the existing DOM-path suites
	// (auto-thumbnail.test.ts, favicon-data-url.test.ts) are exercising the
	// exact same code as before this slice.
	let fetchSpy: ReturnType<typeof vi.fn>;
	let createImageBitmapSpy: ReturnType<typeof vi.fn>;
	let realImage: unknown;
	let realCreateElement: typeof document.createElement;

	beforeEach(() => {
		fetchSpy = vi.fn();
		createImageBitmapSpy = vi.fn();
		(globalThis as any).fetch = fetchSpy;
		(globalThis as any).createImageBitmap = createImageBitmapSpy;

		realImage = (globalThis as any).Image;
		realCreateElement = document.createElement.bind(document);

		const mockCanvas = {
			width: 0,
			height: 0,
			getContext: () => ({
				drawImage: vi.fn(),
				getImageData: () => ({ data: new Uint8ClampedArray(50 * 50 * 4) }),
			}),
			toBlob: (cb: (b: Blob) => void) => cb(new Blob(['dom-blob'])),
		};
		document.createElement = vi.fn((tag: string) => {
			if (tag === 'canvas') { return mockCanvas as any; }
			return realCreateElement(tag);
		}) as any;

		(globalThis as any).Image = class MockImage {
			onload: (() => void) | null = null;
			width = 200;
			height = 100;
			set src(_v: string) { queueMicrotask(() => this.onload && this.onload()); }
		};
	});

	afterEach(() => {
		(globalThis as any).Image = realImage;
		document.createElement = realCreateElement;
	});

	it('resizeThumbnail never calls fetch/createImageBitmap (DOM path only)', async () => {
		await resizeThumbnail('data:image/png;base64,AAAA', 100);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(createImageBitmapSpy).not.toHaveBeenCalled();
	});

	it('isBlank never calls fetch/createImageBitmap (DOM path only)', async () => {
		await isBlank('data:image/png;base64,AAAA');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(createImageBitmapSpy).not.toHaveBeenCalled();
	});
});
