/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared constants for the background module graph (MODERNIZATION.md, Stage
 * M, slice M2 — folds in MV3 review §4.1's helper-dedup backlog item).
 *
 * `SAFE_PROTOCOLS` was three separate copies of the same literal array
 * (tiles.js's topSites filter, background.js's webNavigation handler, and
 * background.js's per-respawn action-button sweep) — unified here so the
 * "which URL schemes does the extension treat as a normal page" rule lives
 * in exactly one place.
 *
 * `export.js`'s own `safeProtocols` is a DELIBERATE exception and does NOT
 * import this — see the comment at its declaration and
 * MODERNIZATION.md/CONTRIBUTING.md's "Security-boundary changes" section:
 * the restore allow-list is a separate trust boundary (untrusted backup
 * file data) that must not silently widen if this list ever does.
 */
export const SAFE_PROTOCOLS = ['http:', 'https:', 'ftp:'];
