/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// CHROME.md D2 (Decision 2a): the page-side home of the backup download.
// `URL.createObjectURL` does not exist in a Chrome MV3 service worker, so
// the background's `Export:backup` handler (lib/backup.js makeZip) returns
// the zip as a Blob + filename over the wire — which survives
// `runtime.sendMessage` on both platforms now that Chrome uses
// structured-clone messaging (Chrome 148+ floor, Decision 10; base64 leg
// removed per audit 2026-07-16 m3/A-note). This module — running in the page,
// where blob URLs are document-scoped and well-defined — creates the object
// URL from that Blob, triggers the download, and revokes the URL once the
// download reaches a terminal state. One unified path for both platforms.
//
// Deliberately NOT routed through object-urls.js's keyed
// `_freshObjectURL`/`_dropObjectURL`: that seam models one owner surface
// per key (revoke-on-replace). A download's URL must live exactly as long
// as its own downloads.onChanged lifecycle — under a single shared key, a
// second export started while the first is still in flight would replace
// (and revoke) the first URL, and the first download's terminal event
// would then revoke the second's. The closure-scoped per-download handling
// below is lib/backup.js's former logic, moved here unchanged.

import { api } from './api.js';

/**
 * The `Export:backup` wire payload (lib/backup.js makeZip).
 * @typedef {{data: Blob, filename: string}} BackupPayload
 */

/**
 * Create a page-scoped blob URL for the payload and hand it to the
 * downloads API. Revokes the URL when this specific download reaches a
 * terminal state (scoped to `downloadId` via the closure, so unrelated
 * downloads.onChanged events are ignored), or immediately when the
 * download call itself fails.
 *
 * `downloads` is an optional permission (see manifest.json); if it hasn't
 * been granted, `api.downloads` is undefined and this rejects — the same
 * semantics the background-side call always had.
 * @param {BackupPayload} payload
 * @returns {Promise<number>} the download id
 */
export async function downloadBackup(payload) {
	let url = URL.createObjectURL(payload.data);

	/** @type {number|undefined} */
	let downloadId;
	/** @param {browser.downloads._OnChangedDownloadDelta} delta */
	function onDownloadChanged(delta) {
		if (delta.id !== downloadId || !delta.state) {
			return;
		}
		if (['complete', 'interrupted'].includes(/** @type {string} */ (delta.state.current))) {
			URL.revokeObjectURL(url);
			api.downloads.onChanged.removeListener(onDownloadChanged);
		}
	}
	if (api.downloads && api.downloads.onChanged) {
		api.downloads.onChanged.addListener(onDownloadChanged);
	}

	try {
		downloadId = await api.downloads.download({
			url,
			filename: payload.filename,
			saveAs: true
		});
		return /** @type {number} */ (downloadId);
	} catch (ex) {
		URL.revokeObjectURL(url);
		if (api.downloads && api.downloads.onChanged) {
			api.downloads.onChanged.removeListener(onDownloadChanged);
		}
		throw ex;
	}
}

/**
 * The drawer's Backup action: ask the background for the zip bytes, then
 * download them from the page. A null response means makeZip already
 * failed (and logged) in the background — nothing to download. A failed
 * download is logged, matching the old background-side behavior where the
 * rejection ended in lib/messages.js's console.error.
 * @returns {void}
 */
export function requestBackup() {
	api.runtime.sendMessage({name: 'Export:backup'}, /** @param {BackupPayload|null} response */ response => {
		if (!response || !response.data) {
			return;
		}
		downloadBackup(response).catch(console.error);
	});
}
