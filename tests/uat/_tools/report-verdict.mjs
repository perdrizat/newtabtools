/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pure helpers for turning a scenario agent's report.json (already JSON-parsed)
 * plus the `claude -p` process exit into a pass/fail verdict. Extracted from
 * runner.mjs so this logic is unit-testable — runner.mjs runs at module scope
 * and can't be imported without side effects.
 *
 * Why it exists: the runner used to read `report.assertions` / `report.passed`,
 * but scenario agents emit `structural_checks` / `visual_checks` / `verdict`.
 * The mismatch made the report invisible, so the process exit code alone
 * decided pass/fail and a PASS scenario whose process died on an API 529 (or
 * the --max-turns cap) was marked failed. These helpers accept every shape a
 * report actually uses.
 */

/**
 * Extract the verdict-relevant fields from a parsed report object.
 * @param {Record<string, unknown>} report - an already-JSON-parsed report.
 * @returns {{ failedAssertions: Record<string, unknown>[], observations: string[], reportPassed: boolean | null }}
 */
export function parseReport(report) {
	// Collect per-check failures across every shape scenario reports emit: the
	// legacy flat `assertions`, and the current `structural_checks` /
	// `visual_checks`. A check failed if it carries an explicit false verdict;
	// accept both `passed` (documented) and `pass` (a common agent variant) so a
	// real failure can't slip through as a false green on a field-name drift.
	const checks = [report.assertions, report.structural_checks, report.visual_checks]
		.filter(Array.isArray)
		.flat();
	const failedAssertions = checks.filter(a => a && (a.passed === false || a.pass === false));

	// The report's own verdict, in any shape agents emit: a `verdict` string
	// ("PASS"/"FAIL", case-insensitive) or a `passed`/`pass` boolean. null when
	// the report states no decisive verdict.
	let reportPassed = null;
	if (typeof report.verdict === 'string') {
		const v = report.verdict.trim();
		if (/^pass$/i.test(v)) { reportPassed = true; }
		else if (/^fail$/i.test(v)) { reportPassed = false; }
	} else if (typeof report.passed === 'boolean') {
		reportPassed = report.passed;
	} else if (typeof report.pass === 'boolean') {
		reportPassed = report.pass;
	}

	return {
		failedAssertions,
		observations: Array.isArray(report.observations) ? report.observations.map(String) : [],
		reportPassed,
	};
}

/**
 * Decide a scenario's pass/fail. The agent's report is authoritative when
 * present: gate on its verdict + per-check failures and IGNORE a non-zero
 * process exit (the agent can finish the assessment, write a PASS report, then
 * have the process die on an API 529 or the --max-turns cap during wind-down).
 * Only when no usable report exists do we fall back to the process exit code —
 * a crash before reporting is an unverifiable scenario, so the exit is the best
 * signal we have.
 * @param {{ hasReport: boolean, reportPassed: boolean | null, failedAssertions: unknown[], processOk: boolean }} args
 * @returns {boolean}
 */
export function deriveVerdict({ hasReport, reportPassed, failedAssertions, processOk }) {
	if (hasReport) {
		return reportPassed !== false && failedAssertions.length === 0;
	}
	return processOk;
}

/**
 * Human-readable name for a failed check across the differing report shapes
 * (structural checks carry `name`, visual checks carry `judgment`, etc.).
 * @param {Record<string, unknown>} a
 * @returns {string}
 */
export function checkName(a) {
	return /** @type {string} */ (a.name || a.id || a.judgment || a.selector || '(unnamed check)');
}
