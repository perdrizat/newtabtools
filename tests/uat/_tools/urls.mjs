/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared extension-origin URL builder for the UAT tooling + AMO screenshot
 * script (audit 2026-07-09-modernization-h-code-review.md #7b): each of
 * browser-smoke.mjs, fallback-cli.mjs, daemon-smoke.mjs, browser-daemon.mjs,
 * and scripts/amo-screenshots.mjs used to rebuild
 * `` `moz-extension://${uuid}/newTab.html` `` independently — one shared
 * helper ends that drift risk (a future rename otherwise needs five
 * synchronized edits, exactly the cost the Stage H2 rename itself paid).
 *
 * chrome-prep D6 generalizes this to both stores: Firefox reaches the page
 * via its per-profile `moz-extension://<uuid>/` origin (pinned by a seeded
 * pref); Chrome reaches it via `chrome-extension://<id>/`, where `<id>` is
 * deterministic from the committed dev key (see
 * `tests/e2e-chrome/_tools/chrome-env.mjs`). All existing single-arg callers
 * (Firefox-only) keep working unchanged — `browser` defaults to the registry's
 * default browser.
 *
 * The URL scheme comes from the browser registry (uat-browsers.mjs), so an
 * unknown browser throws instead of silently getting `moz-extension://`.
 */

import { DEFAULT_UAT_BROWSER, uatBrowserProfile } from './uat-browsers.mjs';

/**
 * @param {string} id the extension's per-profile moz-extension UUID (Firefox)
 *   or its deterministic extension id (Chrome)
 * @param {string} [browser] a registered UAT browser name — defaults to the
 *   registry default so existing single-arg call sites are unaffected
 * @returns {string} the full extension-origin URL to the new tab page
 */
export function newTabURL(id, browser = DEFAULT_UAT_BROWSER) {
	return `${uatBrowserProfile(browser).extensionScheme}://${id}/newTab.html`;
}
