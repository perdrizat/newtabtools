/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Thumbnail image processing (MODERNIZATION.md, Stage M, slice M3).
 *
 * `resizeThumbnail`/`isBlank`/`dataURLtoBlob`, carved out of background.js
 * verbatim. The Firefox implementation keeps the DOM `Image`/canvas approach
 * (standing directive: Firefox event pages retain full DOM access, unlike an
 * MV3 service worker).
 *
 * THIS MODULE BOUNDARY IS THE CHROME/STAGE-3 SEAM: a service-worker build (no
 * DOM, no `Image`/`document.createElement('canvas')`) swaps this one file for
 * an `OffscreenCanvas`/`createImageBitmap` implementation with the same three
 * exports — the MV3 backlog's "OffscreenCanvas for Chrome" item folds into
 * this file as a documented seam rather than an implementation. Callers
 * (lib/capture.js) import these by name and must never know which
 * implementation they're getting.
 */

/**
 * Resize a data URL image to a target width via canvas, preserving aspect
 * ratio (capped so height never exceeds targetWidth either).
 * @param {string} dataURL
 * @param {number} targetWidth
 * @returns {Promise<Blob>}
 */
export function resizeThumbnail(dataURL, targetWidth) {
	return new Promise(function(resolve) {
		let img = new Image();
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
 * Detect if a screenshot is blank (single-color).
 * Decodes onto a 50×50 canvas, samples all pixels.
 * Returns Promise<boolean>: true if >97% of pixels share the dominant color.
 * @param {string} dataURL
 * @returns {Promise<boolean>}
 */
export function isBlank(dataURL) {
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
			let totalPixels = size * size;

			// Find dominant color (first pixel as seed).
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
			resolve(ratio > 0.97);
		};
		img.onerror = function() {
			resolve(true); // Treat decode failures as blank.
		};
		img.src = dataURL;
	});
}
