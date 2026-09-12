/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `Drag._setDragData` (drag-drop.js) — HTML escaping of the `text/html` flavour.
 *
 * The dragged URL is interpolated into an `<a href="…">…</a>` string, so every
 * one of `&`, `"`, `<`, `>` must be escaped, and `&` must be escaped first or
 * the entities produced by the later replacements get double-escaped.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ensureSiteEnv } from './_helpers';

let Drag: any;

/** Capture the `text/html` payload `_setDragData` writes for a given URL. */
function htmlFlavourFor(url: string, title = 'T'): string {
	const data: Record<string, string> = {};
	const dt = {
		setData: (type: string, value: string) => {
			data[type] = value;
		},
		setDragImage: vi.fn(),
		effectAllowed: '',
	};
	Drag._setDragData({ url, title }, { dataTransfer: dt });
	return data['text/html'];
}

beforeAll(async () => {
	await ensureSiteEnv();
	const scrollbox = document.createElement('div');
	scrollbox.id = 'newtab-scrollbox';
	document.body.appendChild(scrollbox);
	Drag = (await import('../../webextension/drag-drop.js')).Drag;
});

describe('Drag._setDragData — text/html escaping', () => {
	it('escapes a double quote', () => {
		const html = htmlFlavourFor('https://example.com/?q="x"');
		expect(html).toContain('&quot;');
		expect(html).not.toMatch(/href="[^"]*"[^>]*"/);
	});

	it('escapes angle brackets', () => {
		const html = htmlFlavourFor('https://example.com/<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('<script>');
	});

	it('escapes a bare ampersand', () => {
		const html = htmlFlavourFor('https://example.com/?a=1&b=2');
		expect(html).toContain('a=1&amp;b=2');
	});

	it('escapes & before the other entities, so nothing is double-escaped', () => {
		const html = htmlFlavourFor('https://example.com/?q=<a>&b="c"');
		expect(html).not.toContain('&amp;lt;');
		expect(html).not.toContain('&amp;quot;');
		expect(html).toContain('&lt;a&gt;&amp;b=&quot;c&quot;');
	});

	it('escapes a URL needing only one of the four characters', () => {
		// A URL with a quote but no ampersand still has to be escaped — the
		// condition guarding this must not require several characters at once.
		const html = htmlFlavourFor('https://example.com/?q="only"');
		expect(html).toContain('&quot;only&quot;');
	});
});
