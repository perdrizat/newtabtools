/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Self-closed non-void tag lint — MODERNIZATION.md Stage H2, audit
 * 2026-07-09-modernization-h-code-review.md #2.
 *
 * Under XHTML (the pre-Stage-H2 parser) `<span ... />` legitimately
 * self-closes. Under HTML5 (`newTab.html`, landed in Stage H2) the `/` is
 * ignored for any element that isn't in the void-elements list — the tag
 * stays open and silently swallows every following sibling as a descendant
 * instead. jsdom parses this exactly the same "wrong" way Firefox does
 * (parser agreement, not detection), so no behavioral test run against the
 * fast tier — or even against a real browser via E2E, since the DOM it
 * inspects is *already* the mis-nested one — can distinguish "correctly
 * shaped markup" from "markup that happens to still render something". A
 * structural, source-level check is the only deterministic net for this bug
 * class: it is the sole test in the suite that looks at `newTab.html` as
 * *text* rather than as a parsed tree, which is the only vantage point from
 * which the bug is visible at all.
 *
 * This complements (does not replace) the per-template structural-parity
 * invariant in tests/integration/tile-redesign.test.ts, which independently
 * proves that a self-closed non-void tag actually mis-nests — this test is
 * the cheap, whole-file, commit-time net that catches the tag anywhere in
 * `newTab.html`, including markup outside any `<template>`.
 */

import { describe, it, expect } from 'vitest';
import { readNewTabHtml } from '../integration/_helpers';

// Elements HTML5 defines as void: NOT closed by a following sibling tag, so
// `<tag ... />` and `<tag ...>` are equivalent for these — self-closing them
// is not the Stage H2 bug.
const VOID_ELEMENTS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'source', 'track', 'wbr',
]);

interface SelfClosedFinding {
	tag: string;
	index: number;
}

/**
 * Scans `html` for `<tag ... />`-style self-closing tags on non-void HTML
 * elements, outside any `<svg>...</svg>` subtree (SVG content is real XML —
 * self-closing there is valid and unrelated to the HTML5 parser trap).
 *
 * Takes the already-read markup string — `readNewTabHtml()` (imported above)
 * is the one place that reads `newTab.html` off disk and carries its own
 * `ntt/no-source-grep` justification; see the file-level docstring above for
 * why a behavioral test cannot substitute for this structural check.
 */
function findSelfClosedNonVoidTags(html: string): SelfClosedFinding[] {
	const findings: SelfClosedFinding[] = [];
	// Matches an opening tag (not a closing `</tag>`) that ends in `.../>`.
	const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\/>/g;
	// Tracks whether `index` falls inside an <svg>...</svg> region.
	const svgRegionRe = /<svg\b[^>]*>[\s\S]*?<\/svg>/g;
	const svgRegions: Array<[number, number]> = [];
	let svgMatch: RegExpExecArray | null;
	while ((svgMatch = svgRegionRe.exec(html))) {
		svgRegions.push([svgMatch.index, svgMatch.index + svgMatch[0].length]);
	}
	function inSvgRegion(index: number): boolean {
		return svgRegions.some(([start, end]) => index >= start && index < end);
	}

	let m: RegExpExecArray | null;
	while ((m = tagRe.exec(html))) {
		const tag = m[1].toLowerCase();
		if (VOID_ELEMENTS.has(tag)) { continue; }
		if (inSvgRegion(m.index)) { continue; }
		findings.push({ tag, index: m.index });
	}
	return findings;
}

describe('findSelfClosedNonVoidTags — detection self-test (proves the checker is not a tautology)', () => {
	it('flags a self-closed non-void tag (e.g. a stray <span/>)', () => {
		const fixture = '<!DOCTYPE html><html><body><div><span class="a" /></div></body></html>';
		const findings = findSelfClosedNonVoidTags(fixture);
		expect(findings).toHaveLength(1);
		expect(findings[0].tag).toBe('span');
	});

	it('does not flag void elements self-closing (e.g. <input/>, <br/>)', () => {
		const fixture = '<!DOCTYPE html><html><body><input type="text"/><br/></body></html>';
		expect(findSelfClosedNonVoidTags(fixture)).toHaveLength(0);
	});

	it('does not flag a properly closed non-void tag', () => {
		const fixture = '<!DOCTYPE html><html><body><span class="a"></span></body></html>';
		expect(findSelfClosedNonVoidTags(fixture)).toHaveLength(0);
	});

	it('does not flag a self-closed non-void tag inside an <svg> subtree (valid XML content)', () => {
		const fixture = '<!DOCTYPE html><html><body><svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="#f0f" stroke-width="4" /></svg></body></html>';
		expect(findSelfClosedNonVoidTags(fixture)).toHaveLength(0);
	});

	it('still flags a self-closed non-void tag OUTSIDE an <svg> even when one is present elsewhere', () => {
		const fixture = '<!DOCTYPE html><html><body><svg><path d="M0 0" /></svg><span class="a" /></body></html>';
		const findings = findSelfClosedNonVoidTags(fixture);
		expect(findings).toHaveLength(1);
		expect(findings[0].tag).toBe('span');
	});
});

describe('newTab.html — no self-closed non-void tags (Stage H2 regression net)', () => {
	it('contains zero self-closed non-void tags outside <svg>', () => {
		const html = readNewTabHtml();
		const findings = findSelfClosedNonVoidTags(html);
		expect(
			findings,
			`self-closed non-void tag(s) found: ${findings.map(f => `<${f.tag}/> at offset ${f.index}`).join(', ')} — ` +
			'under HTML5 the "/" is ignored on these, so the tag stays open and silently swallows its following siblings as descendants',
		).toEqual([]);
	});
});
