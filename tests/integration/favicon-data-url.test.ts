/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: `fetchFaviconBlob` must handle `data:` URLs without
 * calling `fetch()`.
 *
 * Many sites (Mozilla properties, Wikipedia, lots of SPAs) inline their
 * favicon as a base64- or percent-encoded `data:` URL in their
 * `<link rel="icon">`. `tab.favIconUrl` then carries that data URL straight
 * through to the background script. Calling `fetch(dataURL)` counts as a
 * `connect-src` operation under the manifest CSP and the browser blocks it
 * with:
 *
 *   Content-Security-Policy: The page's settings blocked the loading of a
 *   resource (connect-src) at data:image/svg+xml;base64,…
 *
 * Result: every CSP-blocked favicon was silently dropped and the tile kept
 * its letter glyph. The fix decodes `data:` URLs directly into a Blob
 * (base64 via `atob`, otherwise `decodeURIComponent`) and only routes
 * `http(s):` URLs through `fetch`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG_PATH = path.resolve(__dirname, '../../webextension/background.js');

function extractFunction(source: string, name: string): string {
	// Top-level function declarations are at column 0.
	const sig = new RegExp(`^function\\s+${name}\\s*\\(`, 'm');
	const match = source.match(sig);
	if (!match || match.index === undefined) { throw new Error(`${name} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('fetchFaviconBlob — data: URL handling (CSP-safe)', () => {
	let fetchFaviconBlob: (url: string | null) => Promise<Blob | null>;
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading top-level function for behavioral test
		const source = fs.readFileSync(BG_PATH, 'utf8');
		const fnBody = extractFunction(source, 'fetchFaviconBlob');
		// Also pull `dataURLtoBlob` if it exists yet (red on first run).
		let helperBody = '';
		try {
			helperBody = extractFunction(source, 'dataURLtoBlob');
		} catch { /* will surface as missing global in test */ }
		fetchSpy = vi.fn();
		const sandbox: any = {
			fetch: fetchSpy,
			atob: globalThis.atob,
			Blob: globalThis.Blob,
			Uint8Array: globalThis.Uint8Array,
			Promise: globalThis.Promise,
			decodeURIComponent: globalThis.decodeURIComponent,
		};
		vm.createContext(sandbox);
		vm.runInContext(`${helperBody}\n${fnBody}\nthis.__fetchFaviconBlob = fetchFaviconBlob;`, sandbox);
		fetchFaviconBlob = sandbox.__fetchFaviconBlob;
	});

	beforeEach(() => {
		fetchSpy.mockReset();
	});

	it('decodes a base64 data: URL into a Blob without calling fetch()', async () => {
		// A 1x1 transparent PNG — valid PNG bytes, base64-encoded.
		const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
		const blob = await fetchFaviconBlob(png);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob!.size).toBeGreaterThan(0);
		expect(blob!.type).toBe('image/png');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('decodes a non-base64 (percent-encoded) data: URL into a Blob without fetch()', async () => {
		// Inline SVG favicons are often plain URI-encoded, no base64.
		const svg = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
		const blob = await fetchFaviconBlob(svg);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob!.size).toBeGreaterThan(0);
		expect(blob!.type).toBe('image/svg+xml');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('routes http:/https: URLs through fetch()', async () => {
		fetchSpy.mockResolvedValueOnce({
			ok: true,
			blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
		});
		const blob = await fetchFaviconBlob('https://example.com/favicon.ico');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledWith('https://example.com/favicon.ico');
		expect(blob).toBeInstanceOf(Blob);
	});

	it('returns null for malformed data: URLs (no comma)', async () => {
		const blob = await fetchFaviconBlob('data:image/png;base64');
		expect(blob).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns null when the decoded data: payload exceeds the 64 KB cap', async () => {
		// Build a base64-encoded payload above the cap. 64 KB = 65536 raw
		// bytes ≈ 87381 base64 chars. Pad to comfortably exceed.
		const oversized = 'A'.repeat(100_000);
		const blob = await fetchFaviconBlob(`data:image/png;base64,${oversized}`);
		expect(blob).toBeNull();
	});

	it('still returns null for empty/null input', async () => {
		expect(await fetchFaviconBlob(null)).toBeNull();
		expect(await fetchFaviconBlob('')).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('manifest CSP — connect-src permits third-party HTTPS for favicon fetch', () => {
	// `tab.favIconUrl` for most real sites is a plain `https://…/favicon.ico`.
	// The manifest CSP used to read `connect-src 'self' https://firefox.settings…`
	// which blocked every other host — so the data-URL branch above was only
	// half the bug. With `connect-src https:` added, third-party favicons go
	// through the normal fetch path; <all_urls> already grants the host
	// permission, so this is just unblocking the redundant CSP.

	let manifest: { content_security_policy: string };

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSP guard
		const raw = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/manifest.json'),
			'utf8'
		);
		manifest = JSON.parse(raw);
	});

	it('connect-src includes the https: scheme', () => {
		const csp = manifest.content_security_policy;
		expect(csp).toMatch(/connect-src[^;]*\bhttps:/);
	});

	it('connect-src still includes self', () => {
		const csp = manifest.content_security_policy;
		expect(csp).toMatch(/connect-src[^;]*'self'/);
	});
});
