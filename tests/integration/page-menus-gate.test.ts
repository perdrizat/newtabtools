/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * chrome-prep C5b (CHROME_PREP.md, Decision 1 / `audit/2026-07-11-chrome-api-
 * divergence.md` #5): the page-side twin of event-page-menus-gate.test.ts.
 * Chrome has no `menus` namespace, so newTab.js's top-level
 * `api.menus.onShown`/`onClicked` registration (page-module-scope.test.ts's
 * baseline has these present via tests/setup.js's shared mock) must not
 * throw — and must register nothing — when `api.menus` is absent. Separate
 * test file for the same reason as its background twin: needs a fresh,
 * menus-absent import of newTab.js (and the page files it's transitively
 * reached through), not a second import within an already-menus-present
 * suite (vitest's per-file module registry would just return the cached
 * instance).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseNewTabDocument } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const PAGE_MAIN_PATH = path.join(WEBEXT, 'page-main.js');

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// Same derivation as page-module-scope.test.ts — the load order is read from
// page-main.js itself so this file can't silently drift from the real entry
// point's import list.
// eslint-disable-next-line ntt/no-source-grep -- supplies the expected load order from the single source of truth (page-main.js); the import behavior itself is exercised natively below, not asserted via string match
const pageMainSource = fs.readFileSync(PAGE_MAIN_PATH, 'utf8');
const PAGE_FILES_IN_LOAD_ORDER = [...pageMainSource.matchAll(/^import\s+(?:\{[^}]*\}\s+from\s+)?'\.\/([^']+)';$/gm)]
	.map(m => m[1]);

describe('newTab.js — menus presence-gate (Decision 1, no menus namespace on Chrome)', () => {
	let importError: unknown = null;

	beforeAll(async () => {
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;

		// The one deliberate deviation from page-module-scope.test.ts's
		// baseline: no `menus` namespace at all (Decision 1 — Chrome has none).
		delete (globalThis as any).browser.menus;
		delete (globalThis as any).chrome.menus;

		try {
			for (const file of PAGE_FILES_IN_LOAD_ORDER) {
				await import(/* @vite-ignore */ webext(file));
			}
		} catch (e) {
			importError = e;
		}
	});

	it('imports all page files without throwing when api.menus is absent', () => {
		expect(importError).toBeNull();
	});

	it('registers nothing on the (absent) menus namespace — there is nothing to assert a call against, only that nothing threw above', () => {
		expect((globalThis as any).browser.menus).toBeUndefined();
		expect((globalThis as any).chrome.menus).toBeUndefined();
	});
});
