/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4c (CHROME_PREP.md): extracted verbatim (C3b typed the `Site`
// constructor+prototype before this slice moved it; no rewrite, per the
// arc's slicing rule), plus its three private rendering helpers
// (`siteGlyph`/`siteHue`/`siteBrandColor` — C2 confirmed `siteBrandColor` has
// exactly one production consumer, `_renderLogoFallback` below, and left it
// in place rather than extracting it further; it and its two helpers travel
// with their sole consumer here). `Grid` (this slice's sibling mover,
// grid.js) is a real VALUE import — the never-capture click handler below
// calls `Grid.refresh()` — which makes this file and grid.js mutually
// importing: grid.js imports `Site` back (`Grid.createSite` constructs one)
// — a legal ESM cycle under Decision 3 (PAGE_MODULES.md): every
// cross-reference is call-time only (inside a method/callback body), never a
// top-level read, the same shape as every other cycle this program has
// threaded (newTab.js<->grid.js, newTab.js<->page.js, grid.js<->site.js,
// transformation.js/updater.js/undo-dialog.js/drag-drop.js's own cycles with
// newTab.js). `Drag` (drag-drop.js, C4b) is a plain one-directional import —
// `Site.handleEvent`'s `dragstart`/`dragend` cases call `Drag.start`/
// `Drag.end` — drag-drop.js's own `Site` reference is type-only, so this
// isn't a new value cycle.
import { Tiles } from './tiles-shim.js';
import { Updater } from './updater.js';
import { UndoDialog } from './undo-dialog.js';
import { Blocked, NeverCapture, Prefs } from './prefs.js';
import { NttIcons } from './icons.js';
import { newTabTools } from './newTab.js';
import { el } from './dom.js';
import { TileStats } from './stats.js';
import { Grid } from './grid.js';
import { Drag } from './drag-drop.js';
import { api } from './api.js';

/**
 * The persisted tile/link shape a `Site` wraps. Reused from tiles-shim.js
 * (the leaf this file already imports `Tiles` from — see its `Tile`
 * typedef, mirroring lib/tiles-store.js's background-side model) rather
 * than duplicated here. Owned here (not grid.js) per the arc's
 * typedef-ownership rule: a `Site` IS a `Link` wrapper, the more fundamental
 * relationship of this shape's two real consumers (`Grid.createSite`'s
 * `link` parameter is the other, type-only import there).
 * @typedef {import('./tiles-shim.js').Tile} Link
 */

/**
 * `Cell`/`CellNode` stay owned by cell.js — referenced here (type-only,
 * erased at compile time) because `Site.prototype.cell` reads a site's
 * parent node's `_newtabCell` expando, and `Site.pin()` casts the result to
 * `Cell` to read its `.index`.
 * @typedef {import('./cell.js').Cell} Cell
 * @typedef {import('./cell.js').CellNode} CellNode
 */

/**
 * Expando back-reference from a site's DOM node to its `Site` wrapper
 * (`Site`'s constructor sets `node._newtabSite = this`). Not part of
 * `lib.dom.d.ts`'s `HTMLElement`, hence the local alias — `HTMLElement`
 * (not the plain `Element` the constructor receives) because every real
 * cell/site node is one, and callers read `.style`/`.offsetWidth`/etc.
 * @typedef {HTMLElement & { _newtabSite?: Site }} SiteNode
 */

// Fallback glyph for tiles/recent-cards with no thumbnail or favicon. This is
// deliberately a SINGLE uppercase letter (the host's first character), matching
// how Firefox and Chrome render fallback favicons. Multi-letter initials were
// considered for the v2 redesign and declined: deriving good 2-letter initials
// from a bare domain is heuristic and reads worse than one strong letter. Keep
// it single-letter — `.ntt-logo-glyph` is sized for exactly one character.
/**
 * @param {string} url
 * @returns {string}
 */
function siteGlyph(url) {
	try {
		let hostname = new URL(url).hostname.replace(/^www\./, '');
		return hostname.charAt(0).toUpperCase();
	} catch (ex) {
		return '·';
	}
}

/**
 * Deterministic hue (0-359) derived from a URL's hostname. Same host always
 * maps to the same hue. Falls back to null when the URL can't be parsed.
 *
 * Used by `Site._renderLogoFallback` so each domain-letter fallback tile
 * gets a distinct brand color instead of a uniform grey.
 * @param {string} url
 * @returns {number | null}
 */
function siteHue(url) {
	let host;
	try {
		host = new URL(url).hostname.replace(/^www\./, '');
	} catch (ex) {
		return null;
	}
	if (!host) {
		return null;
	}
	let h = 0;
	for (let i = 0; i < host.length; i++) {
		h = ((h * 31) + host.charCodeAt(i)) | 0;
	}
	return ((h % 360) + 360) % 360;
}

/**
 * Resolve a CSS brand color for a tile's fallback rendering. Order of
 * precedence:
 *   1. `link.backgroundColor` if the user set one explicitly (validated as
 *      a hex color).
 *   2. Domain-hash → hsl(...) so each hostname gets a stable distinct tone.
 *   3. `#666` neutral grey if the URL can't be parsed.
 * @param {Link} [link]
 * @returns {string}
 */
function siteBrandColor(link) {
	let raw = link && link.backgroundColor;
	if (raw && /^#[0-9a-f]{3,8}$/i.test(raw)) {
		return raw;
	}
	let hue = link ? siteHue(link.url) : null;
	if (hue == null) {
		return '#666';
	}
	// OKLCH instead of HSL: perceptually-uniform lightness/chroma across
	// hues, so white glyph text on the surround has consistent contrast no
	// matter which hostname hashed to which hue.
	return `oklch(65% 0.13 ${hue})`;
}

/**
 * This class represents a site that is contained in a cell and can be pinned,
 * moved around or deleted.
 * @constructor
 * @param {Element} node
 * @param {Link} link
 * @this {Site}
 */
export function Site(node, link) {
	this._node = /** @type {SiteNode} */ (node);
	this._node._newtabSite = this;

	this._link = link;

	this._render();
	this._addEventHandlers();
}

Site.prototype = {
	/**
	   * The site's DOM node.
	   * @this {Site}
	   */
	get node() { return this._node; },

	/**
	   * The site's link.
	   * @this {Site}
	   */
	get link() { return this._link; },

	/**
	   * The url of the site's link.
	   * @this {Site}
	   */
	get url() { return this.link.url; },

	/**
	   * The title of the site's link.
	   * @this {Site}
	   */
	get title() { return this.link.title; },

	/**
	   * The site's parent cell.
	   * @this {Site}
	   */
	get cell() {
		let parentNode = /** @type {CellNode | null} */ (this.node.parentNode);
		return parentNode && parentNode._newtabCell;
	},

	/** @this {Site} */
	get thumbnail() {
		return /** @type {HTMLElement} */ (this._querySelector('.newtab-thumbnail'));
	},

	/** @this {Site} */
	get overlay() {
		return this._querySelector('.ntt-overlay');
	},

	/**
	   * Pins the site on its current or a given index.
	   * @param {number} [index] The pinned index (optional).
	   */
	pin(index) {
		if (typeof index == 'undefined') {
			index = /** @type {Cell} */ (this.cell).index;
		}

		this.updateAttributes(true);
		this._link.position = index;
		Tiles.putTile(this._link);
	},

	/**
	   * Unpins the site and calls the given callback when done.
	   */
	unpin() {
		if (this.isPinned) {
			this.updateAttributes(false);

			let op;
			if (Object.keys(this._link).some(k => !['id', 'title', 'url', 'position'].includes(k))) {
				delete this._link.position;
				op = Tiles.putTile(this._link);
			} else {
				op = Tiles.removeTile(this._link).then(() => {
					delete this._link.id;
					delete this._link.position;
				});
			}

			op.then(() => {
				Updater.updateGrid();
			});
		}
	},

	/**
	   * Checks whether this site is pinned.
	   * @return {boolean} Whether this site is pinned.
	   * @this {Site}
	   */
	get isPinned() {
		return Tiles.isPinned(this._link.url);
	},

	/**
	   * Blocks the site (removes it from the grid) and calls the given callback
	   * when done.
	   * @returns {Promise<void>}
	   */
	async block() {
		if (!Blocked.isBlocked(this._link.url)) {
			UndoDialog.show(this);
			await Blocked.block(this._link.url);

			if (this.isPinned) {
				await Tiles.removeTile(this._link);
			}

			Updater.updateGrid();
		}
	},

	/**
	   * Gets the DOM node specified by the given query selector.
	   * @param {string} selector The query selector.
	   * @return {Element | null} The DOM node we found.
	   */
	_querySelector(selector) {
		return this.node.querySelector(selector);
	},

	/**
	   * Updates attributes for all nodes which status depends on this site being
	   * pinned or unpinned.
	   * @param {boolean} pinned Whether this site is now pinned or unpinned.
	   */
	updateAttributes(pinned) {
		if (pinned) {
			this._node.setAttribute('pinned', 'true');
		} else {
			this._node.removeAttribute('pinned');
		}
		let pinBtn = this._querySelector('.ntt-action-btn[data-action="pin"]');
		if (pinBtn) {
			pinBtn.setAttribute('title', newTabTools.getString(pinned ? 'tile_unpin' : 'tile_pin'));
			// Swap the SVG icon to match the new state so the affordance
			// flips immediately on toggle. Lucide-style `pin-off` (diagonal
			// slash) reads as "click to unpin".
			let nextIcon = pinned ? 'unpin' : 'pin';
			pinBtn.setAttribute('data-icon', nextIcon);
			let existing = pinBtn.firstElementChild;
			let svg = NttIcons.create(nextIcon, 16);
			if (svg) {
				if (existing) {
					pinBtn.replaceChild(svg, existing);
				} else {
					pinBtn.appendChild(svg);
				}
			}
		}
	},

	/**
	 * Flips the never-capture button icon/title and toggles the node attribute
	 * to match the new listed state. Modeled on updateAttributes (pin swap).
	 * @param {boolean} listed Whether the site is now in the never-capture list.
	 */
	updateNeverCaptureButton(listed) {
		if (listed) {
			this._node.setAttribute('never-capture', 'true');
		} else {
			this._node.removeAttribute('never-capture');
		}
		let btn = this._querySelector('.ntt-action-btn[data-action="never-capture"]');
		if (btn) {
			let nextIcon = listed ? 'camera' : 'camera-off';
			let nextTitle = listed ? 'tile_allow_capture' : 'tile_never_capture';
			btn.setAttribute('data-icon', nextIcon);
			btn.setAttribute('title', newTabTools.getString(nextTitle));
			let existing = btn.firstElementChild;
			let svg = NttIcons.create(nextIcon, 16);
			if (svg) {
				if (existing) {
					btn.replaceChild(svg, existing);
				} else {
					btn.appendChild(svg);
				}
			}
		}
	},

	/**
	   * Renders the site's data (fills the HTML fragment).
	   */
	_render() {
		if (this.isPinned) {
			this.updateAttributes(true);
		}
		this.refreshThumbnail();
		this.addTitle();
		this._renderActions();
		this._renderFavicon();
		this._renderStatChip();
	},

	_renderStatChip() {
		let chip = this._querySelector('.ntt-stat-chip');
		if (!chip) {
			return;
		}
		let statType = Prefs.statType;
		if (statType === 'none') {
			chip.textContent = '';
			chip.removeAttribute('data-stat-fresh');
			return;
		}
		let rank = this.cell ? this.cell.index + 1 : null;
		TileStats.compute(this.url, statType, /** @type {number} */ (rank)).then((/** @type {{type: string, value: string, dir?: string} | null} */ stat) => {
			if (!stat) {
				chip.textContent = '';
				chip.removeAttribute('data-stat-fresh');
				return;
			}
			if (stat.type === 'trend') {
				chip.removeAttribute('data-stat-fresh');
				chip.textContent = (stat.dir === 'up' ? '↑' : '↓') + stat.value;
			} else if (stat.type === 'rank') {
				chip.removeAttribute('data-stat-fresh');
				chip.textContent = '#' + stat.value;
			} else if (stat.type === 'fresh') {
				chip.textContent = '';
				chip.setAttribute('data-stat-fresh', '');
			} else {
				chip.removeAttribute('data-stat-fresh');
				chip.textContent = stat.value;
			}
		});
	},

	addTitle() {
		let url = this.url;
		let title = this.title || url;
		let tooltip = title == url ? title : title + '\n' + url;

		let titleElement = /** @type {HTMLElement} */ (this.node.querySelector('.newtab-title'));
		titleElement.textContent = title;

		let link = /** @type {HTMLAnchorElement} */ (this._querySelector('.newtab-link'));
		link.setAttribute('title', tooltip);
		try {
			if (['http:', 'https:', 'ftp:'].includes(new URL(url).protocol)) {
				link.setAttribute('href', url);
			} else {
				link.setAttribute('href', '#');
			}
		} catch (ex) {
			link.setAttribute('href', '#');
		}
	},

	_renderFavicon() {
		let favicon = /** @type {HTMLElement} */ (this._querySelector('.ntt-favicon'));
		if (!favicon) {
			return;
		}
		let rawColor = this.link.backgroundColor || '#666';
		let brandColor = /^#[0-9a-f]{3,8}$/i.test(rawColor) ? rawColor : '#666';
		favicon.style.backgroundColor = brandColor;
		favicon.textContent = siteGlyph(this.url);
	},

	_renderActions() {
		let container = this._querySelector('.ntt-actions');
		if (!container || container.children.length > 0) {
			return;
		}
		// At-rest affordance: a single kebab that the hover row replaces (§3c).
		let kebab = this._querySelector('.ntt-actions-kebab');
		if (kebab && kebab.children.length === 0) {
			let kebabIcon = NttIcons.create('kebab', 16);
			if (kebabIcon) {
				kebab.appendChild(kebabIcon);
			}
		}
		// Edit-mode affordances (§2): a centred drag handle (shown on pinned tiles
		// while editing) and an "Add tile" prompt (shown on auto tiles while
		// editing). CSS keeps both hidden outside edit mode (`:root[drawer-open]`).
		let dragHandle = this._querySelector('.ntt-drag-handle');
		if (dragHandle && dragHandle.children.length === 0) {
			let grip = NttIcons.create('grip', 18);
			if (grip) {
				dragHandle.appendChild(grip);
			}
		}
		let addTile = this._querySelector('.ntt-add-tile');
		if (addTile && !addTile.querySelector('.ntt-add-tile-chip')) {
			// The label is an opaque chip so it reads over any thumbnail (the slot
			// keeps its real thumbnail under a light scrim — no opacity dim).
			let chip = el('span', 'ntt-add-tile-chip', newTabTools.getString('tile_add'));
			addTile.textContent = '';
			addTile.appendChild(chip);
		}
		// §3c order: Edit URL · Never-capture · Pin/Unpin · Remove. "Open in new tab"
		// was dropped — clicking the tile already opens it (middle-/⌘-click for
		// a new tab).
		let neverCaptureActive = NeverCapture.matches(this.url);
		if (neverCaptureActive) {
			this._node.setAttribute('never-capture', 'true');
		} else {
			this._node.removeAttribute('never-capture');
		}
		let actions = [
			{ action: 'edit', icon: 'edit', title: 'tile_edit_url' },
			{ action: 'never-capture', icon: neverCaptureActive ? 'camera' : 'camera-off', title: neverCaptureActive ? 'tile_allow_capture' : 'tile_never_capture' },
			{ action: 'pin', icon: this.isPinned ? 'unpin' : 'pin', title: this.isPinned ? 'tile_unpin' : 'tile_pin' },
			{ action: 'remove', icon: 'close', title: 'tile_block' },
		];

		for (let def of actions) {
			let btn = el('button', 'ntt-action-btn');
			btn.setAttribute('type', 'button');
			btn.setAttribute('data-action', def.action);
			btn.setAttribute('data-icon', def.icon);
			btn.setAttribute('title', newTabTools.getString(def.title));
			let icon = NttIcons.create(def.icon, 16);
			if (icon) {
				btn.appendChild(icon);
			}
			container.appendChild(btn);
		}
	},

	refreshThumbnail() {
		let thumbnail = this.thumbnail;
		if (this.link.image) {
			if (this._thumbnailObjectURL) {
				URL.revokeObjectURL(this._thumbnailObjectURL);
			}
			let thumbnailURL = URL.createObjectURL(this.link.image);
			this._thumbnailObjectURL = thumbnailURL;
			thumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			// `style.backgroundColor`'s setter is `[LegacyNullToEmptyString]`,
			// so assigning `null` behaves like `''` at the DOM level — but the
			// cast preserves the original `null` value at the JS-level
			// assignment rather than substituting a different literal.
			thumbnail.style.backgroundColor = /** @type {string} */ (/** @type {unknown} */ (this.link.backgroundColor || null));
			if (this.link.imageIsThumbnail) {
				thumbnail.classList.remove('custom-thumbnail');
			} else {
				thumbnail.classList.add('custom-thumbnail');
			}
			let fallback = thumbnail.querySelector('.ntt-logo-fallback');
			if (fallback) {
				fallback.remove();
			}
		} else {
			thumbnail.style.backgroundImage = /** @type {string} */ (/** @type {unknown} */ (null));
			thumbnail.classList.remove('custom-thumbnail');
			this._renderLogoFallback();
		}
	},

	_renderLogoFallback() {
		let thumbnail = this.thumbnail;
		if (thumbnail.querySelector('.ntt-logo-fallback')) {
			return;
		}
		let brandColor = siteBrandColor(this.link);

		let fallback = el('div', 'ntt-logo-fallback');
		fallback.style.setProperty('--ntt-brand', brandColor);

		let glyphEl = el('div', 'ntt-logo-glyph', siteGlyph(this.url));
		fallback.appendChild(glyphEl);

		thumbnail.appendChild(fallback);
	},

	/**
	 * Swap the letter glyph inside the existing logo-fallback for a real
	 * favicon `<img>`. Called from `newTabTools.getFavicons` once the
	 * background returns a favicon for this site's URL — either a cached
	 * `data:`-favicon Blob (turned into an object URL) or a remote favicon URL
	 * string (used directly as the `<img src>`, governed by `img-src https:`,
	 * no fetch). Safe to call even if the fallback has since been replaced by a
	 * screenshot — guards on the glyph element's presence.
	 * @param {Blob | string | null | undefined} favicon
	 */
	applyFavicon(favicon) {
		if (!favicon) {
			return;
		}
		// Two render targets: the big centred glyph that shows only when no
		// screenshot has been captured yet (`.ntt-logo-fallback`), and the
		// small badge in the bottom overlay that's always present
		// (`.ntt-favicon`). Updating both means the captured favicon is
		// visible even after a screenshot has covered the fallback.
		let fallback = this._querySelector('.ntt-logo-fallback');
		let badge = this._querySelector('.ntt-favicon');
		if (!fallback && !badge) {
			return;
		}
		// A Blob (cached data: favicon) becomes an object URL we own + revoke;
		// a string is a remote favicon URL we point <img> at directly.
		let src;
		if (typeof favicon === 'string') {
			src = favicon;
		} else {
			if (this._faviconObjectURL) {
				URL.revokeObjectURL(this._faviconObjectURL);
			}
			this._faviconObjectURL = URL.createObjectURL(favicon);
			src = this._faviconObjectURL;
		}

		if (fallback) {
			let glyph = fallback.querySelector('.ntt-logo-glyph');
			if (glyph) {
				let img = /** @type {HTMLImageElement} */ (el('img', 'ntt-logo-favicon'));
				img.src = src;
				img.alt = '';
				fallback.replaceChild(img, glyph);
			}
		}
		if (badge) {
			badge.textContent = '';
			/** @type {HTMLElement} */ (badge).style.backgroundColor = '#fff';
			let img = document.createElement('img');
			img.src = src;
			img.alt = '';
			badge.appendChild(img);
		}
	},

	/**
	 * Revokes both cached blob URLs (`_thumbnailObjectURL`/
	 * `_faviconObjectURL`, set by `refreshThumbnail`/`applyFavicon` above) and
	 * nulls them. `Grid.refresh()` (grid.js) calls this on every existing site
	 * before it flushes the grid's cells — without it, an orphaned `Site`
	 * instance's blob URLs are never revoked (they're only otherwise freed on
	 * document unload). Idempotent: safe to call more than once, including on
	 * a site that never set either URL.
	 * @this {Site}
	 */
	destroy() {
		if (this._thumbnailObjectURL) {
			URL.revokeObjectURL(this._thumbnailObjectURL);
			this._thumbnailObjectURL = null;
		}
		if (this._faviconObjectURL) {
			URL.revokeObjectURL(this._faviconObjectURL);
			this._faviconObjectURL = null;
		}
	},

	/**
	   * Adds event handlers for the site and its buttons.
	   */
	_addEventHandlers() {
		// Register drag-and-drop event handlers.
		this._node.addEventListener('dragstart', this);
		this._node.addEventListener('dragend', this);
		this._node.addEventListener('click', this);
	},

	/**
	   * Handles site click events.
	   * @param {MouseEvent} event
	   */
	_onClick(event) {
		let target = /** @type {Element} */ (event.target);
		let actionBtn = target.closest('.ntt-action-btn');
		if (actionBtn) {
			event.preventDefault();
			let action = actionBtn.getAttribute('data-action');
			switch (action) {
			case 'remove':
				this.block().catch(e => console.error('Site.block failed:', e));
				break;
			case 'pin':
				if (this.isPinned) {
					this.unpin();
				} else {
					this.pin();
				}
				break;
			case 'never-capture': {
				// Derive host (port-less, matching NeverCapture semantics); bail
				// silently on non-parseable URLs.
				let host;
				try {
					host = new URL(this.link.url).hostname;
				} catch (_) {
					break;
				}
				if (NeverCapture.matches(this.link.url)) {
					// Currently listed — remove and flip button back.
					NeverCapture.remove(host);
					this.updateNeverCaptureButton(false);
				} else {
					// Not listed — add, purge stored screenshots, flip button.
					// No undo toast by design: purged screenshots must not be
					// restorable; toggle-off does not recapture (next visit does).
					NeverCapture.add(host);
					api.runtime.sendMessage({ name: 'Thumbnails.purgeHost', host }, () => {
						Grid.refresh().then(() => newTabTools.getThumbnails());
					});
					this.updateNeverCaptureButton(true);
				}
				break;
			}
			case 'edit':
				newTabTools.openDrawer();
				newTabTools.switchDrawerTab('tile');
				if (this.cell) {
					newTabTools.selectedSiteIndex = this.cell.index;
				}
				break;
			}
			return;
		}

		// "+ Pin tile" (§7): clicking a candidate's add-tile slot pins it
		// immediately (same effect as the Pin action) AND opens the Add-tile (Tile)
		// menu with the now-pinned tile selected — so label and behaviour agree.
		if (target.closest('.ntt-add-tile')) {
			event.preventDefault();
			let cellIndex = this.cell ? this.cell.index : null;
			if (!this.isPinned) {
				this.pin();
			}
			newTabTools.openDrawer();
			newTabTools.switchDrawerTab('tile');
			if (cellIndex != null) {
				newTabTools.selectedSiteIndex = cellIndex;
			}
			return;
		}

		// Edit mode: clicking a tile body (anywhere but an action button / the
		// "+ Pin tile" slot, both handled above) opens the Tile dialog PREFILLED for
		// this tile — so the user can edit its URL, thumbnail, or background colour.
		// Works from any drawer tab (not just the Tile tab); drag-to-Move is separate
		// (the drag handler distinguishes a click from a drag).
		let docEl = document.documentElement;
		if (docEl.hasAttribute('drawer-open')) {
			event.preventDefault();
			if (this.cell) {
				newTabTools.openDrawer();
				newTabTools.switchDrawerTab('tile');
				newTabTools.selectedSiteIndex = this.cell.index;
			}
			return;
		}

		if (target.classList.contains('newtab-link') ||
		target.closest('.newtab-link') ||
		target.closest('.ntt-overlay')) {
			return;
		}
	},

	/**
	   * Handles all site events.
	   * @param {MouseEvent | DragEvent} event
	   */
	handleEvent(event) {
		switch (event.type) {
		case 'click':
			this._onClick(event);
			break;
		case 'dragstart':
			if (Prefs.locked) {
				event.preventDefault();
			} else {
				Drag.start(this, /** @type {DragEvent} */ (event));
			}
			break;
		case 'dragend':
			Drag.end(this, /** @type {DragEvent} */ (event));
			break;
		}
	}
};
