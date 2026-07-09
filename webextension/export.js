/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported makeZip, readZip */
/* globals Background, Filters, Tiles, purgeNeverCaptureHost, zip */

zip.configure({ useWebWorkers: false });

globalThis.makeZip = async function() {
	let writer = new zip.ZipWriter(new zip.BlobWriter());

	let background = await Background.getBackground();
	if (background) {
		await writer.add('background', new zip.BlobReader(background));
	}

	let prefs = await browser.storage.local.get();
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
	// `downloads` is an optional permission (see manifest.json); if it hasn't
	// been granted, `browser.downloads` is undefined and this throws — same
	// as the old callback-style `chrome.downloads.download(...)` call did
	// with no guard of its own.
	let url = URL.createObjectURL(blob);

	// Revoke the blob URL once this specific download reaches a terminal
	// state — previously never revoked (leaked one blob per export until the
	// event page happened to suspend). Scoped to `downloadId` via the closure
	// below so unrelated downloads.onChanged events (any other download the
	// user has running) are ignored.
	//
	// Event-page note: this listener lives only as long as the event page's
	// in-memory JS context does. If the page suspends mid-download, the
	// listener — and its closure over `url` — die with the document, but so
	// does the document's own object-URL registry (blob URLs are
	// document-scoped), so there is nothing left to revoke either way.
	let downloadId;
	function onDownloadChanged(delta) {
		if (delta.id !== downloadId || !delta.state) {
			return;
		}
		if (['complete', 'interrupted'].includes(delta.state.current)) {
			URL.revokeObjectURL(url);
			browser.downloads.onChanged.removeListener(onDownloadChanged);
		}
	}
	if (browser.downloads && browser.downloads.onChanged) {
		browser.downloads.onChanged.addListener(onDownloadChanged);
	}

	try {
		downloadId = await browser.downloads.download({
			url,
			filename: 'newtabtools.zip',
			saveAs: true
		});
		return downloadId;
	} catch (ex) {
		URL.revokeObjectURL(url);
		if (browser.downloads && browser.downloads.onChanged) {
			browser.downloads.onChanged.removeListener(onDownloadChanged);
		}
		throw ex;
	}
};

/**
 * Tell every open new-tab page that a restore has finished rewriting the
 * stored data. Each page refreshes itself — wallpaper, full grid rebuild,
 * thumbnails — on this message (see pageMessageHandler in newTab.js). This
 * replaces the MV2-only extension.getViews() access to page globals
 * (Slice A of the MV3 migration). When no page is open the broadcast rejects
 * with "Receiving end does not exist" — swallowed.
 * @returns {Promise<void>}
 */
function notifyRestoreComplete() {
	return browser.runtime.sendMessage({name: 'Page.restoreComplete'}).catch(() => {});
}

globalThis.readZip = async function(file) {
	let reader = new zip.ZipReader(new zip.BlobReader(file));
	let entries = await reader.getEntries();

	async function getAsJSON(filename) {
		let entry = entries.find(e => e.filename == filename);
		if (!entry) {
			return null;
		}

		let data = await entry.getData(new zip.TextWriter());
		return JSON.parse(data);
	}

	async function getAsBlob(entry) {
		return entry.getData(new zip.BlobWriter());
	}

	// Parse every JSON entry BEFORE writing any state. A malformed backup (e.g.
	// a corrupt tiles.json) then aborts the whole restore atomically — rather
	// than the old behaviour, where prefs were applied first and only then was
	// tiles.json parsed, so a bad file left a half-applied state (new grid
	// dimensions, zero tiles) with no error surfaced to the user.
	let prefs = await getAsJSON('prefs.json');
	let tiles = await getAsJSON('tiles.json');

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
		await chrome.storage.local.set(filtered);
		restoredNeverCaptureHosts = filtered.neverCaptureHosts || [];
	}

	if (!tiles) {
		// No tiles to restore, but a prefs-only backup can still have added
		// never-capture hosts — purge their pre-existing stored captures.
		for (let host of restoredNeverCaptureHosts) {
			await purgeNeverCaptureHost(host);
		}
		// Everything the backup carried is written — pages refresh themselves.
		await notifyRestoreComplete();
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
			tilesMap.get(id).image = image;
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
	await notifyRestoreComplete();
};
