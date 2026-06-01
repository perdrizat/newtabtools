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
// eslint-disable-next-line ntt/no-source-grep -- loading manifest for structural validation
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

	// Regression guard: a blanket scheme wildcard (`https:`, `http:`, `ws:`,
	// `wss:`) or a bare `*` in a fetch directive grants the extension access to
	// ANY origin on that scheme — e.g. `connect-src https:` is a read/exfil
	// channel over fetch()/XHR/WebSocket. The `connect-src https:` form was
	// silently reintroduced in a Phase 3/4 feature commit and only caught in the
	// 2026-05-31 review, then reverted (favicons paint via `img-src https:`
	// instead — see audit/2026-05-31-csp-tightening.md). This fails the build if
	// any such wildcard sneaks into a script/style/connect/default directive.
	describe('CSP — no blanket scheme/* wildcard in fetch directives (audit/2026-05-31)', () => {
		// `img-src` is intentionally excluded: it legitimately carries `https:`
		// so remote favicons can be *painted* (paint-only, canvas-tainted, no
		// read-back). The exfiltration-capable directives are guarded here.
		const GUARDED_DIRECTIVES = ['default-src', 'script-src', 'style-src', 'connect-src'];
		const FORBIDDEN_SCHEMES = ['http:', 'https:', 'ws:', 'wss:'];

		// Extract a directive (everything up to the next `;`), or '' if absent.
		function directiveOf(csp: string, name: string): string {
			return (csp.match(new RegExp(name + '[^;]*')) || [''])[0];
		}

		// Return the offending token if the directive grants blanket access via a
		// standalone scheme source or a bare `*` host wildcard; null otherwise. A
		// named host like `https://firefox.settings…` or `wss://host` is fine —
		// the trailing `(\s|$)` ensures we only flag the *bare* scheme token, not
		// `scheme://host`.
		function blanketWildcardIn(directive: string): string | null {
			if (/(^|\s)\*(\s|$)/.test(directive)) {
				return '*';
			}
			for (const scheme of FORBIDDEN_SCHEMES) {
				if (new RegExp('(^|\\s)' + scheme + '(\\s|$)').test(directive)) {
					return scheme;
				}
			}
			return null;
		}

		// The real manifest: every guarded directive that is present must be clean.
		GUARDED_DIRECTIVES.forEach((name) => {
			it(`real manifest ${name} carries no scheme/* wildcard`, () => {
				const directive = directiveOf(manifest.content_security_policy, name);
				if (directive === '') {
					return; // directive absent → nothing to over-permit
				}
				expect(blanketWildcardIn(directive)).toBeNull();
			});
		});

		// Teeth check: prove the detector catches every (directive × wildcard)
		// regression — otherwise a broken matcher would let the guards above pass
		// vacuously. Includes the exact `connect-src https:` form that regressed.
		GUARDED_DIRECTIVES.forEach((name) => {
			[...FORBIDDEN_SCHEMES, '*'].forEach((wildcard) => {
				it(`detector flags ${name} ${wildcard}`, () => {
					// Neutral prefix (object-src is not a guarded name and shares no
					// prefix with one) so directiveOf extracts the wildcard clause.
					const csp = 'object-src \'none\'; ' + name + ' \'self\' ' + wildcard + '; img-src \'self\'';
					expect(blanketWildcardIn(directiveOf(csp, name))).toBe(wildcard);
				});
			});
		});

		// And it must NOT false-positive on legitimate named hosts per scheme.
		it('detector does not flag named hosts (https:// / wss://)', () => {
			expect(blanketWildcardIn(directiveOf(
				'connect-src \'self\' https: https://firefox.settings.services.mozilla.com', 'connect-src'
			))).toBe('https:'); // the bare https: still trips even alongside a named host
			expect(blanketWildcardIn(directiveOf(
				'connect-src \'self\' https://firefox.settings.services.mozilla.com', 'connect-src'
			))).toBeNull();
			expect(blanketWildcardIn(directiveOf(
				'connect-src \'self\' wss://example.com', 'connect-src'
			))).toBeNull();
		});
	});

	describe('Minimum version', () => {
		it('requires at least Firefox ESR 128', () => {
			const minVersion = parseFloat(manifest.applications.gecko.strict_min_version);
			expect(minVersion).toBeGreaterThanOrEqual(128);
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
