/* Spike (M1 Step 0): does the vendored zip.js build set globalThis.zip when
 * loaded via a native dynamic import() (as it will be from
 * webextension/lib/background-main.js)?
 *
 * First run (against the then-vendored single-file UMD build,
 * webextension/lib/zip.js — a dist/zip-core.min.js copy) FAILED: its UMD
 * wrapper's CommonJS/AMD/global-object detection doesn't reliably land on
 * globalThis.zip under the Vitest/vite-node module runner (its typeof
 * exports/module checks resolve differently than in a real browser's
 * native ES module loader). That failure is what pulled M4's ESM
 * re-vendoring forward into M1 — see scripts/update-zip.mjs and
 * webextension/lib/zip-global.js. This test now exercises the fix: real
 * `import`/`export` syntax has no such ambiguity.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZIP_GLOBAL_PATH = path.resolve(__dirname, '../../webextension/lib/zip-global.js');

describe('spike: zip vendoring is module-compatible', () => {
	it('lib/zip-global.js sets globalThis.zip after a native dynamic import()', async () => {
		delete (globalThis as any).zip;
		await import(/* @vite-ignore */ ZIP_GLOBAL_PATH);
		expect((globalThis as any).zip).toBeDefined();
		expect(typeof (globalThis as any).zip.ZipWriter).toBe('function');
		expect(typeof (globalThis as any).zip.ZipReader).toBe('function');
		expect(typeof (globalThis as any).zip.BlobReader).toBe('function');
		expect(typeof (globalThis as any).zip.BlobWriter).toBe('function');
		expect(typeof (globalThis as any).zip.TextReader).toBe('function');
		expect(typeof (globalThis as any).zip.TextWriter).toBe('function');
		expect(typeof (globalThis as any).zip.configure).toBe('function');
	});
});
