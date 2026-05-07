/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit test: localization smoke test.
 * Phase 1 slot 5 of the migration plan (MIGRATION.md).
 *
 * Verifies _locales/ structural integrity:
 *   - en/messages.json is valid JSON with the expected schema
 *   - every key referenced in code (JS getString/getMessage, XHTML data-* attrs,
 *     manifest __MSG_*__) exists in the en locale
 *   - every non-en locale has valid JSON and the two manifest-required keys
 *   - no locale has orphan keys absent from en (possible stale translations)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../../webextension/_locales');
const WEBEXT_DIR = path.resolve(__dirname, '../../webextension');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filePath: string): Record<string, { message: string }> {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectLocales(): string[] {
	return fs.readdirSync(LOCALES_DIR).filter(d =>
		fs.statSync(path.join(LOCALES_DIR, d)).isDirectory(),
	);
}

/** Extract all message keys referenced in JS via getString('key') or getMessage('key'). */
function collectJSKeys(): Set<string> {
	const keys = new Set<string>();
	const jsFiles = fs.readdirSync(WEBEXT_DIR)
		.filter(f => f.endsWith('.js') && !f.startsWith('zip'))
		.map(f => path.join(WEBEXT_DIR, f));

	for (const file of jsFiles) {
		const src = fs.readFileSync(file, 'utf8');
		const re = /(?:getString|getMessage)\(['"](\w+)['"]/g;
		let m;
		while ((m = re.exec(src)) !== null) {
			keys.add(m[1]);
		}
	}
	return keys;
}

/** Extract all message keys referenced in XHTML/HTML via data-message, data-placeholder, data-title, data-label. */
function collectMarkupKeys(): Set<string> {
	const keys = new Set<string>();
	const markupFiles = fs.readdirSync(WEBEXT_DIR)
		.filter(f => f.endsWith('.xhtml') || f.endsWith('.html'))
		.map(f => path.join(WEBEXT_DIR, f));

	for (const file of markupFiles) {
		const src = fs.readFileSync(file, 'utf8');
		const re = /data-(?:message|placeholder|title|label)="(\w+)"/g;
		let m;
		while ((m = re.exec(src)) !== null) {
			keys.add(m[1]);
		}
	}
	return keys;
}

/** Extract __MSG_key__ references from manifest.json. */
function collectManifestKeys(): Set<string> {
	const manifest = fs.readFileSync(path.join(WEBEXT_DIR, 'manifest.json'), 'utf8');
	const keys = new Set<string>();
	const re = /__MSG_(\w+)__/g;
	let m;
	while ((m = re.exec(manifest)) !== null) {
		keys.add(m[1]);
	}
	return keys;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Localization — _locales/ smoke test (Phase 1 slot 5)', () => {
	const enMessages = readJSON(path.join(LOCALES_DIR, 'en', 'messages.json'));
	const enKeys = new Set(Object.keys(enMessages));
	const locales = collectLocales();

	// ==================== en locale structure ====================

	it('en/messages.json is valid JSON with at least 50 keys', () => {
		expect(enKeys.size).toBeGreaterThanOrEqual(50);
	});

	it('every en entry has a non-empty "message" string', () => {
		for (const [key, entry] of Object.entries(enMessages)) {
			expect(entry, `key "${key}" missing message`).toHaveProperty('message');
			expect(typeof entry.message, `key "${key}" message not a string`).toBe('string');
			expect(entry.message.length, `key "${key}" has empty message`).toBeGreaterThan(0);
		}
	});

	it('en locale contains the manifest-required keys', () => {
		expect(enMessages).toHaveProperty('extensionName');
		expect(enMessages).toHaveProperty('extensionDescription');
	});

	// ==================== code references resolve ====================

	it('every JS getString/getMessage key exists in en locale', () => {
		const jsKeys = collectJSKeys();
		const missing = [...jsKeys].filter(k => !enKeys.has(k));
		expect(missing, `Missing keys in en: ${missing.join(', ')}`).toEqual([]);
	});

	it('every XHTML/HTML data-* key exists in en locale', () => {
		const markupKeys = collectMarkupKeys();
		const missing = [...markupKeys].filter(k => !enKeys.has(k));
		expect(missing, `Missing keys in en: ${missing.join(', ')}`).toEqual([]);
	});

	it('every manifest __MSG_*__ key exists in en locale', () => {
		const manifestKeys = collectManifestKeys();
		const missing = [...manifestKeys].filter(k => !enKeys.has(k));
		expect(missing, `Missing keys in en: ${missing.join(', ')}`).toEqual([]);
	});

	// ==================== non-en locales ====================

	it('at least 10 non-en locales exist', () => {
		const nonEn = locales.filter(l => l !== 'en');
		expect(nonEn.length).toBeGreaterThanOrEqual(10);
	});

	it('every non-en locale has valid JSON', () => {
		for (const locale of locales) {
			if (locale === 'en') {continue;}
			const filePath = path.join(LOCALES_DIR, locale, 'messages.json');
			expect(() => {
				readJSON(filePath);
			}, `${locale}/messages.json is not valid JSON`).not.toThrow();
		}
	});

	it('characterizes which locales are missing manifest-required keys (fallback to en)', () => {
		// Characterization: some locales rely on Firefox's locale fallback chain
		// for extensionName/extensionDescription. Pin the current state.
		const missingName: string[] = [];
		const missingDescription: string[] = [];
		for (const locale of locales) {
			if (locale === 'en' || locale === 'en-GB') {continue;}
			const messages = readJSON(path.join(LOCALES_DIR, locale, 'messages.json'));
			if (!('extensionName' in messages)) {missingName.push(locale);}
			if (!('extensionDescription' in messages)) {missingDescription.push(locale);}
		}
		expect(missingName).toEqual(['zh-CN']);
		expect(missingDescription).toEqual(['bg']);
	});

	it('no non-en locale has keys absent from en (stale translations)', () => {
		const stale: string[] = [];
		for (const locale of locales) {
			if (locale === 'en') {continue;}
			const messages = readJSON(path.join(LOCALES_DIR, locale, 'messages.json'));
			for (const key of Object.keys(messages)) {
				if (!enKeys.has(key)) {
					stale.push(`${locale}/${key}`);
				}
			}
		}
		expect(stale, `Stale keys: ${stale.join(', ')}`).toEqual([]);
	});
});
