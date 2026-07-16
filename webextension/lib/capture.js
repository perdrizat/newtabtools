/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Auto-thumbnail capture pipeline (MODERNIZATION.md, Stage M, slice M3).
 *
 * Carved out of background.js verbatim: the network-idle watcher, the
 * multi-stage (A/B/C) capture-session state machine, the storage.session-
 * backed `pendingCaptures` queue (serialized read-modify-write), and
 * `purgeNeverCaptureHost` (thumbnails-domain, but lives here rather than
 * background.js since it's driven entirely by the same never-capture/
 * thumbnails-store machinery as the rest of this file). Image processing
 * itself (resize/blankness-detection/data-URL decode) is behind the narrow
 * seam in lib/thumbnail-image.js — this file never touches `Image`/canvas
 * directly.
 *
 * `captureSessions`/`networkIdleWatchers` stay module-private in-memory Maps
 * (MODERNIZATION.md in-memory-state directive — ~2s lifetime, event-page-
 * teardown-safe by design); `pendingCaptures` stays in `storage.session`
 * (unbounded wait for tab activation, must survive a respawn).
 *
 * `NeverCapture` is a dual-scope bridge global (prefs.js, MODERNIZATION.md
 * Decision 2, PAGE_MODULES.md Decision 6) — a real `export` now, imported
 * directly below. Its `globalThis.NeverCapture = …` bridge assignment is
 * retired as of chrome-prep C3d: the page imports it for real too, so
 * nothing reads it off `globalThis` anymore.
 *
 * M5 also moves the browser-capability checks (the `<all_urls>` permission
 * probe in `startCaptureSession`, the capture-API presence probe in
 * `captureTab`) onto lib/platform.js's `hasAllUrlsPermission()`/
 * `isCaptureAvailable()` wrappers — same logic, relocated to the file a
 * Chrome/stage-3 port forks.
 *
 * lib/messages.js (M5, dissolves the former background.js) and
 * lib/background-main.js reach this module's exports via real `import`s —
 * no more `globalThis` bridge for any of it.
 */

import { withStore, withObjectStore } from './db.js';
import { dataURLtoBlob, isBlank, resizeThumbnail } from './thumbnail-image.js';
import { getTZDateString } from './constants.js';
import { NeverCapture } from '../prefs.js';
import { api, hasAllUrlsPermission, isCaptureAvailable, sessionGet, sessionSet } from './platform.js';

// ---------------------------------------------------------------------------
// Network idle monitor
// ---------------------------------------------------------------------------

/** @type {Map<number, {startTime: number, callback: (elapsed: number) => void, resetCount: number, timer: ReturnType<typeof setTimeout>}>} */
let networkIdleWatchers = new Map();

/**
 * Test-only escape hatch onto the live `networkIdleWatchers` Map — same
 * convention as lib/db.js's `_resetForTests` (a documented, clearly-named
 * exception rather than a second production code path). Production code
 * never reads this; it's how tests assert/seed watcher state without a raw
 * `globalThis.networkIdleWatchers` to poke (that global disappears with this
 * carve-up — the Map is module-private).
 * @type {Map<number, {startTime: number, callback: (elapsed: number) => void, resetCount: number, timer: ReturnType<typeof setTimeout>}>}
 */
export const _networkIdleWatchersForTests = networkIdleWatchers;

/**
 * @param {number} tabId
 * @param {(elapsed: number) => void} callback
 */
export function armNetworkIdle(tabId, callback) {
	disarmNetworkIdle(tabId);
	let watcher = {
		startTime: Date.now(),
		callback: callback,
		resetCount: 0,
		timer: setTimeout(function() {
			let elapsed = Date.now() - watcher.startTime;
			networkIdleWatchers.delete(tabId);
			callback(elapsed);
		}, 2000),
	};
	networkIdleWatchers.set(tabId, watcher);
}

/**
 * @param {number} tabId
 */
export function disarmNetworkIdle(tabId) {
	let watcher = networkIdleWatchers.get(tabId);
	if (watcher) {
		clearTimeout(watcher.timer);
		networkIdleWatchers.delete(tabId);
	}
}

/**
 * @param {{tabId: number}} details
 */
export function resetNetworkIdleTimer(details) {
	let watcher = networkIdleWatchers.get(details.tabId);
	if (watcher) {
		watcher.resetCount++;
		clearTimeout(watcher.timer);
		watcher.timer = setTimeout(function() {
			let elapsed = Date.now() - watcher.startTime;
			networkIdleWatchers.delete(details.tabId);
			watcher.callback(elapsed);
		}, 2000);
	}
}

// ---------------------------------------------------------------------------
// captureTab / fetchFaviconBlob
// ---------------------------------------------------------------------------

/**
 * Capture the visible tab and return the data URL and favicon URL.
 * Verifies the target tab is still active before capturing — if the user
 * switched tabs, captureVisibleTab would screenshot the wrong page.
 * dataURL is null if the tab is gone/inactive or captureVisibleTab fails.
 * @param {number} tabId
 * @param {number} windowId
 * @returns {Promise<{dataURL: string|null, favIconUrl: string|null}>}
 */
export async function captureTab(tabId, windowId) {
	// lib/platform.js's isCaptureAvailable() wraps the same `typeof` probe
	// (spike finding, 2026-07-09: Firefox hides tabs.captureVisibleTab
	// entirely, not merely denies it, when the <all_urls> host permission is
	// lacking/revoked). startCaptureSession() already guards on
	// hasAllUrlsPermission() before creating a session, but this is a second,
	// independent guard for any other caller (e.g. the action popup's
	// Thumbnails.capture message).
	if (!isCaptureAvailable()) {
		return {dataURL: null, favIconUrl: null};
	}
	let tab;
	try {
		tab = await api.tabs.get(tabId);
	} catch (ex) {
		// Tab is gone — same as the old callback's `runtime.lastError` check.
		return {dataURL: null, favIconUrl: null};
	}
	if (!tab.active) {
		return {dataURL: null, favIconUrl: null};
	}
	// `favIconUrl` can become available before or after the screenshot
	// is ready — grab whichever value is current at this moment.
	let favIconUrl = tab.favIconUrl || null;
	let dataURL;
	try {
		dataURL = await api.tabs.captureVisibleTab(windowId, {format: 'png'});
	} catch (ex) {
		return {dataURL: null, favIconUrl};
	}
	return {dataURL: dataURL || null, favIconUrl};
}

/**
 * Turn a tab's `favIconUrl` into a cached favicon Blob, or `null`.
 *
 * Only `data:` URLs are cached here: they're decoded in-process (see
 * `dataURLtoBlob`), capped at ~64 KB so we don't bloat the IDB store. Remote
 * `http(s):` favicons are deliberately NOT fetched — that required a
 * `connect-src https:` wildcard in the manifest CSP (any-HTTPS read access),
 * which the 2026-05-31 review flagged. Instead they render live on the page as
 * `<img src="https://…/favicon.ico">`, governed by `img-src https:` (paint-only,
 * can't exfiltrate). See `audit/2026-05-31-csp-tightening.md`. So this returns
 * null for non-`data:` URLs and the page falls back to a live <img> via the
 * stored `favIconUrl` string.
 * @param {string|null} favIconUrl
 * @returns {Promise<Blob|null>}
 */
export function fetchFaviconBlob(favIconUrl) {
	if (!favIconUrl || !favIconUrl.startsWith('data:')) {
		return Promise.resolve(null);
	}
	let blob = dataURLtoBlob(favIconUrl);
	if (!blob || blob.size === 0 || blob.size > 64 * 1024) {
		return Promise.resolve(null);
	}
	return Promise.resolve(blob);
}

// ---------------------------------------------------------------------------
// Multi-stage capture sessions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CaptureSession
 * @property {string} url
 * @property {number} windowId
 * @property {Array<{label: string, dataURL: string}>} captures
 * @property {ReturnType<typeof setTimeout>[]} timers
 * @property {string} [favIconUrl]
 */

/** @type {Map<number, CaptureSession>} */
let captureSessions = new Map();

/**
 * Test-only escape hatch onto the live `captureSessions` Map — see
 * `_networkIdleWatchersForTests`'s doc comment for the convention this
 * follows.
 * @type {Map<number, CaptureSession>}
 */
export const _captureSessionsForTests = captureSessions;

/**
 * Drop a tab's in-flight capture session, if any — used by background.js's
 * `tabs.onRemoved` listener (the session Map itself is module-private, so
 * that listener can no longer reach into it directly).
 * @param {number} tabId
 */
export function removeCaptureSession(tabId) {
	captureSessions.delete(tabId);
}

/**
 * Start a multi-stage capture session for a tab.
 *
 * All tabs (both active on load and activated from background):
 *   A — immediate capture
 *   B — 500ms later (SPA first meaningful paint)
 *   C — on network idle, capped at 2s (user may scroll)
 *   After C (or 2s timeout), pickAndStore selects the best capture.
 *
 * Background tabs that haven't been activated yet are deferred via
 * `storage.session`'s `pendingCaptures` (an unbounded wait for tab
 * activation, which doesn't survive event-page suspension in-memory) —
 * the full A/B/C flow starts when the user switches to the tab, since
 * SPAs often only render after activation.
 *
 * Host permissions are user-revocable at runtime in MV3 (unlike MV2's
 * install-time-only grant), so this first confirms <all_urls> is still
 * held before creating any session — no timers, no watchers, if it's been
 * revoked. The check is async, so the granted case takes one extra
 * microtask/promise tick before `_startCaptureSession` runs; callers here
 * are all fire-and-forget, so this does not change observable ordering.
 * @param {number} tabId
 * @param {number} windowId
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function startCaptureSession(tabId, windowId, url) {
	let granted = await hasAllUrlsPermission();
	if (!granted) {
		return;
	}
	_startCaptureSession(tabId, windowId, url);
}

/**
 * Internal implementation of `startCaptureSession` — see there for the
 * capture-stage documentation. Split out so the permission guard above can
 * wrap it without duplicating the session-setup logic.
 * @param {number} tabId
 * @param {number} windowId
 * @param {string} url
 */
function _startCaptureSession(tabId, windowId, url) {
	// Privacy guard: never capture sites the user has opted-out of.
	// Accepted millisecond startup race (same class as Blocked/Filters): if the
	// list is updated concurrently with a navigation the guard may miss one
	// capture — acceptable given the infrequency of list mutations.
	if (NeverCapture.matches(url)) {
		return;
	}

	// Clean up any prior session for this tab (SPA navigations can trigger
	// multiple onCompleted events for the same tabId).
	let oldSession = captureSessions.get(tabId);
	if (oldSession) {
		oldSession.timers.forEach(function(t) { clearTimeout(t); });
	}
	captureSessions.delete(tabId);
	disarmNetworkIdle(tabId);

	/** @type {CaptureSession} */
	let session = {
		url: url,
		windowId: windowId,
		captures: [],
		timers: [],
	};
	captureSessions.set(tabId, session);

	// Capture A: immediate.
	captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
		if (dataURL && captureSessions.get(tabId) === session) {
			session.captures.push({label: 'A', dataURL: dataURL});
		}
		if (favIconUrl && captureSessions.get(tabId) === session) {
			session.favIconUrl = favIconUrl;
		}
	});

	// Capture B: 500ms later.
	let timerB = setTimeout(function() {
		if (captureSessions.get(tabId) !== session) {
			return;
		}
		captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
			if (dataURL && captureSessions.get(tabId) === session) {
				session.captures.push({label: 'B', dataURL: dataURL});
			}
			if (favIconUrl && captureSessions.get(tabId) === session) {
				session.favIconUrl = favIconUrl;
			}
		});
	}, 500);
	session.timers.push(timerB);

	// Capture C: on network idle, capped at 2s.
	// Hard deadline at 2s ensures we finalize even if network never goes idle.
	// Kept short because users frequently scroll within 2s.
	let finalized = false;

	let hardDeadline = setTimeout(function() {
		if (!finalized && captureSessions.get(tabId) === session) {
			finalized = true;
			disarmNetworkIdle(tabId);
			captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
				if (dataURL && captureSessions.get(tabId) === session) {
					session.captures.push({label: 'C', dataURL: dataURL});
				}
				if (favIconUrl && captureSessions.get(tabId) === session) {
					session.favIconUrl = favIconUrl;
				}
				pickAndStore(tabId);
			});
		}
	}, 2000);
	session.timers.push(hardDeadline);

	armNetworkIdle(tabId, function(elapsed) {
		if (finalized || captureSessions.get(tabId) !== session) {
			return;
		}
		if (elapsed <= 2000) {
			// Network idle within 2s — take Capture C, then finalize.
			captureTab(tabId, windowId).then(function({dataURL, favIconUrl}) {
				if (dataURL && captureSessions.get(tabId) === session) {
					session.captures.push({label: 'C', dataURL: dataURL});
				}
				if (favIconUrl && captureSessions.get(tabId) === session) {
					session.favIconUrl = favIconUrl;
				}
				if (!finalized && captureSessions.get(tabId) === session) {
					finalized = true;
					clearTimeout(hardDeadline);
					pickAndStore(tabId);
				}
			});
		} else {
			// Network idle after 2s — skip C (user may have scrolled), finalize with A/B.
			if (!finalized && captureSessions.get(tabId) === session) {
				finalized = true;
				clearTimeout(hardDeadline);
				pickAndStore(tabId);
			}
		}
	});
}

/**
 * Select the best capture from the session and write it to IDB.
 * Picks the latest non-blank capture. If all are blank, keeps the latest.
 *
 * If every `captureTab` attempt in the session returned a null dataURL
 * (screenshot failed, or the tab never became active long enough to
 * capture — issue #10), there's no `image` to pick from, but a favicon may
 * still have been observed along the way (`tab.favIconUrl` resolves
 * independently of `captureVisibleTab`). Rather than discarding the whole
 * session, this stores a favicon-only record — same store-write mechanics,
 * just an omitted `image` field. Only bails outright when there's neither a
 * capture nor a favicon to keep.
 * @param {number} tabId
 */
function pickAndStore(tabId) {
	let session = captureSessions.get(tabId);
	if (!session || (session.captures.length === 0 && !session.favIconUrl)) {
		captureSessions.delete(tabId);
		return;
	}

	let url = session.url;

	// Re-check never-capture list. Closes the in-flight-session race: if the
	// user added the host to the list after the session started, we must not
	// store the capture that was taken before the list update landed.
	if (NeverCapture.matches(url)) {
		captureSessions.delete(tabId);
		return;
	}
	let favIconUrl = session.favIconUrl || null;
	let captures = session.captures;
	captureSessions.delete(tabId);

	// Clear any remaining timers.
	session.timers.forEach(function(t) { clearTimeout(t); });

	// Check blankness of all captures in parallel, then pick the best.
	// Fetch the favicon in parallel so we don't add latency to the
	// thumbnail finalisation.
	Promise.all([
		Promise.all(captures.map(function(c) { return isBlank(c.dataURL); })),
		fetchFaviconBlob(favIconUrl),
	]).then(async function(results) {
		let blankResults = results[0];
		let faviconBlob = results[1];
		let today = getTZDateString();
		/**
		 * @type {{url: string, image?: Blob, stored: string, used: string,
		 *   favicon?: Blob, faviconUrl?: string}}
		 */
		let record = {
			url: url,
			stored: today,
			used: today,
		};

		if (captures.length > 0) {
			// Pick latest non-blank; fall back to latest overall.
			let bestIndex = captures.length - 1; // default: latest
			for (let i = captures.length - 1; i >= 0; i--) {
				if (!blankResults[i]) {
					bestIndex = i;
					break;
				}
			}
			let best = captures[bestIndex];
			let prefs = await api.storage.local.get({'thumbnailSize': 600});
			record.image = await resizeThumbnail(best.dataURL, prefs.thumbnailSize);
		}
		// else: every captureTab attempt in this session returned a null
		// dataURL — no `image` field, but the favicon below is still worth
		// keeping (issue #10).

		if (faviconBlob) {
			// data: favicon, decoded + cached as a Blob (offline-capable).
			record.favicon = faviconBlob;
		} else if (favIconUrl && /^https?:\/\//.test(favIconUrl)) {
			// Remote favicon: store the URL so the page can render it
			// live via <img> (no fetch / no connect-src wildcard).
			record.faviconUrl = favIconUrl;
		}
		// Re-guard the store (audit §2.4): the isBlank/favicon/resize awaits
		// above give the connection time to drop via onclose/onversionchange —
		// withStore() re-opens it if so, instead of throwing on a stale
		// connection and losing the freshly-captured thumbnail silently.
		await withObjectStore('thumbnails', 'readwrite', function(store) {
			if (record.image) {
				store.put(record);
				return;
			}
			// Favicon-only fallback (issue #10): merge into any existing
			// record — a failed RE-capture must never clobber a previously
			// stored thumbnail with an image-less record.
			let request = store.get(url);
			request.onsuccess = function() {
				let existing = request.result;
				if (existing) {
					existing.used = record.used;
					if (record.favicon) {
						existing.favicon = record.favicon;
						delete existing.faviconUrl;
					} else if (record.faviconUrl) {
						existing.faviconUrl = record.faviconUrl;
						delete existing.favicon;
					}
					store.put(existing);
				} else {
					store.put(record);
				}
			};
		});
	}).catch(console.error);
}

// ---------------------------------------------------------------------------
// pendingCaptures: serialized storage.session read-modify-write (audit §2.3)
// ---------------------------------------------------------------------------

// Chains every pendingCaptures mutation onto one promise, so two concurrent
// callers (e.g. two `onCompleted` events for different background tabs)
// can't both read the same storage.session snapshot and clobber each other's
// write — the second caller's get() only starts once the first's set() has
// finished. Also dedups the three previously open-coded RMW blocks (§4.1).
let pendingWriteChain = Promise.resolve();

/**
 * Queue a pendingCaptures read-modify-write behind any already in flight.
 * @param {function(Record<string, {url: string, windowId: number}>): *} mutate
 *   Receives the current pendingCaptures object (mutate in place); its
 *   return value becomes this call's resolved value.
 * @returns {Promise<*>}
 */
function enqueuePendingCapturesWrite(mutate) {
	let result = pendingWriteChain.then(async function() {
		let {pendingCaptures} = await sessionGet('pendingCaptures');
		pendingCaptures = pendingCaptures || {};
		let returnValue = mutate(pendingCaptures);
		await sessionSet({pendingCaptures});
		return returnValue;
	});
	// Keep the chain alive even if this write failed, so a later caller still
	// gets a turn instead of every subsequent write rejecting forever.
	pendingWriteChain = result.catch(function(event) {
		console.error(event);
	});
	return result;
}

/**
 * Record a deferred capture for a background tab.
 * @param {number} tabId
 * @param {{url: string, windowId: number}} data
 * @returns {Promise<void>}
 */
export function addPendingCapture(tabId, data) {
	return enqueuePendingCapturesWrite(function(pendingCaptures) {
		pendingCaptures[tabId] = data;
	});
}

/**
 * Remove and return the deferred capture for a tab, if any.
 * @param {number} tabId
 * @returns {Promise<{url: string, windowId: number}|undefined>}
 */
export function takePendingCapture(tabId) {
	return enqueuePendingCapturesWrite(function(pendingCaptures) {
		let pending = pendingCaptures[tabId];
		if (pending) {
			delete pendingCaptures[tabId];
		}
		return pending;
	});
}

/**
 * Discard the deferred capture for a tab, if any (no return value needed —
 * used for cleanup on tab close).
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function removePendingCapture(tabId) {
	return enqueuePendingCapturesWrite(function(pendingCaptures) {
		delete pendingCaptures[tabId];
	});
}

/**
 * Purge all captured data for a single host pattern from both the thumbnails
 * and tiles stores.
 *
 * Two sequential cursor passes:
 *   1. thumbnails — delete every record whose URL matches `pattern`.
 *   2. tiles — for every matching tile that holds an auto-captured thumbnail
 *      (`imageIsThumbnail: true`), strip the `image` and `imageIsThumbnail`
 *      fields and update the record in place (the tile itself is kept).
 *      Tiles with a custom image (no `imageIsThumbnail`) are untouched.
 *
 * Unparseable URLs in either store are skipped silently (same idiom used by
 * `Thumbnails.getFaviconsByHost` in background.js). Host matching keys on
 * URL.hostname (no port) — the canonical never-capture entry is a port-less
 * host, so a listed `example.com` also covers `example.com:8443`.
 *
 * Awaits DB readiness internally (via withStore) so callers on the restore
 * path (readZip, which runs without a preceding message-handler wrap) can't
 * crash on an unopened connection. Both passes run inside ONE
 * withStore(['thumbnails', 'tiles'], …) transaction (the multi-store shape)
 * for atomicity.
 *
 * @param {string} pattern  A NeverCapture host pattern, e.g. '.example.com' or 'example.com'.
 * @returns {Promise<{thumbnails: number, tiles: number}>}
 */
export function purgeNeverCaptureHost(pattern) {
	return withStore(['thumbnails', 'tiles'], 'readwrite', function(txOrStore) {
		// withStore() hands back an IDBTransaction whenever `storeNames` is an
		// array (its own doc comment) — always true for this call site's
		// literal two-element array, so the cast documents an invariant rather
		// than narrowing a real union.
		let tx = /** @type {IDBTransaction} */ (txOrStore);
		return new Promise(function(resolve) {
			let thumbCount = 0;
			let tileCount = 0;

			// Pass 1: thumbnails store — delete matching records. Keeps the
			// favicon (issue #9): when a matching record still has a
			// favicon/faviconUrl worth keeping, strip just `image` and update
			// the record in place instead of deleting it outright.
			tx.objectStore('thumbnails').openCursor().onsuccess = function() {
				let cursor = this.result;
				if (cursor) {
					let row = cursor.value;
					let host = null;
					try { host = new URL(row.url).hostname; } catch (e) { /* skip unparseable */ }
					if (host && NeverCapture.hostMatchesPattern(host, pattern)) {
						if (row.favicon || row.faviconUrl) {
							delete row.image;
							cursor.update(row);
						} else {
							cursor.delete();
						}
						thumbCount++;
					}
					cursor.continue();
				} else {
					// Pass 2: tiles store — strip auto-thumbnail image from matching tiles.
					tx.objectStore('tiles').openCursor().onsuccess = function() {
						let tileCursor = this.result;
						if (tileCursor) {
							let row = tileCursor.value;
							let host = null;
							try { host = new URL(row.url).hostname; } catch (e) { /* skip unparseable */ }
							if (host && NeverCapture.hostMatchesPattern(host, pattern)
								&& row.image && row.imageIsThumbnail) {
								delete row.image;
								delete row.imageIsThumbnail;
								tileCursor.update(row);
								tileCount++;
							}
							tileCursor.continue();
						} else {
							resolve({ thumbnails: thumbCount, tiles: tileCount });
						}
					};
				}
			};
		});
	});
}
