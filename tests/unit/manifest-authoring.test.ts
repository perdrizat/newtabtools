/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Guard tests for the two-target manifest-authoring split (chrome-prep C6,
 * CHROME_PREP.md). manifest/base.json + manifest/firefox.json are merged by
 * scripts/build-manifest.mjs into the committed webextension/manifest.json
 * (the Firefox target — never hand-edit it, see manifest/README.md);
 * manifest/chrome.json is a dormant overlay for a future Chrome build.
 *
 * (a) proves the merge reproduces the committed Firefox manifest exactly
 *     (catches both hand-edits to the generated file and overlay drift);
 * (b) proves the merge is deterministic (same output on repeated calls);
 * (c) proves the Chrome overlay merges into a structurally valid, honest
 *     MV3 manifest (service_worker background, no browser_specific_settings).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeManifest } from '../../scripts/build-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

describe('manifest authoring — base + overlay merge (chrome-prep C6)', () => {
	it('merge(base, firefox) deep-equals the committed webextension/manifest.json', () => {
		// eslint-disable-next-line ntt/no-source-grep -- structural check that the generated manifest matches the merge output, not a behavioral source-grep
		const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'webextension/manifest.json'), 'utf8'));
		const merged = mergeManifest('firefox');
		expect(merged).toEqual(committed);
	});

	it('merge is deterministic — repeated calls produce identical output', () => {
		const first = mergeManifest('firefox');
		const second = mergeManifest('firefox');
		expect(first).toEqual(second);
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));

		const chromeFirst = mergeManifest('chrome');
		const chromeSecond = mergeManifest('chrome');
		expect(chromeFirst).toEqual(chromeSecond);
		expect(JSON.stringify(chromeFirst)).toBe(JSON.stringify(chromeSecond));
	});

	it('rejects an unknown target', () => {
		expect(() => mergeManifest('safari')).toThrow();
	});

	describe('chrome overlay (dormant — no Chrome build wired up yet)', () => {
		const chrome = mergeManifest('chrome');

		it('is manifest_version 3', () => {
			expect(chrome.manifest_version).toBe(3);
		});

		it('declares an MV3 module service worker pointing at the shared background entry', () => {
			expect(chrome.background).toBeDefined();
			expect(chrome.background.service_worker).toBe('lib/background-main.js');
			expect(chrome.background.type).toBe('module');
			expect(chrome.background.scripts).toBeUndefined();
		});

		it('carries no browser_specific_settings (Firefox-only key)', () => {
			expect(chrome.browser_specific_settings).toBeUndefined();
		});

		it('carries no theme_icons (Firefox-only auto icon-switching, Decision 2)', () => {
			expect(chrome.action).toBeDefined();
			expect(chrome.action.theme_icons).toBeUndefined();
			expect(chrome.action.default_icon).toBe('images/tools-light.svg');
		});

		it('omits the "menus" permission (Decision 1 — Chrome ships without dynamic context menus)', () => {
			expect(chrome.permissions).not.toContain('menus');
		});

		it('carries the same version as the Firefox target (both read package.json)', () => {
			const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
			expect(chrome.version).toBe(pkg.version);
		});
	});
});
