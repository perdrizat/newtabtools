// Driver commands on an extension page (NOTEBOOK.md section 2's matrix).
import fs from 'node:fs';
import path from 'node:path';
import type { Probe } from './types.ts';

export const probes: Probe[] = [
	{
		id: 'evaluate',
		description: 'page.evaluate (script.callFunction)',
		async run({ open }) {
			const page = await open();
			if (await page.evaluate(() => 1 + 1) !== 2) {
				throw new Error('wrong result');
			}
		},
	},
	{
		id: 'input-keyboard',
		description: 'page.keyboard (input.performActions)',
		async run({ open }) {
			const page = await open();
			await page.keyboard.press('Escape');
		},
	},
	{
		id: 'input-mouse',
		description: 'page.mouse (input.performActions)',
		async run({ open }) {
			const page = await open();
			await page.mouse.click(5, 5);
		},
	},
	{
		id: 'expose-function',
		description: 'page.exposeFunction',
		async run({ open }) {
			const page = await open();
			await page.exposeFunction('__nttProbeExposed', () => 1);
		},
	},
	{
		id: 'upload-file',
		description: 'ElementHandle.uploadFile (input.setFiles)',
		async run({ open, scratchDir }) {
			const page = await open();
			const file = path.join(scratchDir, 'upload-probe.txt');
			fs.writeFileSync(file, 'probe');
			// A probe-owned input, so no real change handler (restore, wallpaper) fires.
			await page.evaluate(() => {
				const input = document.createElement('input');
				input.type = 'file';
				input.id = 'ntt-probe-file';
				document.body.append(input);
			});
			const input = await page.$('#ntt-probe-file');
			await (input as unknown as { uploadFile(f: string): Promise<void> }).uploadFile(file);
			const count = await page.evaluate(() => (document.getElementById('ntt-probe-file') as HTMLInputElement).files?.length ?? 0);
			if (count !== 1) {
				throw new Error(`uploadFile resolved but the input holds ${count} files`);
			}
		},
	},
	{
		id: 'set-viewport',
		description: 'page.setViewport (browsingContext.setViewport)',
		async run({ open }) {
			const page = await open();
			await page.setViewport({ width: 800, height: 600 });
		},
	},
	{
		id: 'bring-to-front',
		description: 'page.bringToFront (browsingContext.activate)',
		async run({ open }) {
			const page = await open();
			await page.bringToFront();
		},
	},
	{
		id: 'screenshot',
		description: 'page.screenshot (browsingContext.captureScreenshot)',
		async run({ open }) {
			const page = await open();
			if (!(await page.screenshot()).length) {
				throw new Error('empty screenshot');
			}
		},
	},
	{
		id: 'print-pdf',
		description: 'page.pdf (browsingContext.print)',
		timeoutMs: 10_000,
		async run({ open }) {
			const page = await open();
			if (!(await page.pdf()).length) {
				throw new Error('empty pdf');
			}
		},
	},
	{
		id: 'dialog-accept',
		description: 'accepting an alert (browsingContext.handleUserPrompt)',
		timeoutMs: 8_000,
		async run({ open }) {
			const page = await open();
			const handled = new Promise<void>((resolve, reject) => {
				page.once('dialog', dialog => {
					dialog.accept().then(resolve, reject);
				});
			});
			await page.evaluate(() => {
				setTimeout(() => alert('probe'), 0);
			});
			await handled;
		},
	},
];
