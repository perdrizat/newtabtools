/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Raw-module-evaluation fidelity net (chrome-prep C3b incident, 2026-07-10).
 *
 * WHY THIS EXISTS: vite/vitest's module transform does NOT preserve ES-module
 * TDZ semantics for cyclic imports — a top-level read of a cycle import that
 * throws `ReferenceError: Cannot access 'X' before initialization` in real
 * Firefox (and raw Node) evaluates fine under the transform. Exactly that
 * class of bug shipped in chrome-prep C3b: the page's cyclic-import entry
 * file at the time (later dissolved into grid.js/cell.js/site.js/page.js in
 * chrome-prep C4c) gained a top-level `const … = newTabToolsImpl` read of
 * its newTab.js cycle import (a PAGE_MODULES.md Decision-3 violation), the
 * whole fast tier stayed green, and every one of the 32 E2E files failed
 * because page-main.js's module graph rejected before `Grid.init()` could
 * run.
 *
 * THE NET: spawn a real `node` child (no transform, no shell) that raw-
 * imports `webextension/page-main.js` (the page's single boot entry, so the
 * whole page graph loads) and report how evaluation ends. In bare Node the
 * graph CANNOT fully evaluate — page modules touch `chrome`/`browser`/
 * `document` at top level — so the ACCEPTABLE outcome is a ReferenceError
 * about those missing browser globals: it proves every module PARSED and
 * evaluation progressed into browser-API territory. What must NEVER appear:
 *   - a SyntaxError (a file no longer parses as a real ES module), or
 *   - a TDZ ReferenceError (`… before initialization` — a top-level read of
 *     a cycle import; the C3b incident class).
 *
 * E2E remains the full boot gate; this is the cheap, always-on early
 * tripwire for the transform-fidelity hole the fast tier cannot see.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '_fixtures', 'raw-import-page-graph.mjs');

describe('raw module evaluation — page graph loads without transform (C3b net)', () => {
	it('page-main.js raw-imports past parsing and cycle evaluation', () => {
		const result = spawnSync(process.execPath, [FIXTURE], {
			encoding: 'utf8',
			timeout: 30_000,
		});

		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);

		const line = result.stdout.trim().split('\n').pop() ?? '';
		const report = JSON.parse(line) as {
			outcome: string;
			name?: string;
			message?: string;
		};

		if (report.outcome === 'evaluated') {
			// Full evaluation in bare Node would be surprising (no browser
			// APIs) but is not a regression — the graph loaded end to end.
			return;
		}

		expect(report.outcome).toBe('error');

		// Structural failures — never acceptable.
		expect(report.name, `graph failed to parse: ${report.message}`)
			.not.toBe('SyntaxError');
		expect(report.message, 'TDZ violation: top-level read of a cycle import (PAGE_MODULES.md Decision 3)')
			.not.toMatch(/before initialization/);

		// The acceptable failure: evaluation reached browser-API territory.
		expect(report.name).toBe('ReferenceError');
		expect(report.message).toMatch(/\b(chrome|browser|document|window)\b/);
	});
});
