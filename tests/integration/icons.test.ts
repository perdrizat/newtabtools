/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: NttIcons inline SVG icon module (icons.js).
 *
 * Verifies that NttIcons.create() returns valid SVG elements with correct
 * viewBox, dimensions, stroke attributes, and child elements for every
 * icon name in the design handoff.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const ALL_ICON_NAMES = [
	'search', 'settings', 'pin', 'camera', 'camera-off', 'edit', 'close', 'plus',
	'open', 'arrow-up', 'arrow-down', 'arrow-right', 'chevron-right',
	'chevron-down', 'history', 'bookmark', 'kebab', 'cmd', 'sun',
	'moon', 'sparkline', 'dot', 'grid', 'layers', 'sliders',
	'keyboard', 'flame',
];

describe('NttIcons — icons.js', () => {
	let NttIcons: any;

	beforeAll(async () => {
		// page-modules P2 (PAGE_MODULES.md): icons.js is a real ES module now
		// (`export const NttIcons`), so it's natively imported rather than
		// vm-loaded — see webextension/icons.js's own header for the export.
		({ NttIcons } = await import('../../webextension/icons.js'));
	});

	it('exposes NttIcons on globalThis', () => {
		expect(NttIcons).toBeDefined();
		expect(typeof NttIcons.create).toBe('function');
	});

	it('has a names array listing all supported icons', () => {
		expect(Array.isArray(NttIcons.names)).toBe(true);
		for (const name of ALL_ICON_NAMES) {
			expect(NttIcons.names).toContain(name);
		}
	});

	describe.each(ALL_ICON_NAMES)('icon "%s"', (name) => {
		it('returns an SVG element', () => {
			const svg = NttIcons.create(name);
			expect(svg).toBeInstanceOf(SVGElement);
			expect(svg.tagName.toLowerCase()).toBe('svg');
		});

		it('has viewBox="0 0 24 24"', () => {
			const svg = NttIcons.create(name);
			expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
		});

		it('defaults to 14×14 size', () => {
			const svg = NttIcons.create(name);
			expect(svg.getAttribute('width')).toBe('14');
			expect(svg.getAttribute('height')).toBe('14');
		});

		it('has at least one child element', () => {
			const svg = NttIcons.create(name);
			expect(svg.children.length).toBeGreaterThanOrEqual(1);
		});
	});

	it('applies custom size', () => {
		const svg = NttIcons.create('close', 20);
		expect(svg.getAttribute('width')).toBe('20');
		expect(svg.getAttribute('height')).toBe('20');
	});

	it('applies custom color', () => {
		const svg = NttIcons.create('close', 14, '#ff0000');
		expect(svg.getAttribute('stroke')).toBe('#ff0000');
	});

	it('applies custom strokeWidth', () => {
		const svg = NttIcons.create('close', 14, 'currentColor', 2.5);
		expect(svg.getAttribute('stroke-width')).toBe('2.5');
	});

	it('defaults stroke to currentColor', () => {
		const svg = NttIcons.create('close');
		expect(svg.getAttribute('stroke')).toBe('currentColor');
	});

	it('defaults strokeWidth to 1.7', () => {
		const svg = NttIcons.create('close');
		expect(svg.getAttribute('stroke-width')).toBe('1.7');
	});

	it('sets fill="none" by default on stroke-based icons', () => {
		const svg = NttIcons.create('close');
		expect(svg.getAttribute('fill')).toBe('none');
	});

	it('returns null for unknown icon names', () => {
		const svg = NttIcons.create('nonexistent');
		expect(svg).toBeNull();
	});

	it('search icon has a circle and a line', () => {
		const svg = NttIcons.create('search');
		expect(svg.querySelector('circle')).not.toBeNull();
		expect(svg.querySelector('line')).not.toBeNull();
	});

	it('close icon has two lines forming an X', () => {
		const svg = NttIcons.create('close');
		const lines = svg.querySelectorAll('line');
		expect(lines.length).toBe(2);
	});

	it('plus icon has two lines forming a +', () => {
		const svg = NttIcons.create('plus');
		const lines = svg.querySelectorAll('line');
		expect(lines.length).toBe(2);
	});

	it('kebab icon has three filled circles', () => {
		const svg = NttIcons.create('kebab');
		const circles = svg.querySelectorAll('circle');
		expect(circles.length).toBe(3);
	});

	it('grid icon has four rects', () => {
		const svg = NttIcons.create('grid');
		const rects = svg.querySelectorAll('rect');
		expect(rects.length).toBe(4);
	});

	it('sun icon has a circle and multiple lines for rays', () => {
		const svg = NttIcons.create('sun');
		expect(svg.querySelector('circle')).not.toBeNull();
		expect(svg.querySelectorAll('line').length).toBeGreaterThanOrEqual(8);
	});
});
