import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	connectToFirefox,
	openNewTab,
	waitForGridReady,
	waitForCondition,
	captureFailure,
	resetTestState,
} from './_helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal stored-format ZIP builder (no external dependency)
// ---------------------------------------------------------------------------
// The ZIP format for uncompressed ("stored") entries is well-specified and
// compact. Each entry needs: a local file header (30 + filename length bytes),
// the raw data, a central directory record (46 + filename length bytes), and
// a single end-of-central-directory record (22 bytes) at the tail.
//
// This is sufficient for the vendored zip.js library in the extension to parse.
// ---------------------------------------------------------------------------

/**
 * Build a valid ZIP file (stored / no compression) from an array of
 * { name: string, data: Buffer | string } entries.
 * Returns a Node.js Buffer containing the complete ZIP.
 */
function buildStoredZip(entries: {name: string, data: Buffer | string}[]) {
	const localHeaders = [];
	const centralRecords = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = Buffer.from(entry.name, 'utf8');
		const dataBytes = typeof entry.data === 'string'
			? Buffer.from(entry.data, 'utf8')
			: entry.data;

		// --- Local file header ---
		const local = Buffer.alloc(30 + nameBytes.length);
		local.writeUInt32LE(0x04034b50, 0);  // local file header signature
		local.writeUInt16LE(20, 4);           // version needed to extract (2.0)
		local.writeUInt16LE(0, 6);            // general purpose bit flag
		local.writeUInt16LE(0, 8);            // compression method: stored
		local.writeUInt16LE(0, 10);           // last mod file time
		local.writeUInt16LE(0, 12);           // last mod file date
		local.writeUInt32LE(crc32(dataBytes), 14); // CRC-32
		local.writeUInt32LE(dataBytes.length, 18); // compressed size
		local.writeUInt32LE(dataBytes.length, 22); // uncompressed size
		local.writeUInt16LE(nameBytes.length, 26); // file name length
		local.writeUInt16LE(0, 28);           // extra field length
		nameBytes.copy(local, 30);

		localHeaders.push(Buffer.concat([local, dataBytes]));

		// --- Central directory record ---
		const central = Buffer.alloc(46 + nameBytes.length);
		central.writeUInt32LE(0x02014b50, 0); // central directory file header signature
		central.writeUInt16LE(20, 4);          // version made by
		central.writeUInt16LE(20, 6);          // version needed to extract
		central.writeUInt16LE(0, 8);           // general purpose bit flag
		central.writeUInt16LE(0, 10);          // compression method: stored
		central.writeUInt16LE(0, 12);          // last mod file time
		central.writeUInt16LE(0, 14);          // last mod file date
		central.writeUInt32LE(crc32(dataBytes), 16); // CRC-32
		central.writeUInt32LE(dataBytes.length, 20); // compressed size
		central.writeUInt32LE(dataBytes.length, 24); // uncompressed size
		central.writeUInt16LE(nameBytes.length, 28); // file name length
		central.writeUInt16LE(0, 30);          // extra field length
		central.writeUInt16LE(0, 32);          // file comment length
		central.writeUInt16LE(0, 34);          // disk number start
		central.writeUInt16LE(0, 36);          // internal file attributes
		central.writeUInt32LE(0, 38);          // external file attributes
		central.writeUInt32LE(offset, 42);     // relative offset of local header
		nameBytes.copy(central, 46);

		centralRecords.push(central);
		offset += local.length + dataBytes.length;
	}

	// --- End of central directory record ---
	const centralDirData = Buffer.concat(centralRecords);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);          // end of central directory signature
	eocd.writeUInt16LE(0, 4);                    // number of this disk
	eocd.writeUInt16LE(0, 6);                    // disk where central directory starts
	eocd.writeUInt16LE(entries.length, 8);        // number of central directory records on this disk
	eocd.writeUInt16LE(entries.length, 10);       // total number of central directory records
	eocd.writeUInt32LE(centralDirData.length, 12); // size of central directory
	eocd.writeUInt32LE(offset, 16);               // offset of start of central directory
	eocd.writeUInt16LE(0, 20);                    // comment length

	return Buffer.concat([...localHeaders, centralDirData, eocd]);
}

/** CRC-32 (ISO 3309) — tiny table-driven implementation, no dependency. */
let crc32Table: Uint32Array | undefined;
function crc32(buf: Buffer): number {
	if (!crc32Table) {
		crc32Table = new Uint32Array(256);
		for (let i = 0; i < 256; i++) {
			let c = i;
			for (let j = 0; j < 8; j++) {
				c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
			}
			crc32Table[i] = c;
		}
	}
	let crc = 0xFFFFFFFF;
	for (let i = 0; i < buf.length; i++) {
		crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const RESTORE_TILES = [
	{ id: 101, url: 'https://restored-a.example.com/', title: 'Restored A', position: 0 },
	{ id: 102, url: 'https://restored-b.example.com/', title: 'Restored B', position: 1 },
];

const RESTORE_PREFS = { theme: 'dark', rows: 3 };

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('E2E: Backup/restore round-trip (Phase 1 slot 3)', () => {
	let browser: Browser;
	let zipFixturePath: string;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);

		// Build a ZIP fixture on disk for uploadFile
		const zipBuf = buildStoredZip([
			{ name: 'prefs.json', data: JSON.stringify(RESTORE_PREFS) },
			{ name: 'tiles.json', data: JSON.stringify(RESTORE_TILES) },
		]);
		zipFixturePath = path.join(__dirname, '_artifacts', 'restore-fixture.zip');
		fs.mkdirSync(path.dirname(zipFixturePath), { recursive: true });
		fs.writeFileSync(zipFixturePath, zipBuf);
	}, 60_000);

	afterAll(async () => {
		// Clean up fixture
		if (zipFixturePath && fs.existsSync(zipFixturePath)) {
			fs.unlinkSync(zipFixturePath);
		}
		if (browser) {
			await browser.disconnect();
		}
	});

	it('restores tiles from a zip file uploaded via the UI', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// 1. Open settings panel
			await page.evaluate(() => {
				document.getElementById('options-toggle')?.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// 2. Open the backup/restore section
			await page.evaluate(() => {
				document.getElementById('options-backup-restore')?.click();
			});
			await new Promise(r => setTimeout(r, 500));

			// 3. Upload the zip fixture into the file input
			const fileInput = await page.$('#options-restore-file') as import('puppeteer-core').ElementHandle<HTMLInputElement> | null;
			expect(fileInput).not.toBeNull();
			await fileInput!.uploadFile(zipFixturePath);

			// 4. Wait for the restore button to become enabled (change event)
			await waitForCondition(
				page,
				() => !(document.getElementById('options-restore') as HTMLInputElement | null)?.disabled,
				[],
				{ timeout: 5000, message: 'restore button did not enable after file upload' },
			);

			// 5. Click restore, then confirm the inline danger prompt (§7 — restore
			//    overwrites the setup, so it gates behind a Confirm/Cancel row).
			await page.evaluate(() => {
				document.getElementById('options-restore')?.click();
			});
			await waitForCondition(
				page,
				() => !(document.getElementById('options-restore-confirm-row') as HTMLElement | null)?.hidden,
				[],
				{ timeout: 5000, message: 'restore confirm row did not appear' },
			);
			await page.evaluate(() => {
				document.getElementById('options-restore-confirm')?.click();
			});

			// 6. Wait for tiles to appear — readZip clears tiles and re-adds them,
			//    then calls Updater.updateGrid on any open new tab views.
			await waitForCondition(
				page,
				(expectedUrl) => {
					const g = window.Grid;
					if (!g || !g.sites) {
						return false;
					}
					return g.sites.some((s: any) => s && s.url === expectedUrl);
				},
				[RESTORE_TILES[0].url],
				{ timeout: 15_000, message: 'restored tile did not appear in the grid' },
			);

			// 7. Verify both tiles are in the grid
			const gridState = await page.evaluate((urls) => {
				const g = window.Grid;
				if (!g || !g.sites) {
					return { hasGrid: false };
				}
				const found = urls.map(url => {
					const site = g.sites.find((s: any) => s && s.url === url);
					return site ? { url: site.url, title: site.title || '' } : null;
				});
				return { hasGrid: true, found };
			}, RESTORE_TILES.map(t => t.url));

			expect(gridState.hasGrid).toBe(true);
			expect(gridState.found![0]).toEqual(
				expect.objectContaining({ url: RESTORE_TILES[0].url }),
			);
			expect(gridState.found![1]).toEqual(
				expect.objectContaining({ url: RESTORE_TILES[1].url }),
			);
		} catch (e) {
			await captureFailure(page, 'backup-restore-upload');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('restored tiles persist across reload', async () => {
		// After the previous test restored tiles, verify they survive a reload
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await waitForCondition(
				page,
				(expectedUrl) => {
					const g = window.Grid;
					if (!g || !g.sites) {
						return false;
					}
					return g.sites.some((s: any) => s && s.url === expectedUrl);
				},
				[RESTORE_TILES[0].url],
				{ timeout: 15_000, message: 'restored tile did not persist after reload' },
			);

			const gridState = await page.evaluate((urls) => {
				const g = window.Grid;
				if (!g || !g.sites) {
					return { hasGrid: false };
				}
				const found = urls.map(url => {
					const site = g.sites.find((s: any) => s && s.url === url);
					return site ? { url: site.url } : null;
				});
				return { hasGrid: true, found };
			}, RESTORE_TILES.map(t => t.url));

			expect(gridState.hasGrid).toBe(true);
			expect(gridState.found![0]).not.toBeNull();
			expect(gridState.found![1]).not.toBeNull();
		} catch (e) {
			await captureFailure(page, 'backup-restore-persist');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
