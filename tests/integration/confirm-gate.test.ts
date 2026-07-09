/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Audit 2026-06-10 §8.7.3 — deterministic coverage for the Reset confirm gate.
 *
 * The Restore gate's click→reveal→confirm chain is covered end-to-end in
 * `tests/e2e/backup-restore.test.ts`; the Reset side was UAT-only (scenario
 * 22-advanced-tab). This closes that residue at the integration tier by
 * driving the REAL `optionsOnClick` dispatcher (extracted from newTab.js)
 * with real DOM click events:
 *
 *   - clicking Reset must NOT reset — it reveals the inline Confirm row (§7)
 *   - Confirm hides the row and fires `resetAllSettings` exactly once
 *   - Cancel hides the row and never fires the action
 *
 * Characterization tests of existing legacy behaviour (TESTING.md: the
 * watch-it-fail rule's explicit exception) — they pin the §7 gate so a
 * future rewiring of `optionsOnClick` can't silently drop it.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWTAB_PATH = path.resolve(__dirname, '../../webextension/newTab.js');

function extractMethod(source: string, methodName: string): string {
	const sigPattern = new RegExp(`^\\t(?:async\\s+)?${methodName}[\\(\\s]`, 'm');
	const match = source.match(sigPattern);
	if (!match || match.index === undefined) { throw new Error(`${methodName} not found`); }
	let depth = 0;
	const start = match.index;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') { depth--; if (depth === 0) { return source.substring(start, i + 1); } }
	}
	throw new Error('Unbalanced braces');
}

describe('Reset confirm gate — optionsOnClick (§7 inline Confirm/Cancel)', () => {
	let harness: any;

	beforeAll(() => {
		// eslint-disable-next-line ntt/no-source-grep -- loading the real dispatcher for behavioral test
		const source = fs.readFileSync(NEWTAB_PATH, 'utf8');
		const onClick = extractMethod(source, 'optionsOnClick');
		const show = extractMethod(source, '_showConfirm');
		const hide = extractMethod(source, '_hideConfirm');
		const code = `var _gateHarness = { ${onClick}, ${show}, ${hide} };`;
		vm.runInThisContext(code, { filename: 'confirm-gate-harness.js' });
		harness = (globalThis as any)._gateHarness;
	});

	beforeEach(() => {
		// The Advanced-tab reset group, as in newTab.html: trigger button +
		// the initially-hidden inline confirm row.
		document.body.innerHTML = `
			<div id="options-reset-group">
				<button id="options-reset-all"></button>
				<div class="options-row ntt-confirm-row" id="options-reset-confirm-row" hidden="">
					<button id="options-reset-confirm" class="ntt-btn-danger"></button>
					<button id="options-reset-cancel"></button>
				</div>
			</div>
		`;
		harness.resetAllSettings = vi.fn();
		// Production delegates container clicks into optionsOnClick; mirror that.
		document.getElementById('options-reset-group')!
			.addEventListener('click', e => harness.optionsOnClick(e));
	});

	function row(): HTMLElement {
		return document.getElementById('options-reset-confirm-row') as HTMLElement;
	}

	it('clicking Reset reveals the Confirm row and does NOT reset', () => {
		expect(row().hidden).toBe(true);
		(document.getElementById('options-reset-all') as HTMLElement).click();
		expect(row().hidden).toBe(false);
		expect(harness.resetAllSettings).not.toHaveBeenCalled();
	});

	it('clicking Confirm hides the row and fires resetAllSettings exactly once', () => {
		(document.getElementById('options-reset-all') as HTMLElement).click();
		(document.getElementById('options-reset-confirm') as HTMLElement).click();
		expect(row().hidden).toBe(true);
		expect(harness.resetAllSettings).toHaveBeenCalledTimes(1);
	});

	it('clicking Cancel hides the row without ever firing the action', () => {
		(document.getElementById('options-reset-all') as HTMLElement).click();
		(document.getElementById('options-reset-cancel') as HTMLElement).click();
		expect(row().hidden).toBe(true);
		expect(harness.resetAllSettings).not.toHaveBeenCalled();
	});

	it('a disabled trigger is ignored (no reveal)', () => {
		const trigger = document.getElementById('options-reset-all') as HTMLButtonElement;
		trigger.disabled = true;
		harness.optionsOnClick({ target: trigger });
		expect(row().hidden).toBe(true);
	});
});
