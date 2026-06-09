/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * E2E render smoke for i18n: the one real-browser confirmation that the
 * localization loop (newTab.js startup → `[data-message]`/`[data-title]`/… )
 * actually runs in Firefox and leaves no leftovers a user would see.
 *
 * The deterministic tiers cover the data (keys exist, placeholders intact, no
 * hardcoded literals); this covers the *wiring* end-to-end. After load + drawer
 * open, no visible text may:
 *   - equal a raw message key (a label rendered as `options_columns` because
 *     the loop didn't apply, or applied the wrong attribute), or
 *   - contain a `$1`/`$NAME$`/`__MSG_…__` substitution leftover.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState } from './_helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function enMessageKeys(): string[] {
	const file = path.resolve(__dirname, '../../webextension/_locales/en/messages.json');
	return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
}

describe('E2E: i18n renders with no key/placeholder leaks', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		page = await openNewTab(browser);
		await waitForGridReady(page);
		// Open the drawer so every localized control is in the DOM.
		await page.evaluate(() => document.getElementById('options-toggle')?.click());
		await new Promise(r => setTimeout(r, 400));
	}, 60_000);

	afterAll(async () => {
		if (page) { await page.close(); }
		if (browser) { await browser.disconnect(); }
	});

	it('no visible text equals a raw message key or leaks a placeholder', async () => {
		const keys = enMessageKeys();
		const offenders = await page.evaluate((messageKeys: string[]) => {
			const keySet = new Set(messageKeys);
			// $1..$9 positional, $NAME$ named token, or __MSG_key__ — all leftovers.
			const leak = /\$[1-9]\b|\$[A-Za-z_][A-Za-z0-9_]*\$|__MSG_[A-Za-z0-9_]+__/;
			const bad: string[] = [];
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			let n: Node | null;
			while ((n = walker.nextNode())) {
				const parent = n.parentElement;
				if (!parent) { continue; }
				const tag = parent.tagName;
				if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') { continue; }
				const text = (n.textContent || '').trim();
				if (!text) { continue; }
				if (keySet.has(text)) { bad.push(`raw key rendered: "${text}"`); }
				if (leak.test(text)) { bad.push(`placeholder leak: "${text}"`); }
			}
			return bad;
		}, keys);

		expect(offenders, `i18n leftovers in rendered page:\n${offenders.join('\n')}`).toEqual([]);
	}, 30_000);
});
