/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { isAuthorizedSender } from '../../../webextension/lib/messaging.js';

// Validation helper for the runtime.onMessage boundary. Closes the vector
// where a content script in a hostile page could call
// `chrome.runtime.sendMessage({ name: 'Tiles.pinTile', ... })` (or any other
// privileged dispatch). Per the MV2 manifest there is no `externally_connectable`,
// so legitimate senders are always the extension's own pages — they always carry
// `sender.id === browser.runtime.id`. See §2.4 of audit/2026-05-04-security-review.md.

describe('isAuthorizedSender', () => {
	it('returns true when sender.id matches the extension id', () => {
		expect(isAuthorizedSender({ id: 'newtabtools@darktrojan.net' }, 'newtabtools@darktrojan.net')).toBe(true);
	});

	it('returns false when sender.id does not match', () => {
		expect(isAuthorizedSender({ id: 'evil@example.com' }, 'newtabtools@darktrojan.net')).toBe(false);
	});

	it('returns false when sender has no id (web page sender)', () => {
		expect(isAuthorizedSender({ url: 'https://example.com/' }, 'newtabtools@darktrojan.net')).toBe(false);
	});

	it('returns false when sender is null', () => {
		expect(isAuthorizedSender(null, 'newtabtools@darktrojan.net')).toBe(false);
	});

	it('returns false when sender is undefined', () => {
		expect(isAuthorizedSender(undefined, 'newtabtools@darktrojan.net')).toBe(false);
	});

	it('returns false when sender.id is empty string', () => {
		expect(isAuthorizedSender({ id: '' }, 'newtabtools@darktrojan.net')).toBe(false);
	});

	it('returns false when expectedId is missing', () => {
		// Defensive: if browser.runtime.id is somehow unavailable, refuse rather than open up.
		expect(isAuthorizedSender({ id: 'newtabtools@darktrojan.net' }, undefined)).toBe(false);
		expect(isAuthorizedSender({ id: 'newtabtools@darktrojan.net' }, '')).toBe(false);
	});
});
