/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit coverage for the UAT runner's scenario verdict logic, extracted into
 * `tests/uat/_tools/report-verdict.mjs` so it is testable (runner.mjs itself
 * runs at module scope and can't be imported without side effects).
 *
 * Regression under test (2026-07-17): the runner read `report.assertions` /
 * `report.passed`, but scenario agents emit `structural_checks` /
 * `visual_checks` / `verdict`. So the report was invisible and the `claude -p`
 * process exit code alone decided pass/fail — a scenario that PASSED on its
 * merits but whose process died on an API 529 (or the --max-turns cap) got
 * marked failed (observed: 30-typography, verdict PASS + 7/7 checks, exit 1).
 */

import { describe, it, expect } from 'vitest';
import { parseReport, deriveVerdict, checkName } from '../uat/_tools/report-verdict.mjs';

describe('UAT report verdict', () => {
	describe('parseReport', () => {
		it('reads the verdict from a `verdict` string (case-insensitive)', () => {
			expect(parseReport({ verdict: 'PASS' }).reportPassed).toBe(true);
			expect(parseReport({ verdict: 'pass' }).reportPassed).toBe(true);
			expect(parseReport({ verdict: 'FAIL' }).reportPassed).toBe(false);
			expect(parseReport({ verdict: 'fail' }).reportPassed).toBe(false);
		});

		it('falls back to `passed`/`pass` booleans, else null', () => {
			expect(parseReport({ passed: true }).reportPassed).toBe(true);
			expect(parseReport({ pass: false }).reportPassed).toBe(false);
			expect(parseReport({}).reportPassed).toBeNull();
			expect(parseReport({ verdict: 'unknown' }).reportPassed).toBeNull();
		});

		it('collects failed checks across structural_checks and visual_checks', () => {
			const report = {
				verdict: 'PASS',
				structural_checks: [
					{ id: 1, name: 'a', pass: true },
					{ id: 2, name: 'b', pass: false },
				],
				visual_checks: [
					{ id: 'shot', judgment: 'looks off', pass: false },
				],
			};
			const failed = parseReport(report).failedAssertions;
			expect(failed).toHaveLength(2);
			// Structural checks label by `name`; visual checks by their `id` (the
			// concise screenshot handle) — `judgment` is prose shown as detail.
			expect(failed.map(checkName)).toEqual(['b', 'shot']);
		});

		it('accepts the legacy flat `assertions` shape too', () => {
			const report = { assertions: [{ name: 'x', passed: false }, { name: 'y', passed: true }] };
			expect(parseReport(report).failedAssertions).toHaveLength(1);
		});

		it('returns observations as strings, or empty when absent/wrong-typed', () => {
			expect(parseReport({ observations: ['a', 1] }).observations).toEqual(['a', '1']);
			expect(parseReport({ observations: 'nope' }).observations).toEqual([]);
			expect(parseReport({}).observations).toEqual([]);
		});
	});

	describe('deriveVerdict', () => {
		it('PASSES a report-PASS scenario even when the process crashed afterward (the 30-typography case)', () => {
			expect(deriveVerdict({ hasReport: true, reportPassed: true, failedAssertions: [], processOk: false })).toBe(true);
		});

		it('FAILS a report-FAIL scenario even when the process exited 0', () => {
			expect(deriveVerdict({ hasReport: true, reportPassed: false, failedAssertions: [], processOk: true })).toBe(false);
		});

		it('FAILS when the report has a failed check even if the top verdict is PASS', () => {
			expect(deriveVerdict({ hasReport: true, reportPassed: true, failedAssertions: [{ name: 'b' }], processOk: true })).toBe(false);
		});

		it('PASSES a report-PASS scenario with an undecided (null) top verdict and no failed checks', () => {
			expect(deriveVerdict({ hasReport: true, reportPassed: null, failedAssertions: [], processOk: true })).toBe(true);
		});

		it('with NO report, falls back to the process exit code', () => {
			// Agent crashed before reporting (the 01-default-ui max-turns case).
			expect(deriveVerdict({ hasReport: false, reportPassed: null, failedAssertions: [], processOk: false })).toBe(false);
			// No report but a clean exit — unchanged leniency.
			expect(deriveVerdict({ hasReport: false, reportPassed: null, failedAssertions: [], processOk: true })).toBe(true);
		});
	});

	describe('checkName', () => {
		it('prefers name, then id, then judgment, then selector, then a placeholder', () => {
			expect(checkName({ name: 'n', id: 'i' })).toBe('n');
			expect(checkName({ id: 'i' })).toBe('i');
			expect(checkName({ judgment: 'j' })).toBe('j');
			expect(checkName({ selector: '.s' })).toBe('.s');
			expect(checkName({})).toBe('(unnamed check)');
		});
	});
});
