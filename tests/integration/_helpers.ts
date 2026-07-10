/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
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
// chrome/browser mock defaults. `tests/integration/awesomebar.test.ts` was
// its last consumer (P2/P3 already migrated every other vm-loading suite);
// once awesomebar.js gained a real `export` this slice, that test moved to a
// native `import` too (the same reason icons.js's vm load was dropped above),
// leaving `loadModule` with zero callers. Deleted here rather than waiting
// for P5's harness retirement, per PAGE_MODULES.md's P4 checklist. `mountSite`
// below still needs `vm.runInThisContext` for fx-newTab.js (a classic script
// until P5), so the `vm`/`vi` imports stay.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

let _siteEnvLoaded = false;

export function mountSite(
	linkData: Record<string, unknown>,
): { site: any; node: HTMLElement; cleanup: () => void } {
	if (!document.getElementById('newtab-site')) {
		const template = document.createElement('template');
		template.id = 'newtab-site';
		template.innerHTML = `
			<div class="newtab-site" draggable="true">
				<a class="newtab-link">
					<span class="newtab-thumbnail"></span>
				</a>
				<span class="ntt-pin-stripe"></span>
				<span class="ntt-stat-chip"></span>
				<span class="ntt-actions-kebab"></span>
				<span class="ntt-actions"></span>
				<span class="ntt-drag-handle"></span>
				<span class="ntt-add-tile"></span>
				<span class="ntt-overlay">
					<span class="ntt-favicon"></span>
					<span class="newtab-title"></span>
				</span>
			</div>
		`;
		document.body.appendChild(template);
	}

	if (!_siteEnvLoaded) {
		const fxPath = path.resolve(__dirname, '../../webextension/fx-newTab.js');

		// icons.js is natively imported at module top (above) rather than
		// vm-loaded here — see that import's comment.

		(globalThis as any).Prefs = (globalThis as any).Prefs || { statType: 'none' };
		(globalThis as any).Tiles = (globalThis as any).Tiles || { isPinned: vi.fn(() => false) };
		(globalThis as any).Blocked = (globalThis as any).Blocked || { _list: [] };
		(globalThis as any).NeverCapture = (globalThis as any).NeverCapture || {
			matches: () => false,
			matchingEntry: () => undefined,
			add: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			getList: () => [],
		};
		(globalThis as any).newTabTools = (globalThis as any).newTabTools || {
			getString: (name: string) => name,
			isValidURL: (url: string) => {
				try { return ['http:', 'https:', 'ftp:'].includes(new URL(url).protocol); }
				catch { return false; }
			},
		};
		(globalThis as any).TileStats = (globalThis as any).TileStats || {
			compute: vi.fn().mockResolvedValue(null),
		};
		(globalThis as any).chrome = {
			...(globalThis as any).chrome,
			runtime: { sendMessage: vi.fn() },
			tabs: { create: vi.fn() },
			i18n: { getMessage: vi.fn(() => '') },
		};
		(globalThis as any).UndoDialog = (globalThis as any).UndoDialog || { init: vi.fn() };
		(globalThis as any).Updater = (globalThis as any).Updater || { updateGrid: vi.fn() };
		(globalThis as any).Grid = (globalThis as any).Grid || { sites: [] };

		if (!URL.createObjectURL) {
			URL.createObjectURL = vi.fn(() => 'blob:mock');
		}
		if (!URL.revokeObjectURL) {
			URL.revokeObjectURL = vi.fn();
		}

		// page-modules P1 (PAGE_MODULES.md): fx-newTab.js's top level is now
		// definition-only — the former `UndoDialog.init(); newTabTools.startup();`
		// trailer this used to strip out was hoisted to page-main.js, so there is
		// nothing left here to neutralize before vm-loading the file standalone.
		let fxSource = fs.readFileSync(fxPath, 'utf8');
		vm.runInThisContext(fxSource, { filename: 'fx-newTab.js' });

		_siteEnvLoaded = true;
	}

	const Site = (globalThis as any).Site;
	const template = document.getElementById('newtab-site') as HTMLTemplateElement;
	const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
	document.body.appendChild(node);
	const site = new Site(node, linkData);

	return {
		site,
		node: site.node as HTMLElement,
		cleanup() { node.remove(); },
	};
}
