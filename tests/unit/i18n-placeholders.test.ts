/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Cross-locale translation-integrity guard.
 *
 * `localization.test.ts` checks that referenced keys *exist*. This checks that
 * the strings *don't break at runtime* — the class a key-existence check
 * misses. Firefox falls back to `default_locale` (en) for a *missing* key, so
 * an incomplete translation is not a break; but a *present* entry with a
 * broken placeholder is, and surfaces to the user verbatim:
 *
 *   - empty / non-string message,
 *   - a named token `$NAME$` with no backing `placeholders` entry → Firefox
 *     can't resolve it, so the substituted value is dropped/garbled (the real
 *     `de` bug below: "Vor $1$m" loses the minute count entirely).
 *
 * Note: a *bare* positional `$1`..`$9` directly in the message IS valid and
 * documented (Chrome/Firefox substitute it from the args array without any
 * `placeholders` block — `el`/`ja` use this form correctly), so it is NOT
 * flagged. Only the named-token-without-placeholders shape is a break.
 *
 * Runs over every locale in milliseconds — far cheaper and more reliable than
 * booting Firefox per locale (the app-locale switch needs a langpack and
 * silently falls back to en without one, so a "de" browser run would just
 * re-test English).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../../webextension/_locales');

interface Entry { message: string; placeholders?: Record<string, { content: string }>; }
type Messages = Record<string, Entry>;

// Named placeholder tokens like $MINUTES$ (or the malformed $1$). Firefox only
// substitutes these when a matching (case-insensitive) key exists in the
// entry's `placeholders`; otherwise the value is dropped/garbled.
const NAMED_TOKEN = /\$([A-Za-z0-9_]+)\$/g;

/** Problems with a single message entry; empty array means it's intact. */
function entryProblems(key: string, entry: Entry): string[] {
	const problems: string[] = [];
	if (typeof entry.message !== 'string' || entry.message.length === 0) {
		return [`${key}: empty or non-string message`];
	}
	const declared = new Set(
		Object.keys(entry.placeholders || {}).map(p => p.toLowerCase()),
	);
	let m: RegExpExecArray | null;
	NAMED_TOKEN.lastIndex = 0;
	while ((m = NAMED_TOKEN.exec(entry.message)) !== null) {
		if (!declared.has(m[1].toLowerCase())) {
			problems.push(`${key}: named placeholder $${m[1]}$ has no "placeholders" entry (value is dropped/garbled)`);
		}
	}
	return problems;
}

function localeDirs(): string[] {
	return fs.readdirSync(LOCALES_DIR)
		.filter(d => fs.statSync(path.join(LOCALES_DIR, d)).isDirectory());
}

describe('i18n — cross-locale placeholder integrity', () => {
	// ---- teeth: the validator must flag the real break modes ----
	it('entryProblems flags broken entries and passes intact ones', () => {
		// Broken: named token with no placeholders block → value dropped.
		expect(entryProblems('x', { message: '$MINUTES$m ago' })).not.toEqual([]);
		// Broken: the malformed `$1$` de form (named placeholder "1", undefined).
		expect(entryProblems('x', { message: 'Vor $1$m' })).not.toEqual([]);
		// Broken: empty message.
		expect(entryProblems('x', { message: '' })).not.toEqual([]);
		// Intact: named token correctly backed by a placeholders entry.
		expect(entryProblems('x', {
			message: '$MINUTES$m ago',
			placeholders: { minutes: { content: '$1' } },
		})).toEqual([]);
		// Intact: a *bare* positional $1 is the documented, working form.
		expect(entryProblems('x', { message: 'add an exception for $1.' })).toEqual([]);
		// Intact: a plain string and an escaped literal dollar.
		expect(entryProblems('x', { message: 'Search the web' })).toEqual([]);
		expect(entryProblems('x', { message: 'Pay $$5 now' })).toEqual([]);
	});

	// ---- guard: every real locale must be intact ----
	it('every message in every locale has intact placeholders (no leaks)', () => {
		const problems: string[] = [];
		for (const locale of localeDirs()) {
			const messages: Messages = JSON.parse(
				fs.readFileSync(path.join(LOCALES_DIR, locale, 'messages.json'), 'utf8'),
			);
			for (const [key, entry] of Object.entries(messages)) {
				for (const p of entryProblems(key, entry)) {
					problems.push(`${locale}/${p}`);
				}
			}
		}
		expect(problems, `Placeholder problems found:\n${problems.join('\n')}`).toEqual([]);
	});
});
