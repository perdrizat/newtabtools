import { test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line ntt/no-source-grep
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filesToCheck = ['newTab.xhtml', 'action.html'];

for (const file of filesToCheck) {
	test(`${file} should not contain hardcoded English text nodes`, () => {
		// eslint-disable-next-line ntt/no-source-grep
		const content = fs.readFileSync(path.join(__dirname, '../../webextension', file), 'utf-8');
		
		const errors: string[] = [];
		
		// Strip style and script blocks before matching
		let strippedContent = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
		strippedContent = strippedContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
		
		// Match text between > and <
		const textNodeRegex = />([^<]+)</g;
		for (const match of strippedContent.matchAll(textNodeRegex)) {
			const text = match[1].trim();
			// Ignore empty text, single letters like 'v', or non-alphabetic chars
			if (text.length > 1 && /[a-zA-Z]/.test(text)) {
				errors.push(`Hardcoded text node: "${text}"`);
			}
		}
		
		// Check for hardcoded placeholder attributes (but ignore data-placeholder)
		const placeholderRegex = /(?<!data-)placeholder="([^"]+)"/g;
		for (const match of content.matchAll(placeholderRegex)) {
			const text = match[1].trim();
			if (text.length > 0 && /[a-zA-Z]/.test(text)) {
				errors.push(`Hardcoded placeholder attribute: "${text}"`);
			}
		}

		expect(errors, `Found hardcoded text in ${file}. Please use data-message attributes instead.`).toEqual([]);
	});
}
