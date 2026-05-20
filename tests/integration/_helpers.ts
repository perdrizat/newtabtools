/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadModule(relativePath: string, sandbox?: Record<string, unknown>): Record<string, unknown> {
	const fullPath = path.resolve(__dirname, relativePath);
	const source = fs.readFileSync(fullPath, 'utf8');

	const defaults: Record<string, unknown> = {
		console,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		Promise,
		URL,
		Object,
		Array,
		chrome: {
			runtime: { sendMessage: vi.fn() },
			tabs: { create: vi.fn() },
			i18n: { getMessage: vi.fn(() => '') },
			storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
		},
		browser: {
			storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
			permissions: { contains: vi.fn().mockResolvedValue(true) },
			history: { getVisits: vi.fn().mockResolvedValue([]) },
			topSites: { get: vi.fn().mockResolvedValue([]) },
		},
	};

	const ctx = vm.createContext({ ...defaults, ...sandbox });
	vm.runInContext(source, ctx, { filename: path.basename(fullPath) });
	return ctx;
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
				<span class="ntt-actions"></span>
				<span class="ntt-overlay">
					<span class="ntt-favicon"></span>
					<span class="newtab-title"></span>
				</span>
			</div>
		`;
		document.body.appendChild(template);
	}

	if (!_siteEnvLoaded) {
		const iconsPath = path.resolve(__dirname, '../../webextension/icons.js');
		const fxPath = path.resolve(__dirname, '../../webextension/fx-newTab.js');

		const iconsSource = fs.readFileSync(iconsPath, 'utf8');
		vm.runInThisContext(iconsSource, { filename: 'icons.js' });

		(globalThis as any).Prefs = (globalThis as any).Prefs || { statType: 'none' };
		(globalThis as any).Tiles = (globalThis as any).Tiles || { isPinned: vi.fn(() => false) };
		(globalThis as any).Blocked = (globalThis as any).Blocked || { _list: [] };
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

		let fxSource = fs.readFileSync(fxPath, 'utf8');
		fxSource = fxSource.replace(/UndoDialog\.init\(\);/, '// UndoDialog.init();');
		fxSource = fxSource.replace(/newTabTools\.startup\(\);/, '// newTabTools.startup();');
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
