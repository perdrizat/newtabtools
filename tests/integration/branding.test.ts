/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Branding rename ("NewTab PowerTools") + About section.
 *
 * User-facing copy and links read "NewTab PowerTools" (exact casing). The
 * Geoff Lankow lineage credit keeps "New Tab Tools". Internal identifiers
 * (extension id, storage/pref keys, AMO slug) MUST NOT change — renaming them
 * would wipe users' saved data / break the published listing.
 *
 * The About section is the brand home: left-aligned, logo + title linking to the
 * AMO listing, a separate Source-on-GitHub link, external links opening in a new
 * tab (rel=noopener).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_PATH = path.resolve(__dirname, '../../webextension/_locales/en/messages.json');
const MANIFEST_PATH = path.resolve(__dirname, '../../webextension/manifest.json');
const XHTML_PATH = path.resolve(__dirname, '../../webextension/newTab.xhtml');
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

const AMO_URL = 'https://addons.mozilla.org/firefox/addon/newtab-powertools/';

describe('Branding rename — user-facing copy', () => {
	let messages: Record<string, { message: string }>;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: locale copy
		messages = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));
	});

	it('the extension name is "NewTab PowerTools"', () => {
		expect(messages.extensionName.message).toBe('NewTab PowerTools');
	});

	it('renamed user-facing strings no longer say "New Tab Tools"', () => {
		const renamed = [
			'backup_description', 'options_title', 'history_disabled_message',
			'startup_error', 'restart_message', 'pinURL_permissions_message',
			'restore_description',
		];
		for (const key of renamed) {
			if (!(key in messages)) { continue; } // key name resolved structurally below
		}
		// Any en string that mentions the product (other than the lineage credit)
		// must use the new name.
		for (const [key, val] of Object.entries(messages)) {
			if (key === 'options_about_lineage') { continue; }
			expect(val.message, `${key} still says "New Tab Tools"`).not.toMatch(/New Tab Tools/);
		}
	});

	it('the lineage credit still names "New Tab Tools by Geoff Lankow"', () => {
		expect(messages.options_about_lineage.message).toMatch(/New Tab Tools/);
		expect(messages.options_about_lineage.message).toMatch(/Geoff Lankow/);
	});

	it('the GitHub link label reads "Source on GitHub"', () => {
		expect(messages.github.message).toBe('Source on GitHub');
	});

	it('the add-tile label is "+ Pin tile"', () => {
		expect(messages.tile_add.message).toBe('+ Pin tile');
	});
});

describe('Branding — internal identifiers untouched', () => {
	it('the extension id is still newtabtools@symlink.ch', () => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: manifest id unchanged
		const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
		expect(manifest.browser_specific_settings.gecko.id).toBe('newtabtools@symlink.ch');
	});
});

describe('About section — brand home', () => {
	let xhtml: string;
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: About markup
		xhtml = fs.readFileSync(XHTML_PATH, 'utf8');
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: About CSS
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	function aboutBlock(): string {
		const start = xhtml.indexOf('id="options-about"');
		expect(start).toBeGreaterThan(-1);
		const end = xhtml.indexOf('</section>', start);
		return xhtml.slice(start, end > -1 ? end : undefined);
	}

	it('the brand link points to the AMO listing and opens in a new tab', () => {
		const block = aboutBlock();
		const amo = block.match(new RegExp(`<a[^>]*href="${AMO_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"[^>]*>`));
		expect(amo, 'AMO brand link present').toBeTruthy();
		expect(amo![0]).toMatch(/target="_blank"/);
		expect(amo![0]).toMatch(/rel="[^"]*noopener/);
	});

	it('the logo image is shown in About', () => {
		expect(aboutBlock()).toMatch(/<img[^>]*src="images\/icon\.svg"/);
	});

	it('a separate Source-on-GitHub link exists', () => {
		expect(aboutBlock()).toMatch(/data-message="github"/);
	});

	it('every About link opens in a new tab with rel=noopener', () => {
		const block = aboutBlock();
		const anchors = block.match(/<a\b[^>]*>/g) || [];
		expect(anchors.length).toBeGreaterThan(0);
		for (const a of anchors) {
			expect(a, `link missing target=_blank: ${a}`).toMatch(/target="_blank"/);
			expect(a, `link missing rel=noopener: ${a}`).toMatch(/rel="[^"]*noopener/);
		}
	});

	it('the About block is left-aligned', () => {
		expect(css).toMatch(/#options-about\s*\{[^}]*text-align:\s*left/s);
	});

	it('the About links row is left-aligned (not centered)', () => {
		expect(css).toMatch(/#options-about \.options-row\s*\{[^}]*justify-content:\s*flex-start/s);
	});
});
