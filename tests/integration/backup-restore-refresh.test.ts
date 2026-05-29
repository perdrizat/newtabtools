/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: backup-restore must rebuild the grid from scratch and
 * pull thumbnails from the IDB store.
 *
 * Bug history: `readZip` used `Updater.updateGrid` after putting tiles,
 * but `updateGrid` reuses existing Site instances when their URL still
 * matches — and those Site instances carry an in-memory `_link` reference
 * pointing at pre-restore data. The result: custom thumbnails (and any
 * other link metadata) only became visible after a manual page reload.
 *
 * Fix: call `Grid.refresh()` (DOM rebuild, fresh Site construction) and
 * follow with an explicit `newTabTools.getThumbnails()` so auto-captured
 * screenshots from the Thumbnails IDB store get applied immediately.
 *
 * These tests source-grep the export.js file because the restore call
 * chain is too tangled (zip reader, IDB transactions, cross-view
 * messaging) to behaviourally test without a real Firefox extension
 * runtime — the E2E suite covers that end-to-end.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_PATH = path.resolve(__dirname, '../../webextension/export.js');

describe('Backup-restore (readZip) — post-restore refresh path', () => {
	let source: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: restore refresh path
		source = fs.readFileSync(EXPORT_PATH, 'utf8');
	});

	it('readZip calls `Grid.refresh()` for every view (full rebuild, fresh Site instances)', () => {
		// Inside the views-loop in readZip. Allows arbitrary whitespace +
		// the leading `v.` view-namespace prefix.
		expect(source).toMatch(/v\.Grid\.refresh\(\)/);
	});

	it('readZip also calls `getThumbnails()` so auto-captured screenshots apply immediately', () => {
		expect(source).toMatch(/v\.newTabTools\.getThumbnails\(\)/);
	});

	it('readZip no longer calls `Updater.updateGrid` in the post-restore loop', () => {
		// Stale path — would silently reuse pre-restore Site instances.
		// Permit only the comment that explains why we don't use it.
		// Strip comments first so we test the live JS.
		const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		expect(noComments).not.toMatch(/v\.Updater\.updateGrid/);
	});
});
