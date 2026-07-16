/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Backup/restore pipeline (MODERNIZATION.md, Stage M, slice M4), carved out
 * of the former webextension/export.js into a real ES module. None of this
 * file's collaborators — the vendored zip library, the Tiles/Background
 * stores, purgeNeverCaptureHost — are dual-scope page/background files
 * (Decision 2), so there's no reason to reach them through the globalThis
 * bridge: real `import`s replace the `zip`/`Tiles`/`Background`/
 * `purgeNeverCaptureHost` globals export.js used to read.
 *
 * `makeZip`/`readZip` are real exports, imported directly by lib/messages.js
 * (M5, dissolves the former background.js) from its `Export:backup`/
 * `Import:restore` message-handler cases — no more `globalThis` bridge for
 * either.
 *
 * `Filters` (prefs.js, a dual-scope bridge file per Decision 2, PAGE_MODULES.md
 * Decision 6) is a real `export` now, imported directly below. Its
 * `globalThis.Filters = …` bridge assignment is retired as of chrome-prep
 * C3d: the page imports it for real too, so nothing reads it off
 * `globalThis` anymore.
 *
 * `notifyRestoreComplete()` (the one-off `Page.restoreComplete` broadcast)
 * is gone too — M5's lib/platform.js `broadcastToPages()` absorbs it; every
 * call site below calls that directly instead.
 */

import * as zip from './zip/zip-core.js';
import { Tiles, Background } from './tiles-store.js';
import { purgeNeverCaptureHost } from './capture.js';
import { Filters } from '../prefs.js';
import { api, broadcastToPages } from './platform.js';

zip.configure({ useWebWorkers: false });

/**
 * Build the backup zip and return it as wire-safe bytes (CHROME.md D2,
 * Decision 2a). No blob URL and no download happens here: a Chrome MV3
 * service worker has no `URL.createObjectURL`, and Chrome JSON-serializes
 * `runtime.sendMessage` responses so a Blob/ArrayBuffer would not survive
 * the wire either — base64 is the one payload shape that works on both
 * platforms. The page side (backup-download.js) decodes the payload,
 * creates the object URL, triggers the download, and revokes the URL — the
 * per-download lifecycle that used to live here.
 * @returns {Promise<{data: string, filename: string}>}
 */
export async function makeZip() {
	let writer = new zip.ZipWriter(new zip.BlobWriter());

	let background = await Background.getBackground();
	if (background) {
		await writer.add('background', new zip.BlobReader(background));
	}

	let prefs = await api.storage.local.get();
	for (let k of ['thumbnailSize', 'version']) {
		delete prefs[k];
	}
	await writer.add('prefs.json', new zip.TextReader(JSON.stringify(prefs, null, '\t')));

	let tiles = await Tiles.getAll();
	for (let t of tiles) {
		if ('image' in t && t.image instanceof Blob) {
			await writer.add('tileImages/' + t.id + '.png', new zip.BlobReader(t.image));
			delete t.image;
		}
	}
	await writer.add('tiles.json', new zip.TextReader(JSON.stringify(tiles, null, '\t')));

	let blob = await writer.close();
	return { data: await blobToBase64(blob), filename: 'newtabtools.zip' };
}

/**
 * Base64-encode a Blob's bytes. `btoa` wants a binary string; it's built in
 * 32 KiB slices because a single `String.fromCharCode(...allBytes)` call
 * would blow the engine's argument-count limit on a multi-MB backup.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function blobToBase64(blob) {
	let bytes = new Uint8Array(await blob.arrayBuffer());
	const SLICE_SIZE = 0x8000;
	/** @type {string[]} */
	let parts = [];
	for (let i = 0; i < bytes.length; i += SLICE_SIZE) {
		parts.push(String.fromCharCode(...bytes.subarray(i, i + SLICE_SIZE)));
	}
	return btoa(parts.join(''));
}

/**
 * @param {Blob} file
 * @returns {Promise<void>}
 */
export async function readZip(file) {
	let reader = new zip.ZipReader(new zip.BlobReader(file));
	let entries = await reader.getEntries();

	/**
	 * @param {string} filename
	 * @returns {Promise<any>}
	 */
	async function getAsJSON(filename) {
		let entry = entries.find(e => e.filename == filename);
		if (!entry) {
			return null;
		}

		let data = /** @type {string} */ (await entry.getData(new zip.TextWriter()));
		return JSON.parse(data);
	}

	/**
	 * @param {import('./zip/zip-core.js').ZipEntry} entry
	 * @returns {Promise<Blob>}
	 */
	async function getAsBlob(entry) {
		return /** @type {Promise<Blob>} */ (entry.getData(new zip.BlobWriter()));
	}

	// Parse every JSON entry, AND validate its shape, BEFORE writing any state.
	// A malformed backup then aborts the whole restore atomically — rather
	// than the old behaviour, where prefs were applied first and only then was
	// tiles.json parsed, so a bad file left a half-applied state (new grid
	// dimensions, zero tiles) with no error surfaced to the user. Note this
	// covers both a `JSON.parse` failure (a syntactically corrupt file) AND a
	// wrong-shape-but-parseable file (audit finding #2, 2026-07-09 review):
	// `JSON.parse` succeeding is not enough — a `tiles.json` of `{"x":1}` or a
	// `prefs.json` of `5` both parse fine but would previously only fail later,
	// inside the `for (let t of tiles)` loop / the `'theme' in prefs` check
	// below, by which point Background.setBackground() and
	// chrome.storage.local.set() may already have written wallpaper/prefs.
	let prefs = await getAsJSON('prefs.json');
	let tiles = await getAsJSON('tiles.json');

	if (tiles !== null && !Array.isArray(tiles)) {
		throw new Error('Malformed backup: tiles.json must be an array.');
	}
	if (prefs !== null && (typeof prefs !== 'object' || Array.isArray(prefs))) {
		throw new Error('Malformed backup: prefs.json must be an object.');
	}

	// Hosts restored into the never-capture list, captured here so the purge can
	// run AFTER tiles are restored (below) — a backup's own tiles may carry
	// auto-captured images for a listed host, so purging before the tile restore
	// would leave those re-inserted images behind.
	let restoredNeverCaptureHosts = [];

	let backgroundFile = entries.find(e => e.filename == 'background');
	if (backgroundFile) {
		// Awaited so the Page.restoreComplete broadcast (below) only goes out
		// once the wallpaper is actually written.
		await Background.setBackground(await getAsBlob(backgroundFile));
	}

	if (prefs) {
		let allowedKeys = ['theme', 'opacity', 'rows', 'columns',
			'margin', 'spacing', 'titleSize', 'tileAspect', 'statType',
			'titleBarSearch',
			'actionIconSize', 'tileActions', 'tileRadius',
			'locked', 'history', 'recent', 'blocked', 'filters',
			'backgroundUrl', 'backgroundPosition', 'backgroundColor',
			'neverCaptureHosts'];
		/** @type {Record<string, any>} */
		let filtered = {};
		for (let k of allowedKeys) {
			if (k in prefs) {
				filtered[k] = prefs[k];
			}
		}
		// `backgroundUrl` is interpolated into `style.backgroundImage` =
		// `url("…")` at render (newTab.js). Validate it at this data boundary:
		// the empty string (the "no wallpaper" default) is fine; otherwise only
		// the Firefox wallpaper CDN is allowed, and the whole string must match
		// (no trailing `") ; background: url(…)` CSS-injection payload).
		// Anything else is dropped rather than stored.
		if ('backgroundUrl' in filtered) {
			let safeBackgroundUrl = /^https:\/\/firefox-settings-attachments\.cdn\.mozilla\.net\/[^"'()\s]*$/;
			if (filtered.backgroundUrl !== '' &&
				(typeof filtered.backgroundUrl !== 'string' || !safeBackgroundUrl.test(filtered.backgroundUrl))) {
				delete filtered.backgroundUrl;
			}
		}
		// `neverCaptureHosts` is a list of host patterns the extension must never
		// screenshot. Validate at this data boundary: must be an Array; each entry
		// is normalised via Filters.normalizeHost (lowercases, strips scheme/path)
		// with any :port stripped (the canonical entry is a port-less hostname —
		// matching keys on URL.hostname), then matched against the allowed
		// host-pattern shape (optional leading dot, then label-dot-label…).
		// Non-strings, empty results, and anything that looks like a URL scheme or
		// injection payload are dropped. The list is deduped before storage.
		if ('neverCaptureHosts' in filtered) {
			if (!Array.isArray(filtered.neverCaptureHosts)) {
				delete filtered.neverCaptureHosts;
			} else {
				let safeHostPattern = /^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/;
				let seen = new Set();
				let cleaned = [];
				for (let entry of filtered.neverCaptureHosts) {
					if (typeof entry !== 'string') {
						continue;
					}
					let normalized = Filters.normalizeHost(entry).replace(/:\d+$/, '');
					if (normalized && safeHostPattern.test(normalized) && !seen.has(normalized)) {
						seen.add(normalized);
						cleaned.push(normalized);
					}
				}
				filtered.neverCaptureHosts = cleaned;
			}
		}
		await api.storage.local.set(filtered);
		restoredNeverCaptureHosts = filtered.neverCaptureHosts || [];
	}

	if (!tiles) {
		// No tiles to restore, but a prefs-only backup can still have added
		// never-capture hosts — purge their pre-existing stored captures.
		for (let host of restoredNeverCaptureHosts) {
			await purgeNeverCaptureHost(host);
		}
		// Everything the backup carried is written — pages refresh themselves.
		await broadcastToPages('Page.restoreComplete');
		return;
	}

	let tilesMap = new Map();
	for (let t of tiles) {
		tilesMap.set(t.id, t);
	}
	for (let e of entries) {
		if (e.filename.startsWith('tileImages/')) {
			let id = parseInt(e.filename.substring(11), 10);
			let image = await getAsBlob(e);
			// An orphan image entry (no tile with this id in tiles.json — a
			// hand-edited/version-mismatched backup, or a garbage filename like
			// 'tileImages/abc.png' where parseInt → NaN) is silently ignored
			// rather than crashing the whole restore (audit finding #3, 2026-07-09
			// review).
			let t = tilesMap.get(id);
			if (t) {
				t.image = image;
			}
		}
	}

	await Tiles.clear();
	// Deliberately NOT the shared lib/constants.js SAFE_PROTOCOLS (M2,
	// MODERNIZATION.md/CONTRIBUTING.md "Security-boundary changes"): this is
	// the restore allow-list validating untrusted backup-file data, a
	// separate trust boundary from the same-shaped list elsewhere. Keeping
	// its own copy means a future widening of SAFE_PROTOCOLS for the
	// tiles/background paths can't silently widen what a malicious backup
	// file is allowed to restore.
	let safeProtocols = ['http:', 'https:', 'ftp:'];
	let safeHexColor = /^#[0-9a-f]{3,8}$/i;
	for (let t of tilesMap.values()) {
		try {
			if (!safeProtocols.includes(new URL(t.url).protocol)) {
				continue;
			}
		} catch (ex) {
			continue;
		}
		if (t.backgroundColor && !safeHexColor.test(t.backgroundColor)) {
			delete t.backgroundColor;
		}
		await Tiles.putTile(t);
	}

	// Purge captured screenshots for restored never-capture hosts. Runs AFTER the
	// tile restore so it also strips auto-captured images (imageIsThumbnail) that
	// the backup's own tiles just re-inserted — the never-capture invariant must
	// hold even for imagery captured before this backup was made.
	for (let host of restoredNeverCaptureHosts) {
		await purgeNeverCaptureHost(host);
	}

	// The restore data is fully written — pages refresh themselves (wallpaper,
	// full grid rebuild, thumbnails) on this broadcast.
	await broadcastToPages('Page.restoreComplete');
}
