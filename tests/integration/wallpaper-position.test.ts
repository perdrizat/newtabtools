/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Firefox's `newtab-wallpapers-v2` Remote Settings collection exposes a
 * `background_position` field on roughly a third of its records ("top left",
 * "bottom center", "center right", …). The remainder default to
 * `center center`. Some "solid-colors" records carry a `solid_color` hex
 * instead of an attachment.
 *
 * NTT v2 picks up that metadata so curated wallpapers land at the intended
 * focal point and solid-color "wallpapers" render as a flat background fill
 * with no image. The persisted `backgroundPosition` pref participates in
 * backup/restore.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');
const BACKUP_PATH = path.resolve(__dirname, '../../webextension/lib/backup.js');
const CDN = 'https://firefox-settings-attachments.cdn.mozilla.net/';

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

describe('fetchFirefoxWallpapers — passes through background_position + solid_color', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading method for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const method = extractMethod(source, 'fetchFirefoxWallpapers');
		const code = `var newTabTools = { ${method}, _wallpaperCache: null };`;
		vm.runInThisContext(code, { filename: 'wallpaper-pos-harness.js' });
		harness = (globalThis as any).newTabTools;
	});

	beforeEach(() => {
		harness._wallpaperCache = null;
	});

	it('forwards background_position when set, defaults to "center center" otherwise', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{
						title: 'corner', theme: 'light', category: 'abstracts',
						attachment: { location: 'a.avif' },
						background_position: 'top left',
					},
					{
						title: 'unset', theme: 'light', category: 'abstracts',
						attachment: { location: 'b.avif' },
					},
				],
			}),
		});
		const result = await harness.fetchFirefoxWallpapers();
		expect(result).toHaveLength(2);
		expect(result[0].backgroundPosition).toBe('top left');
		expect(result[1].backgroundPosition).toBe('center center');
	});

	it('emits "solid-colors" records with solidColor and no imageUrl', async () => {
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{ title: 'blue', theme: 'light', category: 'solid-colors', solid_color: '#76C1FF' },
				],
			}),
		});
		const result = await harness.fetchFirefoxWallpapers();
		expect(result).toHaveLength(1);
		expect(result[0].solidColor).toBe('#76C1FF');
		expect(result[0].imageUrl).toBeFalsy();
	});

	it('keeps the firefox-category and attachment-less filter intact for image records', async () => {
		// Regression — solid-colors must still pass the filter (they have no
		// attachment) but firefox-branded items must not.
		(globalThis as any).fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({
				data: [
					{ title: 'fx', theme: 'light', category: 'firefox', attachment: { location: 'fx.svg' } },
					{ title: 'bare', theme: 'light', category: 'abstracts' },
					{ title: 'pink', theme: 'light', category: 'solid-colors', solid_color: '#FF77AA' },
					{ title: 'real', theme: 'light', category: 'photographs', attachment: { location: 'real.avif' } },
				],
			}),
		});
		const result = await harness.fetchFirefoxWallpapers();
		const titles = result.map((r: any) => r.title).sort();
		expect(titles).toEqual(['pink', 'real']);
		const real = result.find((r: any) => r.title === 'real');
		expect(real.imageUrl).toBe(CDN + 'real.avif');
	});
});

describe('selectWallpaper — writes backgroundPosition and applies to body', () => {
	let harness: any;
	let prefsStore: Record<string, any>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading methods for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const select = extractMethod(source, 'selectWallpaper');
		const refresh = extractMethod(source, 'refreshBackgroundImage');
		// Tiny stub harness with the methods bound and a fake `Prefs` /
		// `Background` so the behaviour is observable.
		const code = `
			var Prefs = { backgroundUrl: '', backgroundPosition: 'center center', backgroundColor: '' };
			var Background = { setBackground: function() { return Promise.resolve(); }, getBackground: function() { return Promise.resolve(null); } };
			var newTabTools = {
				${select},
				${refresh},
				backgroundFake: { style: {} },
				removeBackgroundButton: { disabled: false, blur: function() {} },
			};
			this.__h = { newTabTools: newTabTools, Prefs: Prefs };
		`;
		const ctx: any = { document: globalThis.document, Promise: globalThis.Promise };
		vm.createContext(ctx);
		vm.runInContext(code, ctx);
		harness = ctx.__h;
		prefsStore = harness.Prefs;
	});

	beforeEach(() => {
		document.body.innerHTML = '<div id="wallpaper-grid"></div>';
		document.body.style.backgroundImage = '';
		document.body.style.backgroundPosition = '';
		document.body.style.backgroundColor = '';
		prefsStore.backgroundUrl = '';
		prefsStore.backgroundPosition = 'center center';
		prefsStore.backgroundColor = '';
	});

	it('writes backgroundUrl + backgroundPosition + applies styles when given a wallpaper record', async () => {
		const wp = {
			imageUrl: 'https://example.com/wp.avif',
			backgroundPosition: 'top right',
		};
		await harness.newTabTools.selectWallpaper(wp);
		expect(prefsStore.backgroundUrl).toBe('https://example.com/wp.avif');
		expect(prefsStore.backgroundPosition).toBe('top right');
		expect(document.body.style.backgroundImage).toContain('https://example.com/wp.avif');
		// jsdom canonicalises `top right` → `right top`; both render identically.
		expect(document.body.style.backgroundPosition).toMatch(/^(top right|right top)$/);
	});

	it('writes solidColor only (clears backgroundUrl) for solid-color records', async () => {
		const wp = { solidColor: '#76C1FF' };
		await harness.newTabTools.selectWallpaper(wp);
		expect(prefsStore.backgroundUrl).toBe('');
		expect(prefsStore.backgroundColor).toBe('#76C1FF');
		expect(document.body.style.backgroundColor).toBe('rgb(118, 193, 255)');
	});

	it('accepts a bare URL string (back-compat) and falls back to "center center"', async () => {
		await harness.newTabTools.selectWallpaper('https://example.com/legacy.png');
		expect(prefsStore.backgroundUrl).toBe('https://example.com/legacy.png');
		expect(prefsStore.backgroundPosition).toBe('center center');
	});
});

describe('backgroundPosition + backgroundColor prefs', () => {
	let prefsSource: string;
	let backupSource: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check
		prefsSource = fs.readFileSync(PREFS_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check
		backupSource = fs.readFileSync(BACKUP_PATH, 'utf8');
	});

	it('declares _backgroundPosition with the "center center" default', () => {
		expect(prefsSource).toMatch(/_backgroundPosition\s*:\s*['"]center center['"]/);
	});

	it('declares _backgroundColor as an empty-string default', () => {
		expect(prefsSource).toMatch(/_backgroundColor\s*:\s*['"]['"]/);
	});

	it('lists backgroundPosition and backgroundColor in the known-pref name list', () => {
		expect(prefsSource).toContain('\'backgroundPosition\'');
		expect(prefsSource).toContain('\'backgroundColor\'');
	});

	it('validates backgroundPosition against the 9-keyword allow-list', () => {
		// Firefox emits 9 corner/edge keywords. Anything else (e.g. arbitrary
		// percentages from a malicious backup) is dropped.
		expect(prefsSource).toMatch(/'center center'/);
		expect(prefsSource).toMatch(/'top left'/);
		expect(prefsSource).toMatch(/'bottom right'/);
	});

	it('validates backgroundColor against a safe hex pattern', () => {
		// `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` — same shape as the existing
		// per-tile colour validator so we don't grow surface area.
		expect(prefsSource).toMatch(/#\[0-9a-f\]\{3,8\}/i);
		expect(prefsSource).toContain('backgroundColor');
	});

	it('includes backgroundPosition + backgroundColor in the export allow-list', () => {
		expect(backupSource).toContain('\'backgroundPosition\'');
		expect(backupSource).toContain('\'backgroundColor\'');
	});
});
