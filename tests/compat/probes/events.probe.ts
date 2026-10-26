// Events the driver should deliver from an extension page (NOTEBOOK.md section 3).
import type { Page } from 'puppeteer-core';
import { type Probe, sleep } from './types.ts';

/** Open a page with `event` recorded from before navigation, trigger it, and require delivery. */
function eventProbe(id: string, description: string, event: 'console' | 'pageerror' | 'request',
	trigger: (page: Page) => Promise<unknown>, matches: (payload: unknown) => boolean): Probe {
	return {
		id,
		description,
		async run({ open }) {
			const seen: unknown[] = [];
			const page = await open({ beforeNavigate: p => { p.on(event, (payload: unknown) => seen.push(payload)); } });
			await trigger(page);
			await sleep(1_500);
			if (!seen.some(matches)) {
				throw new Error(`absent: no ${event} event (${seen.length} others)`);
			}
		},
	};
}

export const probes: Probe[] = [
	eventProbe('console-event', 'console.error reaches page.on("console")', 'console',
		page => page.evaluate(() => console.error('ntt-probe-console')),
		msg => (msg as { text(): string }).text().includes('ntt-probe-console')),
	eventProbe('pageerror-event', 'an uncaught exception reaches page.on("pageerror")', 'pageerror',
		page => page.evaluate(() => {
			setTimeout(() => { throw new Error('ntt-probe-throw'); }, 0);
		}),
		err => String((err as Error)?.message ?? err).includes('ntt-probe-throw')),
	// Fetches the extension's own page, so the CSP's connect-src cannot be the reason it is missing.
	eventProbe('request-event', 'an in-page fetch reaches page.on("request")', 'request',
		page => page.evaluate(() => fetch('newTab.html?ntt-probe=1').catch(() => {})),
		req => (req as { url(): string }).url().includes('ntt-probe=1')),
];
