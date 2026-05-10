/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression tests on the manifest's security configuration. The CSP and
// sender-check protections from audit/2026-05-04-security-review.md were
// landed in Phase 0; these tests prevent silent regressions if someone
// removes or weakens the relevant fields. The E2E loads-cleanly suite
// catches *over*-tightening (the extension would fail to load); these
// catch *under*-tightening, which the runtime is unfortunately happy to
// accept silently.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MANIFEST_PATH = path.resolve(__dirname, '../../webextension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

describe('manifest.json — security configuration', () => {
	describe('Content Security Policy (audit §2.3)', () => {
		it('declares a content_security_policy as a non-empty string', () => {
			expect(typeof manifest.content_security_policy).toBe('string');
			expect(manifest.content_security_policy.length).toBeGreaterThan(0);
		});

		it('locks script-src to \'self\'', () => {
			expect(manifest.content_security_policy).toMatch(/script-src\s+'self'/);
		});

		it('forbids object-src (no plugin embeds)', () => {
			expect(manifest.content_security_policy).toMatch(/object-src\s+'none'/);
		});

		it('does not allow \'unsafe-eval\' anywhere (would defeat the point of CSP)', () => {
			expect(manifest.content_security_policy).not.toMatch(/'unsafe-eval'/);
		});

		it('does not allow \'unsafe-inline\' in script-src (the XSS gateway)', () => {
			const scriptSrcMatch = /script-src\s+([^;]+)/.exec(manifest.content_security_policy);
			expect(scriptSrcMatch).not.toBeNull();
			expect(scriptSrcMatch![1]).not.toMatch(/'unsafe-inline'/);
		});
	});

	describe('CSP — wallpaper picker (Mozilla CDN)', () => {
		it('allows connect-src to Mozilla Remote Settings API', () => {
			expect(manifest.content_security_policy).toMatch(/connect-src[^;]*firefox\.settings\.services\.mozilla\.com/);
		});

		it('allows img-src from Mozilla CDN for wallpaper images', () => {
			expect(manifest.content_security_policy).toMatch(/img-src[^;]*firefox-settings-attachments\.cdn\.mozilla\.net/);
		});
	});

	describe('Permissions (auto-thumbnail rewrite)', () => {
		it('includes webRequest permission for network idle detection', () => {
			expect(manifest.permissions).toContain('webRequest');
		});

		it('keeps <all_urls> for programmatic captureVisibleTab', () => {
			expect(manifest.permissions).toContain('<all_urls>');
		});

		it('does not list thumbnail.js in background scripts', () => {
			expect(manifest.background.scripts).not.toContain('thumbnail.js');
		});
	});
});
