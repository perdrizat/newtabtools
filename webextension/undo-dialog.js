/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4a (CHROME_PREP.md): extracted verbatim from fx-newTab.js's
// `UndoDialog` singleton (C3b typed it there; this slice only moves the
// code — no rewrite, per the arc's slicing rule). `newTabTools` (newTab.js)
// is a real, call-time-only reference back into a file that in turn imports
// THIS file (fx-newTab.js's `Site.block()` calls `UndoDialog.show()`) — a
// legal ESM cycle under Decision 3 (PAGE_MODULES.md): every reference below
// is inside a method body, never a top-level read. `Updater` is a sibling
// module extracted in the same slice (no cycle between the two — updater.js
// never imports this file).
import { Blocked } from './prefs.js';
import { Tiles } from './tiles-shim.js';
import { newTabTools } from './newTab.js';
import { Updater } from './updater.js';

/**
 * `Link` is fx-newTab.js's own alias of `tiles-shim.js`'s `Tile` type — used
 * by both this mover and stayers there (`Grid.createSite`, `Site`), so per
 * the arc's typedef-ownership rule it stays owned by fx-newTab.js and is
 * referenced here via `import('./fx-newTab.js').Link`, same as `Site`/`Cell`.
 * @typedef {import('./fx-newTab.js').Site} Site
 * @typedef {import('./fx-newTab.js').Cell} Cell
 * @typedef {import('./fx-newTab.js').Link} Link
 */

/**
 * Dialog allowing to undo the removal of single site or to completely restore
 * the grid's original state.
 */
export var UndoDialog = {
	/**
	   * The undo dialog's timeout in miliseconds.
	   */
	HIDE_TIMEOUT_MS: 15000,

	/**
	   * Contains undo information.
	   * @type {{index: number, wasPinned: boolean, blockedLink: Link, timeout: ReturnType<typeof setTimeout>} | null}
	   */
	_undoData: null,

	/** @type {HTMLElement} */
	_undoContainer: /** @type {any} */ (undefined),
	/** @type {HTMLElement} */
	_undoButton: /** @type {any} */ (undefined),
	/** @type {HTMLElement} */
	_undoCloseButton: /** @type {any} */ (undefined),
	/** @type {HTMLElement} */
	_undoRestoreButton: /** @type {any} */ (undefined),

	/**
	   * Initializes the undo dialog.
	   */
	init() {
		this._undoContainer = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-container'));
		this._undoContainer.addEventListener('click', this);
		this._undoButton = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-button'));
		this._undoCloseButton = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-close-button'));
		this._undoRestoreButton = /** @type {HTMLElement} */ (document.getElementById('newtab-undo-restore-button'));
	},

	/**
	   * Shows the undo dialog.
	   * @param {Site} site The site that just got removed.
	   */
	show(site) {
		if (this._undoData) {
			clearTimeout(this._undoData.timeout);
		}

		this._undoData = {
			index: /** @type {Cell} */ (site.cell).index,
			wasPinned: site.isPinned,
			blockedLink: site.link,
			timeout: setTimeout(this.hide.bind(this), this.HIDE_TIMEOUT_MS)
		};

		this._undoContainer.removeAttribute('undo-disabled');
		this._undoButton.removeAttribute('tabindex');
		this._undoCloseButton.removeAttribute('tabindex');
		this._undoRestoreButton.removeAttribute('tabindex');

		newTabTools.trimRecent();
	},

	/**
	   * Hides the undo dialog.
	   */
	hide() {
		if (!this._undoData) {
			return;
		}

		clearTimeout(this._undoData.timeout);
		this._undoData = null;
		this._undoContainer.setAttribute('undo-disabled', 'true');
		this._undoButton.setAttribute('tabindex', '-1');
		this._undoCloseButton.setAttribute('tabindex', '-1');
		this._undoRestoreButton.setAttribute('tabindex', '-1');

		newTabTools.trimRecent();
	},

	/**
	   * The undo dialog event handler.
	   * @param {Event} event The event to handle.
	   */
	handleEvent(event) {
		switch (/** @type {Element} */ (event.target).id) {
		case 'newtab-undo-button':
			this._undo();
			break;
		case 'newtab-undo-restore-button':
			this._undoAll();
			break;
		case 'newtab-undo-close-button':
			this.hide();
			break;
		}
	},

	/**
	   * Undo the last blocked site.
	   * @returns {Promise<void>}
	   */
	async _undo() {
		if (!this._undoData) {
			return;
		}

		let {wasPinned, blockedLink} = this._undoData;
		await Blocked.unblock(blockedLink.url);

		if (wasPinned) {
			Tiles.putTile(blockedLink);
		}

		Updater.updateGrid();
		this.hide();
	},

	/**
	   * Undo all blocked sites.
	   * @returns {Promise<void>}
	   */
	async _undoAll() {
		await Blocked.clear();
		Updater.updateGrid();
		this.hide();
	}
};
