/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The compat tier's pure logic, shared by run.mjs and the probe harness:
 * which <browser>-<channel> targets exist, how a probe failure is classified,
 * and how an actual capability matrix is diffed against the committed one.
 * Tested by tests/integration/compat-matrix.test.ts.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserProfile } from '../_browsers/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Browsers the compat tier has probes for (Chrome is PLAN.md step 5). */
export const COMPAT_BROWSERS = Object.freeze(['firefox']);

/**
 * ok: works. gated: refused with a known gate error (NOTEBOOK.md 1-2).
 * absent: never answered (timeout) or the event never arrived (NOTEBOOK.md 3).
 * error: any other failure.
 */
export const RESULTS = Object.freeze(['ok', 'gated', 'absent', 'error']);

/**
 * @typedef {{ browser: string, channel: string, name: string }} Target
 * @typedef {{ result: string, error?: string }} ProbeRow
 * @typedef {{ browser: string, channel: string, version: string, probes: Record<string, ProbeRow> }} Matrix
 */

/** @returns {Target[]} */
function allTargets() {
	return COMPAT_BROWSERS.flatMap(browser =>
		browserProfile(browser).channels.map(channel => ({ browser, channel, name: `${browser}-${channel}` })));
}

/**
 * @param {string[]} args `<browser>-<channel>` names; empty means all targets
 * @returns {Target[]}
 */
export function parseTargets(args) {
	const all = allTargets();
	if (!args.length) {
		return all;
	}
	return args.map(arg => {
		const target = all.find(t => t.name === arg);
		if (!target) {
			throw new Error(`unknown compat target "${arg}" — expected one of: ${all.map(t => t.name).join(', ')}`);
		}
		return target;
	});
}

/**
 * @param {string} message
 * @returns {'gated'|'absent'|'error'}
 */
export function classifyError(message) {
	if (/privileged scope|is not allowed in this context/.test(message)) {
		return 'gated';
	}
	if (/^absent:|timeout \d+ms|timed out/i.test(message)) {
		return 'absent';
	}
	return 'error';
}

/**
 * Probes whose result differs. Versions and error wording are ignored: the
 * result is the signal, the message is context for the notebook entry.
 * @param {Matrix | null} expected
 * @param {Matrix} actual
 * @returns {{ id: string, expected: string, actual: string }[]}
 */
export function diffMatrix(expected, actual) {
	const exp = expected?.probes ?? {};
	const ids = [...new Set([...Object.keys(exp), ...Object.keys(actual.probes)])];
	return ids
		.map(id => ({ id, expected: exp[id]?.result ?? 'missing', actual: actual.probes[id]?.result ?? 'missing' }))
		.filter(row => row.expected !== row.actual);
}

/**
 * @param {'expected'|'actual'} kind committed expectation, or this run's output
 * @param {string} name a target name
 */
export function matrixPath(kind, name) {
	const dir = kind === 'expected' ? 'tests/compat/expected' : 'tests/compat/_artifacts';
	return path.join(ROOT, dir, `${name}.json`);
}
