import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import {
	connectToFirefox,
	getNewTabURL,
	openNewTab,
	waitForGridReady,
	resetTestState,
	ARTIFACTS_DIR,
} from './_helpers.ts';

// Permanent boot-timing instrument for the "page modules" arc: converting
// the eight classic <script> tags in newTab.html to a single
// `<script type="module">` entry defers module execution relative to first
// paint. This test logs comparable before/after numbers so the delta from
// that flip can be recorded — it is not a perf gate (assertions below are
// deliberately generous), just a stable, grep-able measurement.

const ITERATIONS = 3;
const TEST_URL = 'https://boot-timing-test.example.com/';

interface IterationResult {
	firstTileSeen: number | null;
	domInteractive: number | null;
	domContentLoadedEventEnd: number | null;
	fcp: number | null;
}

/**
 * Median of the finite values in `values`, ignoring null/non-finite entries.
 * Returns null if none are finite.
 */
function median(values: (number | null)[]): number | null {
	const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
	if (finite.length === 0) {
		return null;
	}
	const sorted = [...finite].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Formats one grep-able summary line, e.g.:
 *   [boot-timing] firstTile ms: 312, 298, 305 (median 305)
 * Missing (null) samples are logged as `n/a`.
 */
function formatLine(label: string, values: (number | null)[]): string {
	const parts = values.map(v => (v === null ? 'n/a' : Math.round(v).toString()));
	const m = median(values);
	const medianStr = m === null ? 'n/a' : Math.round(m).toString();
	return `[boot-timing] ${label} ms: ${parts.join(', ')} (median ${medianStr})`;
}

/**
 * Opens a fresh page, navigates to the new-tab URL, and collects boot
 * metrics. Always closes the page, even on failure.
 *
 * `firstTileSeen` is measured by polling from the harness:
 * `page.waitForFunction` is CSP-blocked on moz-extension:// pages, BiDi
 * preload scripts don't apply to them (so a document-start MutationObserver
 * is not an option), and `page.goto` never resolves before its timeout on
 * them (the known BiDi quirk `openNewTab` documents) — so the goto is fired
 * WITHOUT awaiting and polling starts immediately. Each poll runs in-page
 * and records `performance.now()` the first time it sees a rendered tile:
 * page-clock time, ±POLL_INTERVAL_MS accuracy — coarse, but the defer-shift
 * this instrument watches for is only user-visible at far larger magnitudes.
 * Polls that race the navigation commit (context destroyed, or evaluating in
 * the initial about:blank) are tolerated and retried; a mark written to a
 * pre-commit window is simply discarded with that window.
 */
const POLL_INTERVAL_MS = 25;

async function runIteration(browser: Browser, url: string): Promise<IterationResult> {
	const page: Page = await browser.newPage();

	try {
		const nav = page.goto(url, { waitUntil: 'domcontentloaded', timeout: 3_000 })
			.catch(() => { /* always times out on moz-extension:// (BiDi issue) */ });

		const deadline = Date.now() + 15_000;
		let tileSeen = false;
		while (Date.now() < deadline && !tileSeen) {
			try {
				tileSeen = Boolean(await page.evaluate(() => {
					const w = window as unknown as { __nttFirstTileSeen?: number };
					if (w.__nttFirstTileSeen === undefined &&
						document.querySelector('#newtab-grid .newtab-site')) {
						w.__nttFirstTileSeen = performance.now();
					}
					return w.__nttFirstTileSeen !== undefined;
				}));
			} catch {
				// Evaluate raced the navigation commit — retry next tick.
			}
			if (!tileSeen) {
				await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
			}
		}
		// tileSeen === false is tolerated: the metric degrades to n/a and the
		// navigation-entry metrics below are still collected.
		await nav;
		await waitForGridReady(page);

		return await page.evaluate(() => {
			const w = window as unknown as { __nttFirstTileSeen?: number };
			const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
			const paintEntries = performance.getEntriesByType('paint');
			const fcpEntry = paintEntries.find(p => p.name === 'first-contentful-paint');
			return {
				firstTileSeen: typeof w.__nttFirstTileSeen === 'number' ? w.__nttFirstTileSeen : null,
				domInteractive: nav ? nav.domInteractive : null,
				domContentLoadedEventEnd: nav ? nav.domContentLoadedEventEnd : null,
				fcp: fcpEntry ? fcpEntry.startTime : null,
			};
		});
	} finally {
		await page.close();
	}
}

describe('boot timing', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);

		// Pin a tile so the grid reliably renders at least one `.newtab-site`
		// on every fresh load — without this, an empty-history profile could
		// leave firstTile permanently unset across all iterations.
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		await page.evaluate((u) => {
			return new Promise(resolve => {
				chrome.runtime.sendMessage({
					name: 'Tiles.pinTile',
					title: 'Boot Timing Test',
					url: u,
				}, resolve);
			});
		}, TEST_URL);
		await page.close();
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			// Clears the pinned timing tile (and resets prefs) so later suites
			// start hermetic. Note `Tiles.removeTile` on the wire takes a tile
			// *object*, not a url — the combined reset helper is simpler here.
			await resetTestState(browser);
			await browser.disconnect();
		}
	});

	it('logs comparable boot-timing metrics across fresh loads', async () => {
		const url = await getNewTabURL();
		const results: IterationResult[] = [];

		for (let i = 0; i < ITERATIONS; i++) {
			results.push(await runIteration(browser, url));
		}

		const lines = [
			formatLine('firstTileSeen', results.map(r => r.firstTileSeen)),
			formatLine('domInteractive', results.map(r => r.domInteractive)),
			formatLine('domContentLoadedEventEnd', results.map(r => r.domContentLoadedEventEnd)),
			formatLine('fcp', results.map(r => r.fcp)),
		];
		for (const line of lines) {
			console.log(line);
		}
		// The default vitest reporter can buffer/hide console output, so the
		// instrument also persists its numbers where the arc's before/after
		// comparison can always read them (the artifacts dir survives until the
		// next run's cleanup).
		fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
		fs.writeFileSync(path.join(ARTIFACTS_DIR, 'boot-timing.txt'), lines.join('\n') + '\n');

		// Deliberately generous: this is an instrument, not a perf gate. Prefer
		// the firstTileSeen median; fall back to domContentLoadedEventEnd if no
		// tile ever rendered.
		const firstTileMedian = median(results.map(r => r.firstTileSeen));
		const fallbackMedian = median(results.map(r => r.domContentLoadedEventEnd));
		const primaryMetric = firstTileMedian !== null ? firstTileMedian : fallbackMedian;

		expect(primaryMetric).not.toBeNull();
		expect(Number.isFinite(primaryMetric as number)).toBe(true);
		expect(primaryMetric as number).toBeGreaterThan(0);
		expect(primaryMetric as number).toBeLessThan(15_000);
	}, 120_000);
});
