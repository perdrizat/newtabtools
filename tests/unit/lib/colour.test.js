/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { parseColour } from '../../../webextension/lib/colour.js';

// Mode B characterization tests for parseColour, extracted from
// webextension/newTab.js. These capture the function's *current* behaviour
// bug-for-bug; any deliberate change must update the matching test.

describe('parseColour', () => {
	describe('rgb() and rgba()', () => {
		it('parses rgb() with whitespace after commas', () => {
			expect(parseColour('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
		});

		it('parses rgb() with no whitespace', () => {
			expect(parseColour('rgb(255,255,255)')).toEqual({ r: 255, g: 255, b: 255 });
		});

		it('parses rgba() and ignores the alpha channel', () => {
			expect(parseColour('rgba(255, 0, 0, 0.5)')).toEqual({ r: 255, g: 0, b: 0 });
		});
	});

	describe('hsl() and hsla()', () => {
		it('parses pure red as hsl(0, 100%, 50%)', () => {
			expect(parseColour('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
		});

		it('parses pure green as hsl(120, 100%, 50%)', () => {
			expect(parseColour('hsl(120, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 0 });
		});

		it('parses pure blue as hsl(240, 100%, 50%)', () => {
			expect(parseColour('hsl(240, 100%, 50%)')).toEqual({ r: 0, g: 0, b: 255 });
		});

		it('parses zero saturation as a grey at the given lightness', () => {
			expect(parseColour('hsl(0, 0%, 50%)')).toEqual({ r: 128, g: 128, b: 128 });
		});

		it('parses hsla() and ignores the alpha channel', () => {
			expect(parseColour('hsla(0, 0%, 0%, 0.5)')).toEqual({ r: 0, g: 0, b: 0 });
		});
	});

	describe('6-character hex (#rrggbb)', () => {
		it('parses lowercase 6-char hex', () => {
			expect(parseColour('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
			expect(parseColour('#aabbcc')).toEqual({ r: 170, g: 187, b: 204 });
		});

		it('is case-insensitive', () => {
			expect(parseColour('#FF00FF')).toEqual({ r: 255, g: 0, b: 255 });
		});

		it('characterizes: trailing characters after the 6 hex digits are silently ignored', () => {
			// The 6-char regex has no $ anchor, so '#ff0000xyz' matches and the
			// trailing characters are dropped. Captured here so any future
			// tightening of the regex is an intentional behaviour change.
			expect(parseColour('#ff0000xyz')).toEqual({ r: 255, g: 0, b: 0 });
		});
	});

	describe('3- and 4-character hex (#rgb / #rgba)', () => {
		it('expands 3-char hex by doubling each nibble', () => {
			expect(parseColour('#f00')).toEqual({ r: 255, g: 0, b: 0 });
			expect(parseColour('#abc')).toEqual({ r: 170, g: 187, b: 204 });
		});

		it('parses 4-char hex and ignores the alpha nibble', () => {
			expect(parseColour('#abcd')).toEqual({ r: 170, g: 187, b: 204 });
		});

		it('rejects strings of any other length (the 3/4-char regex is anchored)', () => {
			expect(parseColour('#abcde')).toBeNull();
		});
	});

	describe('invalid input', () => {
		it('returns null for the empty string', () => {
			expect(parseColour('')).toBeNull();
		});

		it('returns null for non-colour strings', () => {
			expect(parseColour('not a colour')).toBeNull();
			expect(parseColour('blue')).toBeNull();
		});
	});
});
