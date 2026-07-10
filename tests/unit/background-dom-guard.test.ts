/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Chrome-prep C1 guard regression net (CHROME_PREP.md C1).
 *
 * webextension/lib/** is the extension's background scope. It runs today as
 * a Firefox event page (full DOM/window/canvas access), but must stay
 * portable to a future Chrome MV3 service worker, which has none of that.
 * eslint.config.js carries a `no-restricted-globals` guard scoped to
 * `webextension/lib/**\/*.js`, excluding `lib/thumbnail-image.js` (the one
 * designated Chrome-swap seam) and the vendored `lib/zip/**`.
 *
 * This test asks ESLint's own flat-config resolution (`calculateConfigForFile`)
 * what rule set applies to representative files, rather than string-matching
 * eslint.config.js's source — the cheapest honest net against someone
 * deleting or narrowing the guard, and it can't be fooled by a config that
 * merely *mentions* the right globals without actually restricting them
 * (calculateConfigForFile returns the real merged rule ESLint would enforce).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const GUARDED_GLOBALS = [
	'document',
	'window',
	'Image',
	'OffscreenCanvas',
	'DOMParser',
	'XMLSerializer',
	'localStorage',
];

describe('background DOM guard (eslint.config.js, CHROME_PREP.md C1)', () => {
	let eslint: ESLint;

	beforeAll(() => {
		eslint = new ESLint({ cwd: process.cwd() });
	});

	it('restricts every DOM/canvas global in an ordinary lib/** file', async () => {
		const config = await eslint.calculateConfigForFile('webextension/lib/db.js');
		const rule = config.rules?.['no-restricted-globals'];

		expect(rule).toBeDefined();
		expect(rule[0]).toBe(2); // error, not warn

		const restrictedNames = rule.slice(1).map((entry: { name: string }) => entry.name);
		for (const name of GUARDED_GLOBALS) {
			expect(restrictedNames).toContain(name);
		}

		// Every entry must point back at the seam so a violation is actionable.
		for (const entry of rule.slice(1)) {
			expect(entry.message).toMatch(/lib\/thumbnail-image\.js/);
			expect(entry.message).toMatch(/CHROME_PREP\.md C1/);
		}
	});

	it('exempts the designated Chrome-swap seam, lib/thumbnail-image.js', async () => {
		const config = await eslint.calculateConfigForFile('webextension/lib/thumbnail-image.js');
		expect(config.rules?.['no-restricted-globals']).toBeUndefined();
	});

	it('exempts the vendored lib/zip/** bundle', async () => {
		// zip/** is globally ignored (vendored code) on top of the guard's own
		// exclusion, so ESLint treats it as fully unlinted: calculateConfigForFile
		// returns undefined rather than a config object. Either way, the guard
		// does not apply — assert on the ESLint-observable outcome, not on why.
		const config = await eslint.calculateConfigForFile('webextension/lib/zip/zip-core-base.js');
		expect(config?.rules?.['no-restricted-globals']).toBeUndefined();
	});

	it('still applies the guard to a nested lib/** file other than the seam', async () => {
		const config = await eslint.calculateConfigForFile('webextension/lib/tiles-store.js');
		expect(config.rules?.['no-restricted-globals']?.[0]).toBe(2);
	});
});
