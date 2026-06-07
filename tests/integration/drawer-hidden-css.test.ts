/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Regression test: the `[hidden]` HTML attribute must actually hide
 * titlebar/statusbar elements when their `titleBar*` pref is false.
 *
 * The bug: `#ntt-wordmark { display: flex }` (ID selector) outranks the
 * UA `[hidden] { display: none }` rule by CSS specificity, so setting
 * `el.hidden = true` left the wordmark visible. Same for `#ntt-search`,
 * `#ntt-clock`, `#ntt-statusbar`, `.ntt-titlebar-divider`. The fix is an
 * explicit `[hidden]` override at higher specificity.
 *
 * We grep the stylesheet rather than read it through jsdom's CSSOM because
 * jsdom's computed-style emulation does not reliably resolve `display:none`
 * via attribute selectors, which would mask this regression.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

describe('Titlebar [hidden] overrides — display:none must win over display:flex', () => {
	let css: string;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- wiring check: critical [hidden] override
		css = fs.readFileSync(CSS_PATH, 'utf8');
	});

	// `#ntt-titlebar-recent` is intentionally absent: it is the greedy spacer
	// that pins the masthead to the right edge, so it must stay laid out even
	// when it holds no cards — refreshRecent empties it rather than hiding it,
	// so it has no `[hidden]` override on purpose. `#ntt-statusbar` is also
	// absent — the status bar was deleted in Phase 5-1.
	const elements = [
		'#ntt-search',
	];

	for (const sel of elements) {
		it(`${sel}[hidden] is forced to display:none`, () => {
			// Either a dedicated `${sel}[hidden] { display: none }` rule,
			// or a group selector including it followed by display:none.
			// We tolerate any whitespace between selector and the block.
			const escaped = sel.replace(/[.#]/g, m => '\\' + m);
			// Match either:
			//   1. `#sel[hidden]` followed (after optional commas/other
			//      selectors and whitespace) by a `{` block containing
			//      `display: none`.
			const pattern = new RegExp(
				`${escaped}\\[hidden\\][^{]*\\{[^}]*display:\\s*none`,
				'm'
			);
			expect(css).toMatch(pattern);
		});
	}
});
