/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Behavioral coverage for the `Prefs.onChange` seam (PAGE_MODULES.md P3,
 * Decision 6).
 *
 * Before this slice, `prefs.js`'s `prefsChanged` sniffed `'newTabTools' in
 * window` and called `newTabTools.updateUI`/`Grid.refresh`/
 * `Updater.updateGrid` directly — a page-only branch living inside a file
 * the background also side-effect-imports. A real `import` in that direction
 * would drag the page into the background's module graph, so P3 inverts it:
 * `Prefs.onChange(listener)` registers a listener; `prefsChanged` invokes
 * every registered listener with the array of changed pref names (skipping
 * the pre-existing thumbnailSize-only short-circuit, unchanged). The page
 * registers its listener in `page-main.js`, after the boot calls; the
 * background registers none.
 *
 * Three contracts under test:
 *   (a) a registered listener fires with the changed-keys array.
 *   (b) `prefsChanged` does not throw when zero listeners are registered —
 *       the background scenario (it never calls `Prefs.onChange`).
 *   (c) the listener `page-main.js` actually registers reproduces the OLD
 *       branch's behavior exactly — proven by leaf-importing the real page
 *       files (same mechanism as `page-main-boot.test.ts`), spying on the
 *       real `newTabTools`/`Grid`/`Updater` objects, natively importing
 *       `page-main.js` so its own `Prefs.onChange(...)` registration runs
 *       against those spies, then driving `Prefs.prefsChanged(...)`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseNewTabDocument } from './_helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

// ---------------------------------------------------------------------------
// (a) + (b): the seam itself, exercised directly against the real Prefs
// singleton — no page files involved.
// ---------------------------------------------------------------------------

describe('Prefs.onChange — registration + firing', () => {
	let Prefs: any;

	beforeAll(async () => {
		({ Prefs } = await import('../../webextension/prefs.js'));
	});

	beforeEach(() => {
		// prefs.js is a real module singleton now (P3) — reset the listener
		// list between tests so registrations from one test don't leak into
		// the next (crib: P2's stats.js singleton-state-reset precedent).
		Prefs._listeners.length = 0;
	});

	it('(a) fires a registered listener with the array of changed pref names', () => {
		const listener = vi.fn();
		Prefs.onChange(listener);
		Prefs.prefsChanged({ rows: { newValue: 5, oldValue: 3 } });
		expect(listener).toHaveBeenCalledWith(['rows']);
	});

	it('(a) fires with every changed key when several prefs change together', () => {
		const listener = vi.fn();
		Prefs.onChange(listener);
		Prefs.prefsChanged({
			rows: { newValue: 5, oldValue: 3 },
			columns: { newValue: 5, oldValue: 3 },
		});
		expect(listener).toHaveBeenCalledWith(expect.arrayContaining(['rows', 'columns']));
		expect(listener.mock.calls[0][0]).toHaveLength(2);
	});

	it('(a) fires every registered listener, in registration order', () => {
		const calls: string[] = [];
		Prefs.onChange(() => calls.push('first'));
		Prefs.onChange(() => calls.push('second'));
		Prefs.prefsChanged({ theme: { newValue: 'dark', oldValue: 'system' } });
		expect(calls).toEqual(['first', 'second']);
	});

	it('(a) still skips the pre-existing thumbnailSize-only short-circuit (no listener fires)', () => {
		const listener = vi.fn();
		Prefs.onChange(listener);
		Prefs.prefsChanged({ thumbnailSize: { newValue: 800, oldValue: 600 } });
		expect(listener).not.toHaveBeenCalled();
	});

	it('(a) does not fire for a no-op change (newValue == oldValue)', () => {
		const listener = vi.fn();
		Prefs.onChange(listener);
		Prefs.prefsChanged({ rows: { newValue: 3, oldValue: 3 } });
		expect(listener).not.toHaveBeenCalled();
	});

	it('(b) does not throw when zero listeners are registered (the background scenario)', () => {
		expect(Prefs._listeners).toHaveLength(0);
		expect(() => {
			Prefs.prefsChanged({ rows: { newValue: 5, oldValue: 3 } });
		}).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// (c): page-main.js's own registration reproduces the old branch's behavior.
// ---------------------------------------------------------------------------

describe('page-main.js registers the seam that reproduces the old updateUI/refresh dance', () => {
	// chrome-prep C4a (CHROME_PREP.md): page-main.js's import list grows from
	// eight entries to ten — `Updater`/`UndoDialog` moved out of fx-newTab.js
	// into their own updater.js/undo-dialog.js modules, imported by name just
	// before fx-newTab.js (which still needs both, for its own Grid/Site/
	// Drag/Drop use). chrome-prep C4b (CHROME_PREP.md): `Drag`/`Drop`/
	// `DropTargetShim`/`DropPreview` also moved out, to their own drag-drop.js
	// module — but page-main.js never calls any of the four directly (only
	// fx-newTab.js does), so this list stays at ten entries.
	const PAGE_FILES_IN_LOAD_ORDER = [
		'common.js', 'icons.js', 'stats.js', 'tiles-shim.js', 'prefs.js',
		'awesomebar.js', 'newTab.js', 'undo-dialog.js', 'updater.js', 'fx-newTab.js',
	];

	let Prefs: any;
	let updateUISpy: ReturnType<typeof vi.spyOn>;
	let markAutoSavedSpy: ReturnType<typeof vi.spyOn>;
	let refreshSpy: ReturnType<typeof vi.spyOn>;
	let updateGridSpy: ReturnType<typeof vi.spyOn>;
	let resizeSpy: ReturnType<typeof vi.spyOn>;

	beforeAll(async () => {
		document.body.innerHTML = parseNewTabDocument().body.innerHTML;

		// Leaf-import the ten page files first, in page-main.js's order, via
		// real `import`s (chrome-prep C3d retired the `globalThis` bridge
		// these used to also land on) — capture the bindings this file needs
		// so the spies below wrap the actual production objects (crib:
		// page-main-boot.test.ts). chrome-prep C4a: `Updater`/`UndoDialog`
		// moved out of fx-newTab.js into their own modules.
		let prefsModule: any;
		let newTabModule: any;
		let fxNewTabModule: any;
		let undoDialogModule: any;
		let updaterModule: any;
		for (const file of PAGE_FILES_IN_LOAD_ORDER) {
			const mod = await import(/* @vite-ignore */ webext(file));
			if (file === 'prefs.js') { prefsModule = mod; }
			if (file === 'newTab.js') { newTabModule = mod; }
			if (file === 'fx-newTab.js') { fxNewTabModule = mod; }
			if (file === 'undo-dialog.js') { undoDialogModule = mod; }
			if (file === 'updater.js') { updaterModule = mod; }
		}
		Prefs = prefsModule.Prefs;

		// Stub the two boot entry points inert — actually running
		// startup()/init() end-to-end in jsdom is out of scope here; only
		// page-main.js's OWN Prefs.onChange(...) registration trailer matters
		// (crib: page-main-boot.test.ts). (A third boot-trailer step,
		// pageMessageHandler.flushQueued(), was retired in chrome-prep C3a —
		// CHROME_PREP.md — so there is nothing left to stub for it.)
		vi.spyOn(undoDialogModule.UndoDialog, 'init').mockImplementation(() => {});
		vi.spyOn(newTabModule.newTabTools, 'startup').mockImplementation(() => {});

		updateUISpy = vi.spyOn(newTabModule.newTabTools, 'updateUI').mockImplementation(() => {});
		markAutoSavedSpy = vi.spyOn(newTabModule.newTabTools, '_markAutoSaved').mockImplementation(() => {});
		resizeSpy = vi.spyOn(newTabModule.newTabTools, 'resizeOptionsThumbnail').mockImplementation(() => {});
		refreshSpy = vi.spyOn(fxNewTabModule.Grid, 'refresh').mockResolvedValue(undefined);
		updateGridSpy = vi.spyOn(updaterModule.Updater, 'updateGrid').mockImplementation(() => {});

		// Import the real entry point — its ten `import './X.js'` lines hit
		// the module cache already populated above, so no code re-runs; only
		// page-main.js's own top-level trailer (boot calls + the
		// `Prefs.onChange(...)` registration) executes.
		await import(/* @vite-ignore */ webext('page-main.js'));
	});

	beforeEach(() => {
		updateUISpy.mockClear();
		markAutoSavedSpy.mockClear();
		resizeSpy.mockClear();
		refreshSpy.mockClear();
		updateGridSpy.mockClear();
		document.documentElement.removeAttribute('drawer-open');
		document.documentElement.removeAttribute('drawer-tab');
	});

	it('calls newTabTools.updateUI(keys) and _markAutoSaved() for any change', () => {
		Prefs.prefsChanged({ theme: { newValue: 'dark', oldValue: 'system' } });
		expect(updateUISpy).toHaveBeenCalledWith(['theme']);
		expect(markAutoSavedSpy).toHaveBeenCalledTimes(1);
	});

	it('calls Grid.refresh() when rows changes, not Updater.updateGrid()', () => {
		Prefs.prefsChanged({ rows: { newValue: 5, oldValue: 3 } });
		expect(refreshSpy).toHaveBeenCalledTimes(1);
		expect(updateGridSpy).not.toHaveBeenCalled();
	});

	it('calls Grid.refresh() when columns changes', () => {
		Prefs.prefsChanged({ columns: { newValue: 5, oldValue: 3 } });
		expect(refreshSpy).toHaveBeenCalledTimes(1);
	});

	it('calls Updater.updateGrid() when history changes, not Grid.refresh()', () => {
		Prefs.prefsChanged({ history: { newValue: false, oldValue: true } });
		expect(updateGridSpy).toHaveBeenCalledTimes(1);
		expect(refreshSpy).not.toHaveBeenCalled();
	});

	it('calls neither Grid.refresh() nor Updater.updateGrid() for an unrelated key', () => {
		Prefs.prefsChanged({ theme: { newValue: 'dark', oldValue: 'system' } });
		expect(refreshSpy).not.toHaveBeenCalled();
		expect(updateGridSpy).not.toHaveBeenCalled();
	});

	it('resizes the options thumbnail after Grid.refresh() only while the tile drawer tab is open', async () => {
		document.documentElement.setAttribute('drawer-open', '');
		document.documentElement.setAttribute('drawer-tab', 'tile');
		Prefs.prefsChanged({ rows: { newValue: 5, oldValue: 3 } });
		// Grid.refresh()'s mock resolves on a microtask; flush it.
		await Promise.resolve();
		await Promise.resolve();
		expect(resizeSpy).toHaveBeenCalledTimes(1);
	});

	it('does not resize the options thumbnail when the drawer is closed', async () => {
		Prefs.prefsChanged({ rows: { newValue: 5, oldValue: 3 } });
		await Promise.resolve();
		await Promise.resolve();
		expect(resizeSpy).not.toHaveBeenCalled();
	});

	it('still skips the seam entirely for a thumbnailSize-only change', () => {
		Prefs.prefsChanged({ thumbnailSize: { newValue: 800, oldValue: 600 } });
		expect(updateUISpy).not.toHaveBeenCalled();
		expect(markAutoSavedSpy).not.toHaveBeenCalled();
	});

	it('the background registers no listener of its own (only page-main.js\'s one listener fires)', () => {
		// Exactly one listener should be registered by this point — page-main.js's.
		// lib/background-main.js is a separate module graph (never imported by
		// this file), so it cannot have added one here either way; this
		// assertion pins the count so a future accidental double-registration
		// (e.g. re-importing page-main.js) would be caught.
		expect(Prefs._listeners).toHaveLength(1);
	});
});
