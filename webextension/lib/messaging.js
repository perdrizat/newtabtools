/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pure-logic helpers for the message-passing boundary between the background
// page and extension pages. See §2.4 of audit/2026-05-04-security-review.md.

/**
 * Whether a `sender` object passed by `chrome.runtime.onMessage` originates
 * from the extension itself (and not from a content script in a web page).
 *
 * The MV2 manifest in this project does not declare `externally_connectable`,
 * so the only legitimate senders are the extension's own pages. They all
 * carry `sender.id === browser.runtime.id`. Anything else — including a
 * content script under `<all_urls>` — must be rejected.
 *
 * @param {browser.runtime.MessageSender | null | undefined} sender
 * @param {string | undefined} expectedId  the value of `browser.runtime.id`.
 * @returns {boolean}
 */
export function isAuthorizedSender(sender, expectedId) {
	if (!expectedId) {
		return false;
	}
	if (!sender || !sender.id) {
		return false;
	}
	return sender.id === expectedId;
}
