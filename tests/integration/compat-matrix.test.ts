/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `tests/compat/matrix.mjs`: the compat tier's pure logic. Which
 * browser-channel targets a run covers, how a probe failure is classified,
 * and how an actual capability matrix is diffed against the committed one.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
	COMPAT_BROWSERS,
	RESULTS,
	parseTargets,
	classifyError,
	diffMatrix,
	matrixPath,
} from '../compat/matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('parseTargets', () => {
	it('defaults to every channel of every compat browser', () => {
		expect(COMPAT_BROWSERS).toEqual(['firefox']);
		expect(parseTargets([])).toEqual([
			{ browser: 'firefox', channel: 'esr', name: 'firefox-esr' },
			{ browser: 'firefox', channel: 'release', name: 'firefox-release' },
		]);
	});

	it('takes <browser>-<channel> names', () => {
		expect(parseTargets(['firefox-release'])).toEqual([{ browser: 'firefox', channel: 'release', name: 'firefox-release' }]);
	});

	it('rejects an unknown channel, naming the valid targets', () => {
		expect(() => parseTargets(['firefox-beta'])).toThrow(/unknown compat target "firefox-beta".*firefox-esr, firefox-release/);
	});

	it('rejects a registered browser the compat tier has no probes for yet', () => {
		expect(() => parseTargets(['chrome-stable'])).toThrow(/unknown compat target "chrome-stable"/);
	});
});

describe('classifyError', () => {
	it('recognises the privileged-scope gate (NOTEBOOK.md section 2)', () => {
		expect(classifyError('Protocol error (input.setFiles): The command does not support browsing contexts in privileged scope')).toBe('gated');
	});

	it('recognises the content-scope navigation gate (NOTEBOOK.md section 1)', () => {
		expect(classifyError('Navigation to moz-extension://x/newTab.html is not allowed in this context')).toBe('gated');
	});

	it('treats a timeout or an undelivered event as absent', () => {
		expect(classifyError('timeout 5000ms')).toBe('absent');
		expect(classifyError('absent: no console event')).toBe('absent');
	});

	it('treats anything else as error', () => {
		expect(classifyError('TypeError: x is undefined')).toBe('error');
	});

	it('only ever returns a known result', () => {
		for (const msg of ['', 'timeout 1ms', 'privileged scope', 'boom']) {
			expect(RESULTS).toContain(classifyError(msg));
		}
	});
});

describe('diffMatrix', () => {
	const matrix = (probes: Record<string, string>) => ({
		browser: 'firefox', channel: 'esr', version: '153',
		probes: Object.fromEntries(Object.entries(probes).map(([id, result]) => [id, { result }])),
	});

	it('is empty when every result matches, whatever the versions or messages', () => {
		const actual = matrix({ a: 'ok', b: 'gated' });
		actual.version = '154';
		(actual.probes.b as any).error = 'a reworded message';
		expect(diffMatrix(matrix({ a: 'ok', b: 'gated' }), actual)).toEqual([]);
	});

	it('reports newly gated and newly working probes alike', () => {
		expect(diffMatrix(matrix({ a: 'ok', b: 'gated' }), matrix({ a: 'gated', b: 'ok' }))).toEqual([
			{ id: 'a', expected: 'ok', actual: 'gated' },
			{ id: 'b', expected: 'gated', actual: 'ok' },
		]);
	});

	it('reports probes missing from either side', () => {
		expect(diffMatrix(matrix({ a: 'ok' }), matrix({ b: 'ok' }))).toEqual([
			{ id: 'a', expected: 'ok', actual: 'missing' },
			{ id: 'b', expected: 'missing', actual: 'ok' },
		]);
	});

	it('treats a missing expected matrix as every probe new', () => {
		expect(diffMatrix(null, matrix({ a: 'ok' }))).toEqual([{ id: 'a', expected: 'missing', actual: 'ok' }]);
	});
});

describe('matrixPath', () => {
	it('keeps committed expectations and run output apart', () => {
		expect(matrixPath('expected', 'firefox-esr')).toBe(path.join(ROOT, 'tests/compat/expected/firefox-esr.json'));
		expect(matrixPath('actual', 'firefox-esr')).toBe(path.join(ROOT, 'tests/compat/_artifacts/firefox-esr.json'));
	});
});
