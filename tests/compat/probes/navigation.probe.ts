// Session setup and getting onto an extension page (NOTEBOOK.md sections 1 and 3).
import { getNewTabURL, gotoExtensionPage, waitForGridReady } from '../../e2e/_helpers.ts';
import { type Probe, sleep } from './types.ts';

export const probes: Probe[] = [
	{
		// The harness's own connect proves the port is up (the check the retired
		// probe_bidi.sh made). A second session is no test: Firefox BiDi allows one.
		id: 'session-connect',
		description: 'the driver session is connected and answers',
		async run({ browser }) {
			if (!browser.connected || !(await browser.version())) {
				throw new Error('session not answering');
			}
		},
	},
	{
		id: 'navigate-extension-page',
		description: 'a driven goto to the extension page is allowed (system access)',
		timeoutMs: 15_000,
		async run({ browser }) {
			const page = await browser.newPage();
			try {
				const url = await getNewTabURL();
				// The goto itself never resolves on Firefox (section 3), so only a
				// gate error counts; then the document must actually load.
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 3_000 }).catch((e: Error) => {
					if (!/timeout/i.test(e.message)) {
						throw e;
					}
				});
				await waitForGridReady(page, 8_000);
			} finally {
				await page.close().catch(() => {});
			}
		},
	},
	{
		id: 'goto-resolves',
		description: 'page.goto resolves for the extension page (browsingContext load events)',
		async run({ browser }) {
			const page = await browser.newPage();
			try {
				await page.goto(await getNewTabURL(), { waitUntil: 'domcontentloaded', timeout: 3_000 }).catch((e: Error) => {
					throw new Error(/timeout/i.test(e.message) ? 'absent: goto never resolved' : e.message);
				});
			} finally {
				await page.close().catch(() => {});
			}
		},
	},
	{
		id: 'reload',
		description: 'page.reload resolves on the extension page',
		async run({ open }) {
			const page = await open();
			await page.reload({ waitUntil: 'domcontentloaded', timeout: 3_000 }).catch((e: Error) => {
				throw new Error(/timeout/i.test(e.message) ? 'absent: reload never resolved' : e.message);
			});
		},
	},
	{
		id: 'pages-lists-extension-page',
		description: 'browser.pages() includes an open extension page',
		async run({ browser, open }) {
			await open();
			// page.url() itself can lag on Firefox (no load events), so match the origin.
			const origin = (await getNewTabURL()).split('/newTab.html')[0];
			const listed = (await browser.pages()).some(p => p.url().startsWith(origin));
			if (!listed) {
				throw new Error('absent: extension page not listed');
			}
		},
	},
	{
		id: 'preload-script-runs',
		description: 'evaluateOnNewDocument (script.addPreloadScript) registers and runs on the next extension document',
		timeoutMs: 20_000,
		async run({ open }) {
			const page = await open();
			await page.evaluateOnNewDocument(() => {
				(window as unknown as { __nttPreload?: number }).__nttPreload = 1;
			});
			await gotoExtensionPage(page, await getNewTabURL());
			await sleep(200);
			const ran = await page.evaluate(() => (window as unknown as { __nttPreload?: number }).__nttPreload === 1);
			if (!ran) {
				throw new Error('absent: preload script registered but did not run');
			}
		},
	},
];
