/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Extracted from webextension/newTab.js (parseColour, ~line 540).
// Behaviour is preserved bug-for-bug; see tests/unit/lib/colour.test.js.

function hue2rgb(p, q, t) {
	if (t < 0) {
		t += 1;
	}
	if (t > 1) {
		t -= 1;
	}
	if (t < 1 / 6) {
		return p + (q - p) * 6 * t;
	}
	if (t < 1 / 2) {
		return q;
	}
	if (t < 2 / 3) {
		return p + (q - p) * (2 / 3 - t) * 6;
	}
	return p;
}

export function parseColour(str) {
	let parts = /^(hsl|rgb)a?\((\d+),\s*([\d.]+%?),\s*([\d.]+%?)/.exec(str);
	if (parts && parts[1] == 'rgb') {
		return {
			r: parseInt(parts[2], 10),
			g: parseInt(parts[3], 10),
			b: parseInt(parts[4], 10),
		};
	}

	if (parts && parts[1] == 'hsl') {
		let h = parseFloat(parts[2]) / 360;
		let s = parseFloat(parts[3]) / 100;
		let l = parseFloat(parts[4]) / 100;
		let r, g, b;

		if (s == 0) {
			r = g = b = l;
		} else {
			let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			let p = 2 * l - q;
			r = hue2rgb(p, q, h + 1 / 3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1 / 3);
		}

		return {
			r: Math.round(r * 255),
			g: Math.round(g * 255),
			b: Math.round(b * 255),
		};
	}

	parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(str);
	if (parts) {
		return {
			r: parseInt(parts[1], 16),
			g: parseInt(parts[2], 16),
			b: parseInt(parts[3], 16),
		};
	}

	parts = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(str);
	if (parts) {
		return {
			r: parseInt(parts[1].repeat(2), 16),
			g: parseInt(parts[2].repeat(2), 16),
			b: parseInt(parts[3].repeat(2), 16),
		};
	}

	return null;
}
