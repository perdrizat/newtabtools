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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFS_PATH = path.resolve(__dirname, '../../webextension/prefs.js');
const BACKUP_PATH = path.resolve(__dirname, '../../webextension/lib/backup.js');
const CDN = 'https://firefox-settings-attachments.cdn.mozilla.net/';

// chrome-prep C4d (CHROME_PREP.md): `fetchFirefoxWallpapers`/`selectWallpaper`/
// `refreshBackgroundImage` are real wallpaper.js exports now (moved verbatim
// out of newTab.js) — imported directly instead of vm-extracted from
// newTab.js source (C4a/b/c "import from the new specifier" precedent).

describe('fetchFirefoxWallpapers — passes through background_position + solid_color', () => {
	let fetchFirefoxWallpapers: () => Promise<any[]>;

	beforeEach(async () => {
		// `_wallpaperCache` is wallpaper.js's own module-private state — a
		// fresh module instance per test (`vi.resetModules()` + a fresh
		// dynamic `import()`) resets it, the same effect the old
		// per-`beforeAll` harness object had (wallpaper-picker.test.ts's own
		// header comment has the full rationale).
		vi.resetModules();
		({ fetchFirefoxWallpapers } = await import('../../webextension/wallpaper.js'));
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
		const result = await fetchFirefoxWallpapers();
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
		const result = await fetchFirefoxWallpapers();
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
		const result = await fetchFirefoxWallpapers();
		const titles = result.map((r: any) => r.title).sort();
		expect(titles).toEqual(['pink', 'real']);
		const real = result.find((r: any) => r.title === 'real');
		expect(real.imageUrl).toBe(CDN + 'real.avif');
	});
});

describe('selectWallpaper — writes backgroundPosition and applies to body', () => {
	let selectWallpaper: (w: any) => Promise<void>;

	beforeAll(async () => {
		// `selectWallpaper` reads the REAL `Prefs`/`Background`/`uiRefs`
		// singletons (prefs.js/tiles-shim.js/ui-refs.js) — mutated directly
		// below instead of the old isolated vm context's local `Prefs`/
		// `Background` fakes (which no real module import can see).
		({ selectWallpaper } = await import('../../webextension/wallpaper.js'));
		const { Background } = await import('../../webextension/tiles-shim.js');
		Background.setBackground = vi.fn().mockResolvedValue(undefined);
		const { uiRefs } = await import('../../webextension/ui-refs.js');
		uiRefs.backgroundFake = { style: {} } as any;
		uiRefs.removeBackgroundButton = { disabled: false, blur: vi.fn() } as any;
	});

	beforeEach(async () => {
		document.body.innerHTML = '<div id="wallpaper-grid"></div>';
		document.body.style.backgroundImage = '';
		document.body.style.backgroundPosition = '';
		document.body.style.backgroundColor = '';
		const { Prefs } = await import('../../webextension/prefs.js');
		Prefs.backgroundUrl = '';
		Prefs.backgroundPosition = 'center center';
		Prefs.backgroundColor = '';
	});

	it('writes backgroundUrl + backgroundPosition + applies styles when given a wallpaper record', async () => {
		const { Prefs } = await import('../../webextension/prefs.js');
		const wp = {
			imageUrl: 'https://example.com/wp.avif',
			backgroundPosition: 'top right',
		};
		await selectWallpaper(wp);
		expect(Prefs.backgroundUrl).toBe('https://example.com/wp.avif');
		expect(Prefs.backgroundPosition).toBe('top right');
		expect(document.body.style.backgroundImage).toContain('https://example.com/wp.avif');
		// jsdom canonicalises `top right` → `right top`; both render identically.
		expect(document.body.style.backgroundPosition).toMatch(/^(top right|right top)$/);
	});

	it('writes solidColor only (clears backgroundUrl) for solid-color records', async () => {
		const { Prefs } = await import('../../webextension/prefs.js');
		const wp = { solidColor: '#76C1FF' };
		await selectWallpaper(wp);
		expect(Prefs.backgroundUrl).toBe('');
		expect(Prefs.backgroundColor).toBe('#76C1FF');
		expect(document.body.style.backgroundColor).toBe('rgb(118, 193, 255)');
	});

	it('accepts a bare URL string (back-compat) and falls back to "center center"', async () => {
		const { Prefs } = await import('../../webextension/prefs.js');
		await selectWallpaper('https://example.com/legacy.png');
		expect(Prefs.backgroundUrl).toBe('https://example.com/legacy.png');
		expect(Prefs.backgroundPosition).toBe('center center');
	});

	it('marks the clicked solid-colour swatch [selected] in the post-click grid refresh (matches dataset.solidColor, not just dataset.url)', async () => {
		// Latent bug found by the D8 wallpaper-degrade slice (2026-07-18): the
		// post-click refresh loop matched `t.dataset.url === url` only, so a
		// solid-colour swatch (dataset.solidColor, no dataset.url) never gained
		// the `[selected]` marker — invisible-ish on Firefox's photo-heavy
		// catalog, but Chrome's degraded picker is ALL solid swatches.
		const grid = document.getElementById('wallpaper-grid') as HTMLElement;
		const swatch = document.createElement('div');
		swatch.className = 'wallpaper-thumb';
		swatch.dataset.solidColor = '#76C1FF';
		const imgThumb = document.createElement('img');
		imgThumb.className = 'wallpaper-thumb';
		imgThumb.dataset.url = 'https://example.com/wp.avif';
		imgThumb.setAttribute('selected', '');
		grid.append(swatch, imgThumb);

		await selectWallpaper({ solidColor: '#76C1FF' });
		expect(swatch.hasAttribute('selected')).toBe(true);
		expect(imgThumb.hasAttribute('selected')).toBe(false);
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
