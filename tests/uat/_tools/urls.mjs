/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared `moz-extension://` URL builder for the UAT tooling + AMO screenshot
 * script (audit 2026-07-09-modernization-h-code-review.md #7b): each of
 * browser-smoke.mjs, fallback-cli.mjs, daemon-smoke.mjs, browser-daemon.mjs,
 * and scripts/amo-screenshots.mjs used to rebuild
 * `` `moz-extension://${uuid}/newTab.html` `` independently — one shared
 * helper ends that drift risk (a future rename otherwise needs five
 * synchronized edits, exactly the cost the Stage H2 rename itself paid).
 */

/**
 * @param {string} uuid the extension's per-profile moz-extension UUID
 * @returns {string} the full moz-extension:// URL to the new tab page
 */
export function newTabURL(uuid) {
	return `moz-extension://${uuid}/newTab.html`;
}
