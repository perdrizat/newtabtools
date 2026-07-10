/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

// page-modules P2 (PAGE_MODULES.md): icons.js gained a real `export`, which
// `vm.runInThisContext` (a script-mode loader) can no longer parse — see the
// removed load in mountSite() below. A plain top-level import here runs once
// per test file (module imports are cached, but each test file gets its own
// module registry) and its `globalThis.NttIcons = NttIcons;` bridge
// assignment (still present — fx-newTab.js reads it as a bare identifier)
// covers what the vm load used to provide, without needing mountSite() (or
// its callers) to become async.
import '../../webextension/icons.js';

// page-modules P4 (PAGE_MODULES.md): this file used to also export a
// `loadModule(relativePath, sandbox)` helper — a `vm.createContext` +
// `vm.runInContext` sandbox loader for script-mode files, with its own
// chrome/browser mock defaults. Deleted once its last consumer migrated to a
// native import (P4). P5 (PAGE_MODULES.md): `mountSite`'s own `vm` use is
// gone too — fx-newTab.js gained real `import`/`export` this slice, which
// `vm.runInThisContext` can no longer parse, so `importPageModules()` below
// natively `import()`s it instead (a computed-path specifier, so `tsc`
// doesn't follow the monolith into the typed program — PAGE_MODULES.md's P1
// precedent, page-module-scope.test.ts). The `vm`/`fs` imports for
// `mountSite` therefore drop; `fs` stays for `readNewTabHtml`.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT_DIR = path.resolve(__dirname, '../../webextension');

/** Resolves `relPath` (e.g. `'fx-newTab.js'`) to its absolute path under `webextension/`. */
export function webextPath(relPath: string): string {
	return path.join(WEBEXT_DIR, relPath);
}

const NEWTAB_HTML_PATH = path.resolve(__dirname, '../../webextension/newTab.html');
let _newTabHtmlCache: string | undefined;

/**
 * Reads the shipped `webextension/newTab.html`, cached after the first call.
 *
 * Centralizes what used to be ~16 hand-rolled
 * `fs.readFileSync(path.resolve(__dirname, '../../webextension/newTab.html'), 'utf8')`
 * copies across the integration suite (audit
 * 2026-07-09-modernization-h-code-review.md #5) — the H2 rename touched every
 * one of them, which is the cost this helper removes: the next rename (or
 * path change) touches this one line instead. This is the one sanctioned
 * place the integration tier reads `newTab.html` from disk; callers import
 * this helper instead of calling `readFileSync` themselves, so the
 * `ntt/no-source-grep` justification lives here once rather than once per
 * call site.
 */
export function readNewTabHtml(): string {
	if (_newTabHtmlCache === undefined) {
		// eslint-disable-next-line ntt/no-source-grep -- the one sanctioned read of newTab.html; see docstring above
		_newTabHtmlCache = fs.readFileSync(NEWTAB_HTML_PATH, 'utf8');
	}
	return _newTabHtmlCache;
}

/** Parses `newTab.html` with the same `DOMParser` the fast tier uses elsewhere. */
export function parseNewTabDocument(): Document {
	return new DOMParser().parseFromString(readNewTabHtml(), 'text/html');
}

let _siteEnvPromise: Promise<any> | null = null;

/**
 * Loads the real page-module cycle (fx-newTab.js <-> newTab.js,
 * PAGE_MODULES.md P5) exactly once per test file (memoized): mounts the
 * shipped `newTab.html` body FIRST — newTab.js's top-level DOM-wiring IIFE
 * looks up real element ids (options-toggle, wallpaper-close, …) and throws
 * on a null element, the same reason page-module-scope.test.ts mounts it
 * before importing (its own comment has the details) — then natively
 * `import()`s fx-newTab.js by computed path (`@vite-ignore`, so `tsc`
 * doesn't follow the monolith into the typed program). Importing
 * fx-newTab.js transitively imports and evaluates newTab.js too (the legal
 * cycle, Decision 3): both files' `Prefs`/`Tiles`/`Blocked`/`NeverCapture`/
 * `TileStats`/`newTabTools` references are the same real singleton objects
 * this helper (and any caller) also reaches via a matching `import()`.
 *
 * `Prefs.init()` is deliberately NOT called here (that's real boot — out of
 * scope per Decision 3, "booting in jsdom is out of scope"). Before `init()`
 * runs, `Prefs`'s pref-name properties (`statType`, …) are plain, getter-less
 * own-data properties (`init()` is what installs the `__defineGetter__`/
 * `__defineSetter__` accessor pair) — so a caller can set one directly, same
 * as `awesomebar-dom.test.ts`'s established `Prefs.titleBarSearch = true`
 * precedent, and read it back synchronously with no storage round-trip.
 * `Prefs.statType` is seeded to `'none'` below, matching the one property the
 * old stand-in `Prefs` object used to hardcode (a stand-in object assigned
 * over `globalThis.Prefs` is invisible to code that now imports the real
 * singleton — the P3/P4 "second-order fallout" precedent — so this seeds the
 * REAL singleton's state instead of replacing the binding). Every other
 * `Prefs.*`/`Blocked.*`/`Tiles.*`/`NeverCapture.*`/`TileStats.*` read a
 * mountSite() consumer exercises was equally undefined/default-empty under
 * the old full-replacement stand-ins, so no other default is seeded here;
 * callers that need one mutate the (real, imported) singleton directly, in
 * place, per test — see tile-redesign.test.ts for the pattern.
 *
 * Returns fx-newTab.js's module namespace (`Page`/`Grid`/`Updater`/
 * `UndoDialog`/`Site`/`Drag`/`Drop`/`Transformation`).
 *
 * Exported (not just used internally by `mountSite`) so a caller that needs
 * to override one of the seeded defaults (e.g. tile-redesign.test.ts sets
 * `Prefs.statType = 'visits'` before mounting a site) can await this FIRST —
 * otherwise, if that override happens to be the first `mountSite()` call in
 * the test file, this function's one-time `Prefs.statType = 'none'` seed
 * would run afterward (inside `mountSite`) and clobber the override.
 */
export async function ensureSiteEnv(): Promise<any> {
	if (!_siteEnvPromise) {
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;

		if (!URL.createObjectURL) {
			URL.createObjectURL = vi.fn(() => 'blob:mock');
		}
		if (!URL.revokeObjectURL) {
			URL.revokeObjectURL = vi.fn();
		}

		_siteEnvPromise = import(/* @vite-ignore */ webextPath('fx-newTab.js')).then(async fx => {
			const { Prefs } = await import(/* @vite-ignore */ webextPath('prefs.js'));
			(Prefs as any).statType = 'none';
			return fx;
		});
	}
	return _siteEnvPromise;
}

export async function mountSite(
	linkData: Record<string, unknown>,
): Promise<{ site: any; node: HTMLElement; cleanup: () => void }> {
	const fx = await ensureSiteEnv();

	// The real newTab.html already ships this exact template (id="newtab-site")
	// — mounting the shipped body above provides it, so there is nothing left
	// for this helper to hand-roll.
	const template = document.getElementById('newtab-site') as HTMLTemplateElement;
	const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
	document.body.appendChild(node);
	const site = new fx.Site(node, linkData);

	return {
		site,
		node: site.node as HTMLElement,
		cleanup() { node.remove(); },
	};
}
