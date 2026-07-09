/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `NEW_TAB_PAGE` — the new tab page's filename, exported once from
 * lib/constants.js (audit 2026-07-09-modernization-h-code-review.md #7):
 * post Stage-H2 rename, the runtime had `'newTab.html'` as a literal in
 * exactly two places (manifest.json's `chrome_url_overrides` and
 * `chrome.runtime.getURL('newTab.html')` in lib/background-main.js).
 * constants.js already exists precisely to dedup this class of literal
 * (see its own docstring re: SAFE_PROTOCOLS/getTZDateString), so the second
 * runtime occurrence moves here too. manifest.json stays literal (JSON can't
 * import).
 */

import { describe, it, expect } from 'vitest';
import { NEW_TAB_PAGE } from '../../webextension/lib/constants.js';

describe('NEW_TAB_PAGE — lib/constants.js', () => {
	it('is the new tab page filename', () => {
		expect(NEW_TAB_PAGE).toBe('newTab.html');
	});
});
