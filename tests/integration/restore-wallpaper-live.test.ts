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
 * Loads the real `updateUI` + `refreshBackgroundImage` from newTab.js.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

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
		const refreshBackgroundImage = extractMethod(source, 'refreshBackgroundImage');
		const code = `globalThis.__nt = { ${updateUI}, ${refreshBackgroundImage},`
			+ ' backgroundFake: { style: {} }, removeBackgroundButton: {} };';
		vm.runInThisContext(code, { filename: 'wallpaper-live-harness.js' });
		nt = (globalThis as any).__nt;
	});

	beforeEach(() => {
		document.body.removeAttribute('style');
		(globalThis as any).Prefs = { backgroundUrl: '', backgroundPosition: 'center center', backgroundColor: '' };
	});

	it('applies a restored CDN wallpaper to document.body when backgroundUrl changes', () => {
		(globalThis as any).Prefs.backgroundUrl = CDN + 'main-workspace/newtab-wallpapers-v2/abc.avif';

		// Simulate the storage.onChanged → prefsChanged → updateUI(keys) path.
		nt.updateUI(['backgroundUrl']);

		expect(document.body.style.backgroundImage).toContain(CDN);
	});
});
