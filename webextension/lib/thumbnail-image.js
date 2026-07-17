/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Thumbnail image processing (MODERNIZATION.md, Stage M, slice M3;
 * CHROME.md D2 slice 1).
 *
 * `resizeThumbnail`/`isBlank`/`dataURLtoBlob`, carved out of background.js
 * verbatim. Firefox event pages retain full DOM access (standing directive),
 * so the DOM `Image`/canvas implementation stays exactly as it was; a Chrome
 * MV3 service worker has neither `document` nor `Image`, so `resizeThumbnail`
 * and `isBlank` each dispatch — via the `_isServiceWorkerScope` runtime probe
 * — to a second `fetch`/`createImageBitmap`/`OffscreenCanvas` implementation
 * that applies the identical sizing/sampling math. Callers (lib/capture.js)
 * import `resizeThumbnail`/`isBlank`/`dataURLtoBlob` by name and never know
 * which of the two implementations underlies them; Firefox always resolves
 * to the DOM path, unchanged by this seam.
 */

/**
 * Runtime probe selecting the DOM (`Image`/`<canvas>`) implementation vs. the
 * service-worker (`fetch`/`createImageBitmap`/`OffscreenCanvas`)
 * implementation below. `document` never exists in a Chrome MV3 service
 * worker; a Firefox event page always has one (standing directive — see
 * this module's header comment). Exported so tests can assert the probe's
 * own value directly; jsdom always provides a real `document`, so tests
 * exercise the two implementations (`_resizeThumbnailOffscreen`/
 * `_isBlankOffscreen`) directly instead of trying to flip this probe.
 * @returns {boolean}
 */
export function _isServiceWorkerScope() {
	return typeof document === 'undefined';
}

/**
 * Shared pixel-analysis for blankness detection, used by both the DOM and
 * service-worker `isBlank` implementations: find the dominant color (first
 * pixel as seed) and return whether it covers >97% of sampled pixels.
 * @param {Uint8ClampedArray} data - RGBA pixel data (canvas/OffscreenCanvas
 *   `getImageData().data`)
 * @param {number} totalPixels
 * @returns {boolean}
 */
function _dominantColorRatioAboveThreshold(data, totalPixels) {
	let dr = data[0], dg = data[1], db = data[2];
	let matchCount = 0;
	let tolerance = 5;

	for (let i = 0; i < data.length; i += 4) {
		if (Math.abs(data[i] - dr) <= tolerance &&
			Math.abs(data[i + 1] - dg) <= tolerance &&
			Math.abs(data[i + 2] - db) <= tolerance) {
			matchCount++;
		}
	}

	let ratio = matchCount / totalPixels;
	return ratio > 0.97;
}

/**
 * DOM (`Image`/`<canvas>`) implementation of resizeThumbnail — verbatim,
 * unchanged by this seam.
 * @param {string} dataURL
 * @param {number} targetWidth
 * @returns {Promise<Blob>}
 */
function _resizeThumbnailDOM(dataURL, targetWidth) {
	return new Promise(function(resolve, reject) {
		let img = new Image();
		// An undecodable dataURL would otherwise leave this promise pending
		// forever (audit 2026-07-16 m8) — the SW path already rejects.
		img.onerror = function() {
			reject(new Error('resizeThumbnail: image failed to decode'));
		};
		img.onload = function() {
			let scale = targetWidth / img.width;
			let canvas = document.createElement('canvas');
			canvas.width = targetWidth;
			canvas.height = Math.min(targetWidth, scale * img.height);
			// getContext('2d') on a real canvas never returns null; cast documents
			// the invariant instead of adding a dead-code null guard.
			let ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			canvas.toBlob(function(blob) {
				// Same invariant: a real canvas.toBlob() always yields a Blob here.
				resolve(/** @type {Blob} */ (blob));
			});
		};
		img.src = dataURL;
	});
}

/**
 * Service-worker (`dataURLtoBlob`/`createImageBitmap`/`OffscreenCanvas`)
 * implementation of resizeThumbnail — same sizing math as
 * `_resizeThumbnailDOM` (targetWidth wide, height scaled to preserve aspect
 * ratio and capped at targetWidth), decoded without `Image`/`document`.
 * Exported so tests can call it directly with mocks installed on
 * `globalThis` (see this module's `_isServiceWorkerScope` doc comment).
 *
 * CHROME.md D3 slice 3 finding (2026-07-16, real Chrome): this used to decode
 * via `fetch(dataURL)` — the manifest CSP's `connect-src` has no `data:`
 * entry (see `dataURLtoBlob`'s own doc comment, written for exactly this
 * constraint), so `fetch('data:...')` threw `TypeError: Failed to fetch` in
 * the real service worker, breaking every real Chrome capture. Reuses
 * `dataURLtoBlob()`'s manual decode instead — no network/fetch involved.
 * @param {string} dataURL
 * @param {number} targetWidth
 * @returns {Promise<Blob>}
 */
export async function _resizeThumbnailOffscreen(dataURL, targetWidth) {
	let sourceBlob = dataURLtoBlob(dataURL);
	if (!sourceBlob) {
		throw new Error('_resizeThumbnailOffscreen: malformed data URL');
	}
	let bitmap = await createImageBitmap(sourceBlob);
	try {
		let scale = targetWidth / bitmap.width;
		let canvas = new OffscreenCanvas(targetWidth, Math.min(targetWidth, scale * bitmap.height));
		// getContext('2d') on a real OffscreenCanvas never returns null; cast
		// documents the invariant, mirroring `_resizeThumbnailDOM`'s cast.
		let ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		return await canvas.convertToBlob();
	} finally {
		bitmap.close();
	}
}

/**
 * Resize a data URL image to a target width, preserving aspect ratio (capped
 * so height never exceeds targetWidth either). Dispatches to the DOM or
 * service-worker implementation per `_isServiceWorkerScope`.
 * @param {string} dataURL
 * @param {number} targetWidth
 * @returns {Promise<Blob>}
 */
export function resizeThumbnail(dataURL, targetWidth) {
	return _isServiceWorkerScope()
		? _resizeThumbnailOffscreen(dataURL, targetWidth)
		: _resizeThumbnailDOM(dataURL, targetWidth);
}

/**
 * Decode a `data:` URL into a Blob without going through `fetch`.
 * The manifest CSP is `connect-src 'self' https://firefox.settings.services.mozilla.com`
 * (no wildcard — see audit/2026-05-31-csp-tightening.md), which blocks
 * `fetch('data:…')`. Many sites (Mozilla properties, Wikipedia, SPAs) inline
 * their favicon as a data URL, so we decode in-process. Returns `null` for
 * malformed input.
 * @param {string} dataURL
 * @returns {Blob|null}
 */
export function dataURLtoBlob(dataURL) {
	let m = /^data:([^,;]*)(;base64)?,(.*)$/.exec(dataURL);
	if (!m) {
		return null;
	}
	let mime = m[1] || 'application/octet-stream';
	let isBase64 = !!m[2];
	let payload = m[3];
	let bytes;
	try {
		let binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
	} catch (ex) {
		return null;
	}
	return new Blob([bytes], { type: mime });
}

/**
 * DOM (`Image`/`<canvas>`) implementation of isBlank — verbatim, unchanged
 * by this seam. Decodes onto a 50×50 canvas, samples all pixels via
 * `_dominantColorRatioAboveThreshold`.
 * @param {string} dataURL
 * @returns {Promise<boolean>}
 */
function _isBlankDOM(dataURL) {
	return new Promise(function(resolve) {
		let img = new Image();
		img.onload = function() {
			let size = 50;
			let canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			// getContext('2d') on a real canvas never returns null; cast documents
			// the invariant instead of adding a dead-code null guard.
			let ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
			ctx.drawImage(img, 0, 0, size, size);
			let data = ctx.getImageData(0, 0, size, size).data;
			resolve(_dominantColorRatioAboveThreshold(data, size * size));
		};
		img.onerror = function() {
			resolve(true); // Treat decode failures as blank.
		};
		img.src = dataURL;
	});
}

/**
 * Service-worker (`dataURLtoBlob`/`createImageBitmap`/`OffscreenCanvas`)
 * implementation of isBlank — decodes onto a 50×50 OffscreenCanvas, samples
 * via the same `_dominantColorRatioAboveThreshold` helper as
 * `_isBlankDOM`, so both paths apply identical sampling/threshold logic.
 * Exported so tests can call it directly with mocks installed on
 * `globalThis` (see this module's `_isServiceWorkerScope` doc comment).
 *
 * CHROME.md D3 slice 3 finding (2026-07-16): see `_resizeThumbnailOffscreen`'s
 * doc comment — this decoded via `fetch(dataURL)` too, equally broken by the
 * manifest CSP's `data:`-less `connect-src` on real Chrome. Same fix: reuse
 * `dataURLtoBlob()`.
 * @param {string} dataURL
 * @returns {Promise<boolean>}
 */
export async function _isBlankOffscreen(dataURL) {
	try {
		let sourceBlob = dataURLtoBlob(dataURL);
		if (!sourceBlob) {
			throw new Error('_isBlankOffscreen: malformed data URL');
		}
		let bitmap = await createImageBitmap(sourceBlob);
		try {
			let size = 50;
			let canvas = new OffscreenCanvas(size, size);
			// getContext('2d') on a real OffscreenCanvas never returns null; cast
			// documents the invariant, mirroring `_isBlankDOM`'s cast.
			let ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
			ctx.drawImage(bitmap, 0, 0, size, size);
			let data = ctx.getImageData(0, 0, size, size).data;
			return _dominantColorRatioAboveThreshold(data, size * size);
		} finally {
			bitmap.close();
		}
	} catch (ex) {
		return true; // Treat decode failures as blank (mirrors _isBlankDOM's img.onerror).
	}
}

/**
 * Detect if a screenshot is blank (single-color). Returns Promise<boolean>:
 * true if >97% of pixels share the dominant color. Dispatches to the DOM or
 * service-worker implementation per `_isServiceWorkerScope`.
 * @param {string} dataURL
 * @returns {Promise<boolean>}
 */
export function isBlank(dataURL) {
	return _isServiceWorkerScope() ? _isBlankOffscreen(dataURL) : _isBlankDOM(dataURL);
}
