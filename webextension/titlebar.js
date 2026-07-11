/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): the recently-closed-tabs titlebar row
// extracted verbatim from newTab.js: `_initTitlebar`/`_layoutTitlebar`/
// `refreshRecent`/`_formatAge` + `computeTitlebarSlots` + their private
// state (`_titlebarResizeObserver`/`_recentCardCount`/`_recentFaviconURLs`,
// newTab.js's former `this.` state, now explicit module state).
// `uiRefs.recentList` replaces the former `this.recentList` read
// (ui-refs.js); `isValidURL` is imported directly from common.js instead of
// via `newTabTools.isValidURL`. `Grid.sites` is read call-time only (inside
// `refreshRecent`), extending the existing newTab.js<->grid.js<->site.js
// cycle (grid.js imports newTab.js) with one more call-time-only edge —
// this file itself never imports newTab.js and never calls updateUI.
import { Grid } from './grid.js';
import { Prefs } from './prefs.js';
import { NttIcons } from './icons.js';
import { isValidURL } from './common.js';
import { el } from './dom.js';
import { uiRefs } from './ui-refs.js';
import { api } from './api.js';

/**
 * Titlebar recently-closed-row ResizeObserver (_initTitlebar).
 * @type {ResizeObserver | undefined}
 */
let _titlebarResizeObserver;
/**
 * Cached recent-card capacity from the last _layoutTitlebar() call.
 * Write-only: was already dead the same way as a `this._recentCardCount =
 * …` object-property write in the original newTab.js (nothing ever read it
 * back there either — `refreshRecent` uses `_layoutTitlebar()`'s RETURN
 * value instead) — moved verbatim, not fixed (chrome-prep C4d); only
 * newly lint-visible because a lexical module `let` binding is, unlike an
 * object property, tracked by `no-unused-vars`.
 * @type {number | undefined}
 */
// eslint-disable-next-line no-unused-vars -- write-only, preserved verbatim; see comment above
let _recentCardCount;
/**
 * Object URLs created for recently-closed-tab favicon fallbacks
 * (refreshRecent) — revoked before the next render (§4.3).
 * @type {string[] | undefined}
 */
let _recentFaviconURLs;

/**
 * `browser.tabs.Tab` really does carry a `lastModified` timestamp when
 * obtained via the `sessions` API (`browser.sessions.Session.tab`) — real at
 * runtime, missing from `@types/firefox-webext-browser`'s `Tab` interface (a
 * gap in the third-party package). Used by `refreshRecent`'s destructure.
 * @typedef {browser.tabs.Tab & {lastModified?: number}} SessionTab
 */

export function _initTitlebar() {
	let searchEl = document.getElementById('ntt-search');
	if (searchEl) {
		let icon = NttIcons.create('search', 14);
		// `create` returns `null` only for an unknown icon name — 'search'
		// is always valid, but the existing code never guarded this.
		// Cast, not a fix.
		searchEl.insertBefore(/** @type {Element} */ (icon), searchEl.firstChild);
	}
	_layoutTitlebar();
	// Re-flow the recently-closed row whenever the space available to it
	// actually changes — window resize, spacing / outer-padding changes,
	// the search toggle (hiding the search box widens the row), and the
	// config-drawer push-layout (which animates over ~220ms). The recent
	// container is a greedy flex child, so observing ITS size captures all
	// of those in one signal. A ResizeObserver tracks the settled width
	// continuously, which is far more robust than a one-shot post-transition
	// timer: that timer could fire mid-animation, cap the card count against
	// a transient narrow width, and then never recover once the width
	// settled (the reported "drawer collapses the row and closing it doesn't
	// restore" bug). Re-flowing only changes the cards' width, not the
	// container's, so this never feeds back into itself.
	let recent = document.getElementById('ntt-titlebar-recent');
	if (recent && typeof ResizeObserver !== 'undefined') {
		let scheduled = false;
		_titlebarResizeObserver = new ResizeObserver(() => {
			if (scheduled) {
				return;
			}
			scheduled = true;
			requestAnimationFrame(() => {
				scheduled = false;
				refreshRecent();
			});
		});
		_titlebarResizeObserver.observe(recent);
	}
	// A web-font swap changes the masthead's width and thus the room left
	// for cards; re-flow once fonts settle so the first paint isn't off by
	// a card.
	if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
		document.fonts.ready.then(() => refreshRecent());
	}
}

/**
 * Measure the greedy recently-closed card container and set `--ntt-slot-w`
 * so the cards shrink to fill it edge-to-edge (see computeTitlebarSlots).
 * Stashes the recent-card cap on `_recentCardCount` for refreshRecent.
 * Returns the slot descriptor so callers can chain.
 */
export function _layoutTitlebar() {
	let titlebar = document.getElementById('ntt-titlebar');
	let recent = document.getElementById('ntt-titlebar-recent');
	if (!titlebar || !recent) {
		_recentCardCount = 0;
		return { cardCount: 0, slotWidth: 186 };
	}
	// The recent-cards container is a greedy flex child, so the browser has
	// already sized it to exactly the room left after the fixed search box
	// and the content-width masthead — whether the search box is shown,
	// whether the config drawer is open, and at any window width. We just
	// read that settled width. It must be laid out (not display:none) to
	// report a real width AND to keep pinning the masthead right, so the
	// container is always visible — when there are no cards it is simply an
	// empty spacer.
	recent.hidden = false;
	let cs = window.getComputedStyle(titlebar);
	let gap = parseFloat(cs.columnGap || cs.gap) || 10;
	let cardSpace = recent.clientWidth;
	if (!cardSpace || cardSpace < 0) {
		cardSpace = 0;
	}
	let slots = computeTitlebarSlots(cardSpace, gap, 186);
	// `recent` pref off → never show cards (the empty greedy container still
	// acts as the spacer that pins the masthead right).
	if (!Prefs.recent) {
		slots.cardCount = 0;
	}
	titlebar.style.setProperty('--ntt-slot-w', slots.slotWidth + 'px');
	_recentCardCount = slots.cardCount;
	return slots;
}

/**
 * @param {number | undefined} lastModified
 * @returns {string}
 */
export function _formatAge(lastModified) {
	if (!lastModified) {
		return '';
	}
	let seconds = Math.floor(Date.now() / 1000) - lastModified;
	if (seconds < 60) {
		return seconds + 's';
	}
	let minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return minutes + 'm';
	}
	let hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return hours + 'h';
	}
	let days = Math.floor(hours / 24);
	return days + 'd';
}

export function refreshRecent() {
	// Re-flow the titlebar slots first so `_recentCardCount` reflects the
	// current width before we decide how many cards to render.
	let slots = _layoutTitlebar();
	let cap = slots ? slots.cardCount : 0;
	let strip = uiRefs.recentList;
	if (!strip) {
		return;
	}

	if (!Prefs.recent || cap <= 0) {
		// No cards to show, but keep the (empty) container laid out: it is
		// the greedy spacer that pins the masthead to the right edge.
		for (let element of strip.querySelectorAll('.ntt-recent-card')) {
			strip.removeChild(element);
		}
		return;
	}

	api.sessions.getRecentlyClosed(/** @param {browser.sessions.Session[]} undoItems */ undoItems => {
		let added = 0;

		for (let element of strip.querySelectorAll('.ntt-recent-card')) {
			strip.removeChild(element);
		}

		// The cards are rebuilt from scratch — revoke the prior render's
		// favicon blob URLs before this render creates new ones (§4.3).
		for (let staleURL of _recentFaviconURLs || []) {
			URL.revokeObjectURL(staleURL);
		}
		_recentFaviconURLs = [];

		// `this` is typed `GlobalEventHandlers` (matching `onclick`'s
		// declared handler signature, which this function is assigned
		// to below) rather than `HTMLElement` — cast at the one member
		// access that needs it.
		/** @this {GlobalEventHandlers} */
		function card_onclick() {
			api.sessions.restore(/** @type {HTMLElement} */ (this).dataset.sessionId);
			return false;
		}

		let tileURLs = new Set();
		if (Grid.sites) {
			for (let site of Grid.sites) {
				if (site && site.url) {
					tileURLs.add(site.url);
				}
			}
		}
		let seen = new Set();
		/** @type {Array<{host: string, fav: HTMLElement}>} */
		let needFavicon = [];

		for (let item of undoItems) {
			if (added >= cap) {
				break;
			}
			if (!item.tab || item.tab.incognito) {
				continue;
			}
			if (item.tab.url && item.tab.url.startsWith('moz-extension://')) {
				continue;
			}
			// Validate the tab URL's protocol before it becomes `card.href`.
			// Middle-click / Ctrl+click bypass the onclick restore handler and
			// navigate the href directly, so a `javascript:`/`data:` session
			// URL must be filtered at this data boundary (mirrors the
			// favIconUrl validation below).
			if (!isValidURL(/** @type {string} */ (item.tab.url))) {
				continue;
			}
			if (tileURLs.has(item.tab.url)) {
				continue;
			}

			// `url` is cast non-optional: the guards above already
			// require a valid, present `item.tab.url` — a fresh
			// destructured binding doesn't inherit that narrowing.
			// `SessionTab` adds `lastModified` (real at runtime — a
			// `browser.sessions`-obtained tab — but missing from
			// `@types/firefox-webext-browser`'s plain `Tab`).
			let {url, title, sessionId, favIconUrl, lastModified} = /** @type {SessionTab & {url: string}} */ (item.tab);
			let displayTitle = title || url;
			let domain;
			try {
				// Registrable-ish domain: drop a leading `www.` so the chip
				// reads `theverge.com`, not `www.theverge.com` (§4).
				domain = new URL(url).hostname.replace(/^www\./, '');
			} catch (e) {
				domain = url;
			}

			let dedup = (title || '') + '\n' + domain;
			if (seen.has(dedup)) {
				continue;
			}
			seen.add(dedup);

			let card = document.createElement('a');
			card.href = url;
			card.className = 'ntt-recent-card';
			// `title` may be `undefined` (Tab.title is optional) — no
			// guard here before this slice either. Cast, not a fix.
			card.title = /** @type {string} */ (!title || title == url ? title : title + '\n' + url);
			card.dataset.sessionId = /** @type {string} */ (sessionId);
			card.onclick = card_onclick;

			let fav = el('span', 'ntt-recent-favicon');
			// Letter fallback from the registrable domain (same logic as the
			// tiles), not the page title — `H` for heise.de, not the headline.
			let glyph = (domain.charAt(0) || displayTitle.charAt(0) || '?').toUpperCase();
			let hue = (url.length * 7 + glyph.charCodeAt(0) * 13) % 360;
			fav.style.backgroundColor = 'hsl(' + hue + ', 50%, 40%)';
			if (favIconUrl && isValidURL(favIconUrl)) {
				let img = document.createElement('img');
				img.onerror = function() { this.remove(); };
				img.src = favIconUrl;
				fav.appendChild(img);
			} else {
				fav.appendChild(document.createTextNode(glyph));
				// No favicon in the session record — try the extension's stored
				// favicon once the row is built. Favicons are per-site, but a
				// recently-closed tab is usually a deep article URL that won't
				// exact-match a stored tile/homepage URL, so match by host.
				needFavicon.push({ host: domain, fav });
			}
			card.appendChild(fav);

			let text = el('span', 'ntt-recent-text');
			let nameEl = el('span', 'ntt-recent-name');
			nameEl.appendChild(document.createTextNode(displayTitle));
			text.appendChild(nameEl);
			let urlEl = el('span', 'ntt-recent-url');
			urlEl.appendChild(document.createTextNode(domain));
			text.appendChild(urlEl);
			card.appendChild(text);

			let age = _formatAge(lastModified);
			if (age) {
				let ageEl = el('span', 'ntt-recent-age');
				ageEl.appendChild(document.createTextNode(age));
				card.appendChild(ageEl);
			}

			strip.appendChild(card);
			added++;
		}
		strip.hidden = !added;

		// §3c: cards that fell back to the letter glyph use the extension's
		// stored favicon (collected during tile capture) when one exists —
		// closed-tab session data often carries no favIconUrl. Match by host
		// (favicons are per-site) so a deep article URL reuses the site's
		// stored favicon.
		if (needFavicon.length) {
			let hosts = [...new Set(needFavicon.map(n => n.host).filter(Boolean))];
			api.runtime.sendMessage({ name: 'Thumbnails.getFaviconsByHost', hosts }, /** @param {Map<string, Blob | string> | undefined} favicons */ favicons => {
				if (!favicons || typeof favicons.get !== 'function') {
					return;
				}
				for (let { host, fav } of needFavicon) {
					let favicon = host && favicons.get(host);
					/** @type {string | null} */
					let src = null;
					if (favicon instanceof Blob) {
						src = URL.createObjectURL(favicon);
						// `_recentFaviconURLs` was just reset to `[]` above
						// in the enclosing `getRecentlyClosed` callback, but
						// that's a different closure boundary from this
						// nested `sendMessage` callback, so tsc can't carry
						// the narrowing through — cast, not a fix.
						/** @type {string[]} */ (_recentFaviconURLs).push(src);
					} else if (typeof favicon === 'string' && isValidURL(favicon)) {
						src = favicon;
					}
					if (!src) {
						continue;
					}
					let img = document.createElement('img');
					img.onerror = function() { this.remove(); };
					img.src = src;
					for (let node of [...fav.childNodes]) {
						if (node.nodeType === Node.TEXT_NODE) {
							node.remove();
						}
					}
					fav.appendChild(img);
				}
			});
		}
	});
}

/**
 * @param {number} cardSpace
 * @param {number} gap
 * @param {number} [full]
 * @returns {{cardCount: number, slotWidth: number}}
 */
export function computeTitlebarSlots(cardSpace, gap, full = 186) {
	// `cardSpace` is the measured inner width of the recently-closed cards'
	// flex container (a greedy `flex: 1 1 0` child). It already excludes the
	// fixed search box, the content-width masthead and their gaps, so the
	// only job here is: how many cards fit, and how wide is each?
	//
	// Pick the SMALLEST card count whose common width — when the cards are
	// stretched to fill `cardSpace` with their internal gaps — stays at or
	// below `full`, then shrink that width down so the row fills the
	// container edge-to-edge (never grown above `full`). Reading a settled
	// integer `clientWidth` is far more stable than the old approach of
	// hand-subtracting a `getBoundingClientRect()` masthead measurement,
	// which jittered mid drawer-transition and left the row stuck at one
	// card until a reload.
	if (!cardSpace || cardSpace <= 0) {
		return { cardCount: 0, slotWidth: full };
	}
	let cardCount = Math.ceil((cardSpace + gap) / (full + gap));
	if (cardCount < 1) {
		cardCount = 1;
	}
	let slotWidth = Math.floor((cardSpace - (cardCount - 1) * gap) / cardCount);
	if (slotWidth > full) {
		slotWidth = full;
	}
	if (slotWidth < 1) {
		slotWidth = 1;
	}
	return { cardCount, slotWidth };
}
