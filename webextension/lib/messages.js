/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * runtime.onMessage dispatch (MODERNIZATION.md, Stage M, slice M5).
 *
 * Carved out of the former webextension/background.js verbatim: sender
 * validation, the (now 20) frozen wire names (MODERNIZATION.md Decision 3;
 * `Theme.colorScheme` added 2026-07-16, CHROME.md D4 — additions are allowed,
 * the decision only forbids renames/drops), response shapes, and the
 * never-capture guard are byte-equivalent — only
 * the dependencies changed, from background.js's bare-identifier globalThis
 * bridge reads to real `import`s of the lib modules that now own each piece
 * (Tiles/Background, withStore, the capture pipeline). The dual-scope
 * `NeverCapture` global (prefs.js, Decision 2, PAGE_MODULES.md Decision 6) is
 * a real `export` now, imported directly below. Its `globalThis.NeverCapture
 * = …` bridge assignment — once thought permanent, since the page read it as
 * a classic-`<script>` global — is retired as of chrome-prep C3d: newTab.js/
 * site.js now import it for real too, so nothing reads it off
 * `globalThis` anymore.
 *
 * `makeZip`/`readZip` (lib/backup.js) are a STATIC import again (CHROME.md
 * D5, 2026-07-16), reversing the 2026-07-09 adjudicated lazy-import design:
 * dynamic `import()` is disallowed on ServiceWorkerGlobalScope by the HTML
 * spec (w3c/ServiceWorker#1356), so the lazy path made 'Export:backup'/
 * 'Import:restore' structurally impossible on Chrome — the SW threw
 * `TypeError: import() is disallowed…` and the page saw a null response
 * (found by the Chrome smoke's backup check, first real run). The cost the
 * lazy design avoided — parsing lib/backup.js's vendored `lib/zip/**` ESM
 * tree (~25 files) on every background respawn even when no backup happens —
 * is knowingly re-accepted as the price of a single code path that works on
 * both platforms.
 *
 * `registerMessageHandler()` is called once, at lib/background-main.js's own
 * top level (still synchronous-on-import — same respawn-hygiene requirement
 * every other listener registration follows). `handleMessage` is exported
 * directly too, so tests can dispatch through it without a real
 * `browser.runtime.onMessage.addListener` round-trip.
 */

import { withObjectStore } from './db.js';
import { Tiles, Background } from './tiles-store.js';
import { getTZDateString } from './constants.js';
import { startCaptureSession, purgeNeverCaptureHost } from './capture.js';
import { makeZip, readZip } from './backup.js';
import { NeverCapture } from '../prefs.js';
import { api, broadcastToPages, syncActionIconWithTheme } from './platform.js';
import { _isServiceWorkerScope } from './thumbnail-image.js';

/**
 * Shared cursor walk backing both `Thumbnails.getFavicons` and
 * `Thumbnails.getFaviconsByHost` (issue #17 — the two were near-identical
 * copies). Walks the thumbnails store once, and for every row asks
 * `keyFor(row)` whether/how it should be recorded: a truthy return value is
 * the map key to record the row's favicon under, a falsy one skips the row.
 * First match wins per key — a no-op for `getFavicons` (one row per exact
 * URL, the store's keyPath) but load-bearing for `getFaviconsByHost` (several
 * URLs can share a host; the first one walked keeps it). Mutates `map`
 * in place (rather than returning a fresh one) so a caller's `.catch` can
 * still respond with whatever was collected before a failure, matching the
 * original per-handler behavior.
 * @param {Map<string, any>} map
 * @param {(row: any) => string|null|undefined} keyFor
 * @returns {Promise<void>}
 */
function walkFaviconsInto(map, keyFor) {
	return withObjectStore('thumbnails', 'readonly', function(store) {
		return new Promise(function(resolve) {
			store.openCursor().onsuccess = function() {
				let cursor = this.result;
				if (cursor) {
					let row = cursor.value;
					let key = keyFor(row);
					if (key && !map.has(key)) {
						if (row.favicon) {
							map.set(key, row.favicon);
						} else if (row.faviconUrl) {
							map.set(key, row.faviconUrl);
						}
					}
					cursor.continue();
				} else {
					resolve(undefined);
				}
			};
		});
	});
}

/**
 * The runtime.onMessage listener — dispatch table for the 20 frozen wire
 * names. `sender`/`sendResponse` are typed loosely (matching how this
 * dispatcher has always treated them) since the real contract is enforced by
 * `browser.runtime.onMessage.addListener`'s own signature at the single
 * registration call site in `registerMessageHandler()` below.
 * @param {any} message
 * @param {any} sender
 * @param {(...args: any[]) => any} sendResponse
 * @returns {boolean}
 */
export function handleMessage(message, sender, sendResponse) {
	// Sender validation. Only the extension's own pages may message the
	// background. The manifest does not declare `externally_connectable`, so
	// legitimate senders always carry `sender.id === browser.runtime.id`.
	// Anything else — including a content script in a hostile page reached
	// via `<all_urls>` — gets dropped here. See §2.4 of
	// audit/2026-05-04-security-review.md.
	if (!sender || sender.id !== api.runtime.id) {
		return false;
	}

	let today = getTZDateString();

	switch (message.name) {
	case 'Tiles.isPinned':
		// Tiles.ensureReady() -> getGridTiles() reaches withStore directly,
		// which awaits DB readiness itself.
		Tiles.ensureReady().then(() => {
			sendResponse(Tiles.isPinned(message.url));
		}).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Tiles.getAllTiles':
		// Wire name frozen (MODERNIZATION.md Decision 3); internal method
		// renamed getAllTiles -> getGridTiles (M2, lib/tiles-store.js).
		Tiles.getGridTiles().then(function(tiles) {
			sendResponse({ tiles, list: Tiles._list });
		}).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Tiles.getTile':
		Tiles.getTile(message.url).then(sendResponse, console.error);
		return true;
	case 'Tiles.putTile':
		Tiles.putTile(message.tile).then(sendResponse, console.error);
		return true;
	case 'Tiles.removeTile':
		Tiles.removeTile(message.tile).then(sendResponse, console.error);
		return true;
	// Exposes the existing Tiles.clear() (single IDB objectStore.clear) over
	// the message protocol. Added to support hermetic E2E test cleanup, but
	// also useful for any future "reset all tiles" UI action.
	case 'Tiles.clear':
		Tiles.clear().then(sendResponse);
		return true;
	case 'Tiles.pinTile':
		Tiles.pinTile(message.title, message.url).then(function(id) {
			// Broadcast so any open new-tab pages re-render the grid (Slice A
			// of the MV3 migration — replaces the extension.getViews() loop;
			// see pageMessageHandler in newTab.js). When no page is open the
			// broadcast rejects with "Receiving end does not exist" —
			// swallowed by lib/platform.js's broadcastToPages().
			broadcastToPages('Page.updateGrid');
			sendResponse(id);
		}, console.error);
		return true;

	case 'Background.getBackground':
		Background.getBackground().then(sendResponse).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Background.setBackground':
		Background.setBackground(message.file).then(sendResponse);
		return true;

	case 'Thumbnails.save':
		let {url, image} = message;
		// Never-capture guard: refuse to store a thumbnail for a listed host.
		if (url && image && !NeverCapture.matches(url)) {
			// Fire-and-forget write, so no sendResponse either way — just
			// don't reach the store before the connection is open.
			withObjectStore('thumbnails', 'readwrite', function(store) {
				store.put({
					url,
					image,
					stored: today,
					used: today
				});
			}).catch(console.error);
		}
		return false;
	case 'Thumbnails.get':
		// This fires on every new-tab-page load, so an event-page wake races
		// it against the still-opening connection; withStore() awaits
		// readiness itself.
		let map = new Map();
		withObjectStore('thumbnails', 'readwrite', function(store) {
			return new Promise(function(resolve) {
				store.openCursor().onsuccess = function() {
					let cursor = this.result;
					if (cursor) {
						let thumb = cursor.value;
						if (message.urls.includes(thumb.url)) {
							map.set(thumb.url, thumb.image);
							if (thumb.used != today) {
								thumb.used = today;
								cursor.update(thumb);
							}
						}
						cursor.continue();
					} else {
						resolve(undefined);
					}
				};
			});
		}).then(function() {
			sendResponse(map);
		}).catch(function(event) {
			console.error(event);
			sendResponse(map);
		});
		return true;

	case 'Thumbnails.capture':
		if (sender.tab) {
			startCaptureSession(sender.tab.id, sender.tab.windowId, sender.tab.url);
		}
		return false;

	case 'Thumbnails.getFavicons':
		// Walk the thumbnails store and return a `url -> (Blob | string)` map.
		// A cached `data:` favicon comes back as a `favicon` Blob; a remote
		// favicon comes back as its `faviconUrl` string for the page to render
		// live via <img>. The page-side handler distinguishes the two.
		let faviconMap = new Map();
		walkFaviconsInto(faviconMap, function(row) {
			return message.urls.includes(row.url) ? row.url : null;
		}).then(function() {
			sendResponse(faviconMap);
		}).catch(function(event) {
			console.error(event);
			sendResponse(faviconMap);
		});
		return true;

	case 'Thumbnails.getFaviconsByHost':
		// Like Thumbnails.getFavicons, but keyed by registrable host (leading
		// `www.` dropped) instead of exact URL. Favicons are per-site, so a
		// recently-closed deep article URL can reuse the favicon stored for any
		// page on the same site. Returns a `host -> (Blob | string)` map.
		let faviconsByHost = new Map();
		let wantedHosts = new Set(message.hosts || []);
		walkFaviconsInto(faviconsByHost, function(row) {
			let host = null;
			try { host = new URL(row.url).hostname.replace(/^www\./, ''); } catch (e) { /* skip unparseable */ }
			return host && wantedHosts.has(host) ? host : null;
		}).then(function() {
			sendResponse(faviconsByHost);
		}).catch(function(event) {
			console.error(event);
			sendResponse(faviconsByHost);
		});
		return true;

	case 'Thumbnails.delete':
		// Keep the favicon (issue #9): a screencapture delete should only
		// drop the `image` field, not the cached favicon/faviconUrl. Get the
		// record first; if it still has a favicon worth keeping, strip
		// `image` and put it back. Otherwise there is nothing left worth
		// keeping, so fall back to the existing wholesale delete.
		withObjectStore('thumbnails', 'readwrite', function(store) {
			let request = store.get(message.url);
			request.onsuccess = function() {
				let existing = request.result;
				if (existing && (existing.favicon || existing.faviconUrl)) {
					delete existing.image;
					store.put(existing);
				} else {
					store.delete(message.url);
				}
			};
		}).catch(console.error);
		return false;

	case 'Thumbnails.purgeHost':
		// Validate: host must be a non-empty string.
		if (typeof message.host !== 'string' || !message.host) {
			sendResponse(null);
			return true;
		}
		// purgeNeverCaptureHost awaits DB readiness internally (via withStore).
		purgeNeverCaptureHost(message.host).then(sendResponse).catch(function(event) {
			console.error('Thumbnails.purgeHost failed:', event);
			sendResponse(null);
		});
		return true;

	case 'Thumbnails.clear':
		// Wipe every stored screenshot + cached favicon. Used by the drawer's
		// "Reset all settings" so a factory reset doesn't leave captured images
		// of visited sites on disk.
		withObjectStore('thumbnails', 'readwrite', function(store) {
			return new Promise(function(resolve) {
				store.clear().onsuccess = function() {
					resolve(undefined);
				};
			});
		}).then(function() {
			sendResponse();
		});
		return true;

	case 'Export:backup':
		// Static import (see file header — dynamic import() is spec-disallowed
		// in service workers).
		makeZip().then(sendResponse).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Import:restore':
		// Surface restore failures instead of swallowing the rejection — a
		// malformed backup must report an error, not fail silently. Static
		// import (see file header).
		readZip(message.file).then(
			() => sendResponse({ ok: true }),
			err => {
				console.error('Import:restore failed:', err);
				sendResponse({ ok: false, error: String(err && err.message || err) });
			},
		);
		return true;

	case 'Theme.colorScheme':
		// CHROME.md D4: the page relays its prefers-color-scheme reading here
		// (theme.js's _initThemeColorSchemeRelay) since a Chrome MV3 service
		// worker has no window/matchMedia to read it itself. No response
		// needed — fire-and-forget, same as Thumbnails.capture above.
		syncActionIconWithTheme(message.dark, _isServiceWorkerScope());
		return false;
	}
	return false;
}

/**
 * Register the listener at top level — called once from
 * lib/background-main.js's own top-level body.
 * @returns {void}
 */
export function registerMessageHandler() {
	api.runtime.onMessage.addListener(handleMessage);
}
