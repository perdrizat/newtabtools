/**
 * Compat tier probe harness (tests/compat/PLAN.md). Runs every probe against
 * the browser and channel `tests/compat/run.mjs` launched (through the E2E
 * runner, so the same hooks and port), and writes the capability matrix to
 * tests/compat/_artifacts/<browser>-<channel>.json. A probe's `it` passes
 * whatever the probe's result: the matrix is the output, and run.mjs diffs it
 * against tests/compat/expected/. Only a broken harness fails here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { BROWSER, connectToFirefox, openNewTab, waitForGridReady, type OpenNewTabOpts } from '../e2e/_helpers.ts';
import { classifyError, matrixPath } from './matrix.mjs';
import type { Probe } from './probes/types.ts';
import { probes as navigation } from './probes/navigation.probe.ts';
import { probes as commands } from './probes/commands.probe.ts';
import { probes as events } from './probes/events.probe.ts';

const PROBES: Probe[] = [...navigation, ...commands, ...events];
const TARGET = `${BROWSER.browser}-${BROWSER.channel}`;
const OUT = matrixPath('actual', TARGET);
const SCRATCH = path.dirname(OUT);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		p,
		new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms); }),
	]).finally(() => clearTimeout(timer));
}

describe(`compat probes: ${TARGET}`, () => {
	let browser: Browser;
	const matrix = {
		browser: BROWSER.browser,
		channel: BROWSER.channel,
		version: '',
		probes: {} as Record<string, { result: string, error?: string }>,
	};

	beforeAll(async () => {
		browser = await connectToFirefox();
		matrix.version = await browser.version();
		fs.mkdirSync(SCRATCH, { recursive: true });
	}, 60_000);

	afterAll(async () => {
		fs.writeFileSync(OUT, JSON.stringify(matrix, null, '\t') + '\n');
		console.log(`[compat] ${TARGET} (${matrix.version}) matrix written to ${OUT}`);
		await browser?.disconnect();
	});

	it.each(PROBES.map(p => [p.id, p] as const))('%s', async (_id, probe) => {
		const opened: Page[] = [];
		const ctx = {
			browser,
			scratchDir: SCRATCH,
			async open(opts?: OpenNewTabOpts) {
				const page = await openNewTab(browser, opts);
				opened.push(page);
				await waitForGridReady(page);
				return page;
			},
		};
		try {
			await withTimeout(probe.run(ctx), probe.timeoutMs ?? 5_000);
			matrix.probes[probe.id] = { result: 'ok' };
		} catch (e) {
			// Drop Firefox's appended RemoteError stack: it moves between versions.
			const error = String((e as Error)?.message ?? e).split('\n')[0].split(' RemoteError@')[0].slice(0, 200);
			matrix.probes[probe.id] = { result: classifyError(error), error };
		} finally {
			await Promise.all(opened.map(p => p.close().catch(() => {})));
		}
	}, 60_000);
});
