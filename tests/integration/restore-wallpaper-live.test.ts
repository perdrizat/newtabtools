/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Restoring a backup whose `backgroundUrl` pref points at a wallpaper must apply
 * that wallpaper to the page LIVE — the user should not have to reload.
 *
 * Restore writes the prefs to `chrome.storage.local`, which fires
 * `Prefs.prefsChanged` → `newTabTools.updateUI(changedKeys)`. So `updateUI` is
 * the live-apply path, and it must re-run the background apply when a background
 * pref changes — exactly as it already does for theme, spacing, grid size, etc.
 *
 * Regression guard for the "wallpaper only appears after a manual reload" bug.
 *
 * chrome-prep C4d (CHROME_PREP.md): `refreshBackgroundImage` is a real
 * wallpaper.js export now (moved verbatim out of newTab.js) — imported
 * directly and exposed on `globalThis` (below) so `updateUI`'s
 * vm-extracted, still-resident body can reach it as the bare identifier its
 * real source now calls (C4a/b/c "import from the new specifier" precedent
 * for the move; the `isValidURL`/`el` pattern for the harness exposure).
 * `Prefs`/`uiRefs` are the REAL singletons `refreshBackgroundImage` itself
 * reads (prefs.js/ui-refs.js) — a `globalThis.Prefs` stand-in wouldn't reach
 * it (same "second-order fallout" class _helpers.ts's `ensureSiteEnv`
 * documents).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';
import { Prefs } from '../../webextension/prefs.js';
import { uiRefs } from '../../webextension/ui-refs.js';
import { refreshBackgroundImage } from '../../webextension/wallpaper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
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

describe('restore applies the wallpaper live (no reload)', () => {
	let nt: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading methods for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const updateUI = extractMethod(source, 'updateUI');
		// Stand-in for the extracted updateUI body's bare `Grid` reads —
		// chrome-prep C3d dropped the `'Grid' in window` sniffs that made it
		// optional in this vm harness (C3a guard-removal fallout pattern).
		(globalThis as any).Grid = { sites: [] };
		(globalThis as any).refreshBackgroundImage = refreshBackgroundImage;
		uiRefs.backgroundFake = { style: {} } as any;
		uiRefs.removeBackgroundButton = { disabled: false, blur: () => {} } as any;
		const code = `globalThis.__nt = { ${updateUI} };`;
		vm.runInThisContext(code, { filename: 'wallpaper-live-harness.js' });
		nt = (globalThis as any).__nt;
	});

	beforeEach(() => {
		document.body.removeAttribute('style');
		Prefs.backgroundUrl = '';
		Prefs.backgroundPosition = 'center center';
		Prefs.backgroundColor = '';
	});

	it('applies a restored CDN wallpaper to document.body when backgroundUrl changes', () => {
		Prefs.backgroundUrl = CDN + 'main-workspace/newtab-wallpapers-v2/abc.avif';

		// Simulate the storage.onChanged → prefsChanged → updateUI(keys) path.
		nt.updateUI(['backgroundUrl']);

		expect(document.body.style.backgroundImage).toContain(CDN);
	});
});
