/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported NttIcons */

var NttIcons = (() => {
	const SVG_NS = 'http://www.w3.org/2000/svg';

	function el(tag, attrs, children) {
		let node = document.createElementNS(SVG_NS, tag);
		if (attrs) {
			for (let [k, v] of Object.entries(attrs)) {
				if (v != null) {
					node.setAttribute(k, String(v));
				}
			}
		}
		if (children) {
			for (let child of children) {
				node.appendChild(child);
			}
		}
		return node;
	}

	const ICONS = {
		search() {
			return [
				el('circle', { cx: 11, cy: 11, r: 7 }),
				el('line', { x1: 16.6, y1: 16.6, x2: 21, y2: 21 }),
			];
		},
		settings() {
			return [
				el('circle', { cx: 12, cy: 12, r: 3 }),
				el('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }),
			];
		},
		pin() {
			return [
				el('path', { d: 'M12 17v5' }),
				el('path', { d: 'M9 2h6l-1 5 3 3-5 1-5-1 3-3z' }),
			];
		},
		refresh() {
			return [
				el('path', { d: 'M3 12a9 9 0 0 1 15.5-6.3L21 8' }),
				el('path', { d: 'M21 3v5h-5' }),
				el('path', { d: 'M21 12a9 9 0 0 1-15.5 6.3L3 16' }),
				el('path', { d: 'M3 21v-5h5' }),
			];
		},
		edit() {
			return [el('path', { d: 'M17 3l4 4-12 12H5v-4z' })];
		},
		close() {
			return [
				el('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
				el('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
			];
		},
		plus() {
			return [
				el('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
				el('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
			];
		},
		open() {
			return [
				el('path', { d: 'M14 4h6v6' }),
				el('line', { x1: 20, y1: 4, x2: 11, y2: 13 }),
				el('path', { d: 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }),
			];
		},
		'arrow-up'() {
			return [
				el('line', { x1: 12, y1: 19, x2: 12, y2: 5 }),
				el('polyline', { points: '5 12 12 5 19 12' }),
			];
		},
		'arrow-down'() {
			return [
				el('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
				el('polyline', { points: '19 12 12 19 5 12' }),
			];
		},
		'arrow-right'() {
			return [
				el('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
				el('polyline', { points: '12 5 19 12 12 19' }),
			];
		},
		'chevron-right'() {
			return [el('polyline', { points: '9 6 15 12 9 18' })];
		},
		'chevron-down'() {
			return [el('polyline', { points: '6 9 12 15 18 9' })];
		},
		history() {
			return [
				el('circle', { cx: 12, cy: 12, r: 9 }),
				el('polyline', { points: '12 7 12 12 15 14' }),
				el('path', { d: 'M3 12a9 9 0 0 1 4.5-7.8' }),
			];
		},
		bookmark() {
			return [el('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' })];
		},
		kebab(color) {
			return [
				el('circle', { cx: 12, cy: 6, r: 1.2, fill: color, stroke: 'none' }),
				el('circle', { cx: 12, cy: 12, r: 1.2, fill: color, stroke: 'none' }),
				el('circle', { cx: 12, cy: 18, r: 1.2, fill: color, stroke: 'none' }),
			];
		},
		cmd() {
			return [el('path', { d: 'M6 18a2 2 0 1 1 2-2v0h8v0a2 2 0 1 1-2 2v-8a2 2 0 1 1 2-2h0a2 2 0 1 1-2 2H8a2 2 0 1 1-2-2 2 2 0 0 1 2 2v8a2 2 0 0 1-2 2z' })];
		},
		sun() {
			return [
				el('circle', { cx: 12, cy: 12, r: 4 }),
				el('line', { x1: 12, y1: 2, x2: 12, y2: 4 }),
				el('line', { x1: 12, y1: 20, x2: 12, y2: 22 }),
				el('line', { x1: 4.9, y1: 4.9, x2: 6.3, y2: 6.3 }),
				el('line', { x1: 17.7, y1: 17.7, x2: 19.1, y2: 19.1 }),
				el('line', { x1: 2, y1: 12, x2: 4, y2: 12 }),
				el('line', { x1: 20, y1: 12, x2: 22, y2: 12 }),
				el('line', { x1: 4.9, y1: 19.1, x2: 6.3, y2: 17.7 }),
				el('line', { x1: 17.7, y1: 6.3, x2: 19.1, y2: 4.9 }),
			];
		},
		moon() {
			return [el('path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' })];
		},
		sparkline() {
			return [el('polyline', { points: '2 14 6 10 10 13 14 7 18 11 22 5' })];
		},
		dot(color) {
			return [el('circle', { cx: 12, cy: 12, r: 4, fill: color })];
		},
		grid() {
			return [
				el('rect', { x: 3, y: 3, width: 7, height: 7 }),
				el('rect', { x: 14, y: 3, width: 7, height: 7 }),
				el('rect', { x: 3, y: 14, width: 7, height: 7 }),
				el('rect', { x: 14, y: 14, width: 7, height: 7 }),
			];
		},
		layers() {
			return [
				el('polygon', { points: '12 2 22 8 12 14 2 8' }),
				el('polyline', { points: '2 16 12 22 22 16' }),
				el('polyline', { points: '2 12 12 18 22 12' }),
			];
		},
		sliders() {
			return [
				el('line', { x1: 4, y1: 6, x2: 20, y2: 6 }),
				el('circle', { cx: 9, cy: 6, r: 2 }),
				el('line', { x1: 4, y1: 12, x2: 20, y2: 12 }),
				el('circle', { cx: 15, cy: 12, r: 2 }),
				el('line', { x1: 4, y1: 18, x2: 20, y2: 18 }),
				el('circle', { cx: 8, cy: 18, r: 2 }),
			];
		},
		keyboard() {
			return [
				el('rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }),
				el('line', { x1: 6, y1: 10, x2: 6, y2: 10 }),
				el('line', { x1: 10, y1: 10, x2: 10, y2: 10 }),
				el('line', { x1: 14, y1: 10, x2: 14, y2: 10 }),
				el('line', { x1: 18, y1: 10, x2: 18, y2: 10 }),
				el('line', { x1: 7, y1: 14, x2: 17, y2: 14 }),
			];
		},
		flame() {
			return [el('path', { d: 'M12 2s4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3s-3 1-3 5a6 6 0 0 0 12 0c0-5-6-11-6-11z' })];
		},
	};

	const names = Object.keys(ICONS);

	function create(name, size, color, strokeWidth) {
		if (size === undefined) {
			size = 14;
		}
		if (color === undefined) {
			color = 'currentColor';
		}
		if (strokeWidth === undefined) {
			strokeWidth = 1.7;
		}

		let builder = ICONS[name];
		if (!builder) {
			return null;
		}

		let isFilledOnly = (name === 'dot');
		let svgAttrs = {
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: isFilledOnly ? undefined : 'none',
			stroke: isFilledOnly ? undefined : color,
			'stroke-width': isFilledOnly ? undefined : strokeWidth,
			'stroke-linecap': isFilledOnly ? undefined : 'round',
			'stroke-linejoin': isFilledOnly ? undefined : 'round',
		};

		return el('svg', svgAttrs, builder(color));
	}

	return { create, names };
})();
