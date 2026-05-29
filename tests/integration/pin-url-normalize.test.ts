/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression tests for the URL normaliser. The bug: typing `example.com`
 * into the Pin URL form left the button disabled silently because
 * `<input type="url">` validity-checks the protocol. `normalizePinURL`
 * auto-prepends `https://` when the input lacks a protocol so the
 * common case works, and the same helper is used by `set URL` in the
 * per-tile editor.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) { throw new Error(`${methodName} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('normalizePinURL', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const normalize = extractMethod(source, 'normalizePinURL');
		const code = `var _urlHarness = { ${normalize} };`;
		vm.runInThisContext(code, { filename: 'normalize-harness.js' });
		harness = (globalThis as any)._urlHarness;
	});

	it('prepends https:// to a bare domain', () => {
		expect(harness.normalizePinURL('example.com')).toBe('https://example.com');
	});

	it('prepends https:// to a domain with a path', () => {
		expect(harness.normalizePinURL('example.com/foo/bar')).toBe('https://example.com/foo/bar');
	});

	it('preserves https:// when already present', () => {
		expect(harness.normalizePinURL('https://example.com')).toBe('https://example.com');
	});

	it('preserves http:// (does not upgrade)', () => {
		expect(harness.normalizePinURL('http://example.com')).toBe('http://example.com');
	});

	it('preserves ftp:// for the same reason', () => {
		expect(harness.normalizePinURL('ftp://files.example.com/')).toBe('ftp://files.example.com/');
	});

	it('trims surrounding whitespace before normalising', () => {
		expect(harness.normalizePinURL('   example.com   ')).toBe('https://example.com');
	});

	it('returns empty string for empty/whitespace-only input', () => {
		expect(harness.normalizePinURL('')).toBe('');
		expect(harness.normalizePinURL('   ')).toBe('');
		expect(harness.normalizePinURL(null as any)).toBe('');
		expect(harness.normalizePinURL(undefined as any)).toBe('');
	});

	it('handles uncommon-but-valid protocols (e.g. file://) without mangling them', () => {
		// Anything matching `^[a-z][a-z0-9+.-]*:` is considered already-prefixed.
		expect(harness.normalizePinURL('file:///tmp/foo')).toBe('file:///tmp/foo');
	});
});
