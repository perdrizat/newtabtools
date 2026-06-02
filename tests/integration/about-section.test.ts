/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: About section in the advanced drawer panel.
 *
 * Regression guard for the AMO listing prep: the drawer's About area must
 * carry the brand, version (rendered at runtime from
 * chrome.runtime.getManifest().version), tagline, lineage, and links to
 * GitHub / Privacy / License. The version-rendering JS must use the
 * manifest API (not a hard-coded string that drifts on bump).
 *
 * Locale-key existence (the five new options_about_* keys) is covered by
 * the existing localization smoke test (tests/unit/localization.test.ts),
 * which fails on any data-message reference not present in en.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('About section — newTab.xhtml + version render', () => {
	let xhtml: string;
	let js: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- structural assertions on shipped markup
		xhtml = fs.readFileSync(path.resolve(__dirname, '../../webextension/newTab.xhtml'), 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- regex on version-render code path
		js = fs.readFileSync(path.resolve(__dirname, '../../webextension/newTab.js'), 'utf8');
	});

	it('has an About form group in the advanced drawer panel', () => {
		expect(xhtml).toMatch(/id="options-about"/);
	});

	it('declares a version slot the runtime fills', () => {
		expect(xhtml).toMatch(/data-version-slot/);
	});

	it('uses i18n keys for the About header, tagline, and lineage', () => {
		expect(xhtml).toContain('options_about_header');
		expect(xhtml).toContain('options_about_tagline');
		expect(xhtml).toContain('options_about_lineage');
	});

	it('uses i18n keys for the Privacy and License link labels', () => {
		expect(xhtml).toContain('options_about_privacy');
		expect(xhtml).toContain('options_about_license');
	});

	it('links to the GitHub repo, hosted PRIVACY.md, and hosted LICENSE', () => {
		expect(xhtml).toContain('href="https://github.com/perdrizat/newtabtools"');
		expect(xhtml).toContain('href="https://github.com/perdrizat/newtabtools/blob/master/PRIVACY.md"');
		expect(xhtml).toContain('href="https://github.com/perdrizat/newtabtools/blob/master/LICENSE"');
	});

	it('populates the version slot via chrome.runtime.getManifest().version (not a hard-coded string)', () => {
		// JS must reach the runtime manifest near the version-slot population, so a
		// version bump in manifest.json automatically propagates.
		expect(js).toMatch(/data-version-slot[\s\S]{0,200}getManifest\(\)\.version/);
	});
});
