import type { Browser, Page } from 'puppeteer-core';
import type { OpenNewTabOpts } from '../../e2e/_helpers.ts';

export interface ProbeContext {
	browser: Browser;
	/** A fresh new-tab page with its grid ready; the harness closes it after the probe. */
	open(opts?: OpenNewTabOpts): Promise<Page>;
	/** Scratch dir for fixture files (tests/compat/_artifacts). */
	scratchDir: string;
}

/**
 * One driver capability. `run` resolves when the capability works and throws
 * otherwise; the harness classifies the error (matrix.mjs `classifyError`).
 * Throw `absent: ...` for an event that never arrived.
 */
export interface Probe {
	id: string;
	description: string;
	/** Default 5000. */
	timeoutMs?: number;
	run(ctx: ProbeContext): Promise<void>;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
