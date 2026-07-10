/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: CSS Grid layout (newTab.css).
 *
 * Verifies that #newtab-grid uses CSS Grid (display: grid) instead of
 * flexbox, with grid-template-columns using repeat() and gap using
 * --ntt-gap. Also verifies that the old .newtab-row flexbox rules are
 * removed and cells are direct grid children.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('CSS Grid layout — newTab.css', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS grid rules
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	it('#newtab-grid uses display: grid', () => {
		const gridBlock = extractBlock(css, '#newtab-grid');
		expect(gridBlock).toMatch(/display:\s*grid/);
	});

	it('#newtab-grid uses grid-template-columns with repeat()', () => {
		const gridBlock = extractBlock(css, '#newtab-grid');
		expect(gridBlock).toMatch(/grid-template-columns:\s*repeat\(/);
	});

	it('#newtab-grid uses --ntt-gap for gap', () => {
		const gridBlock = extractBlock(css, '#newtab-grid');
		expect(gridBlock).toMatch(/gap:\s*var\(--ntt-gap\)/);
	});

	it('does not have .newtab-row display: flex rules', () => {
		expect(css).not.toMatch(/\.newtab-row\s*\{[^}]*display:\s*flex/);
	});

	it('does not have .newtab-row margin-bottom rules', () => {
		expect(css).not.toMatch(/\.newtab-row[^{]*\{[^}]*margin-bottom/);
	});

	it('.newtab-cell does not use flex: 1', () => {
		const cellBlocks = extractAllBlocks(css, '.newtab-cell');
		for (const block of cellBlocks) {
			if (!block.includes('tileaspect')) {
				expect(block).not.toMatch(/flex:\s*1/);
			}
		}
	});
});

describe('CSS Grid — grid.js _renderGrid', () => {
	let source: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: JS grid rendering
		source = fs.readFileSync(
			path.resolve(__dirname, '../../webextension/grid.js'), 'utf8'
		);
	});

	it('does not create .newtab-row elements', () => {
		const renderGrid = extractMethod(source, '_renderGrid');
		expect(renderGrid).not.toMatch(/newtab-row/);
	});

	it('creates .newtab-cell as direct children of the grid', () => {
		const renderGrid = extractMethod(source, '_renderGrid');
		expect(renderGrid).toMatch(/newtab-cell/);
	});

	it('sets --ntt-cols CSS variable', () => {
		const renderGrid = extractMethod(source, '_renderGrid');
		expect(renderGrid).toMatch(/--ntt-cols/);
	});
});

function extractBlock(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
	let match;
	const blocks: string[] = [];
	while ((match = regex.exec(css)) !== null) {
		blocks.push(match[1]);
	}
	return blocks.join('\n');
}

function extractAllBlocks(css: string, selector: string): string[] {
	const lines = css.split('\n');
	const blocks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(selector)) {
			let depth = 0;
			let block = '';
			for (let j = i; j < lines.length; j++) {
				block += lines[j] + '\n';
				for (const ch of lines[j]) {
					if (ch === '{') {depth++;}
					if (ch === '}') {depth--;}
				}
				if (depth <= 0) {break;}
			}
			blocks.push(block);
		}
	}
	return blocks;
}

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) {throw new Error(`${methodName} not found`);}
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') {depth++;}
		else if (source[i] === '}') { depth--; if (depth === 0) {return source.substring(start, i + 1);} }
	}
	throw new Error('Unbalanced braces');
}
