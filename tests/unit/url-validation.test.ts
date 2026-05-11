/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Characterization of `newTabTools.isValidURL` (newTab.js:13-18).
 * Phase 1 slot 2 of the migration plan (MIGRATION.md).
 *
 * This function is the ONLY URL scheme validation in the codebase. It gates
 * the pin-URL input and favicon URL filtering — but critically NOT the tile
 * render path (`addTitle` sets href unsanitized; see the companion
 * Integration test at tests/integration/tile-url-render.test.ts).
 *
 * This inline copy matches the source as of 2026-05-05. When the function
 * is extracted to webextension/lib/ in Phase 2, this test will import from
 * there instead.
 */

import { describe, it, expect } from 'vitest';

// Inline copy of newTabTools.isValidURL (newTab.js:13-18).
function isValidURL(url: string): boolean {
	try {
		return ['ftp:', 'http:', 'https:'].includes(new URL(url).protocol);
	} catch {
		return false;
	}
}

describe('isValidURL — URL scheme whitelist (newTab.js:13-18)', () => {
	describe('accepted schemes', () => {
		it('accepts http:', () => expect(isValidURL('http://example.com')).toBe(true));
		it('accepts https:', () => expect(isValidURL('https://example.com')).toBe(true));
		it('accepts ftp:', () => expect(isValidURL('ftp://files.example.com')).toBe(true));
	});

	describe('rejected schemes (not in whitelist)', () => {
		it('rejects javascript:', () => expect(isValidURL('javascript:alert(1)')).toBe(false));
		it('rejects data:', () => expect(isValidURL('data:text/html,hi')).toBe(false));
		it('rejects moz-extension:', () => expect(isValidURL('moz-extension://uuid/page.html')).toBe(false));
		it('rejects chrome:', () => expect(isValidURL('chrome://settings')).toBe(false));
		it('rejects file:', () => expect(isValidURL('file:///etc/passwd')).toBe(false));
		it('rejects blob:', () => expect(isValidURL('blob:http://example.com/uuid')).toBe(false));
		it('rejects chrome-extension:', () => expect(isValidURL('chrome-extension://id/page.html')).toBe(false));
		it('rejects about:', () => expect(isValidURL('about:blank')).toBe(false));
	});

	describe('edge cases', () => {
		it('rejects empty string (URL constructor throws)', () => expect(isValidURL('')).toBe(false));
		it('rejects plain text (not a URL)', () => expect(isValidURL('not a url')).toBe(false));
		it('rejects bare hostname (no scheme)', () => expect(isValidURL('example.com')).toBe(false));
	});
});
