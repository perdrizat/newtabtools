/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: backup/restore (zip pipeline) characterization.
 * Phase 1 slot 3 of the migration plan (MIGRATION.md).
 *
 * Loads the real `export.js` via `vm.runInThisContext` with mocked browser
 * APIs and a fake zip transport layer. Characterizes:
 *   - makeZip: what gets included, pref-key filtering, tile-image extraction
 *   - readZip: benign round-trip, view refresh, tile rehydration
 *   - readZip with malicious inputs: javascript: URLs in tiles (§2.1),
 *     unexpected pref keys (§2.5), HTML in tile titles
 *   - readZip edge cases: missing entries, empty zip
 *
 * E2E note: deferred for this slot. makeZip uses chrome.downloads.download
 * with saveAs:true (system dialog Puppeteer can't easily automate) and
 * readZip requires file-input injection. The Integration tests cover the
 * security-critical logic paths. A dedicated backup/restore E2E can be
 * added once the UI stabilizes in Phase 2.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORT_PATH = path.resolve(__dirname, '../../webextension/export.js');

// ---------------------------------------------------------------------------
// Mock zip transport layer
// ---------------------------------------------------------------------------

/** Entries captured during a makeZip call. */
type WrittenEntry = { filename: string; content: string | Blob };

/** Creates a mock zip entry for readZip tests. */
function mockZipEntry(filename: string, textContent?: string, blobContent?: Blob) {
	return {
		filename,
		getData: vi.fn(async () => {
			return textContent !== undefined ? textContent : blobContent;
		}),
	};
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('backup/restore — export.js (Phase 1 slot 3)', () => {
	let makeZip: () => Promise<unknown>;
	let readZip: (file: Blob) => Promise<void>;

	// Captured entries from makeZip
	let writtenEntries: WrittenEntry[];

	// Mocks
	let mockBackground: Record<string, ReturnType<typeof vi.fn>>;
	let mockTiles: Record<string, ReturnType<typeof vi.fn> | unknown>;
	let mockStorageLocal: Record<string, ReturnType<typeof vi.fn>>;
	let mockDownloads: Record<string, ReturnType<typeof vi.fn>>;

	beforeAll(() => {
		// --- Mock zip library (modern v2.x Promise-based API) ---
		writtenEntries = [];
		(globalThis as any).zip = {
			configure: vi.fn(),
			BlobReader: class { blob: unknown; constructor(b: unknown) { this.blob = b; } },
			BlobWriter: class {},
			TextReader: class { text: string; constructor(t: string) { this.text = t; } },
			TextWriter: class {},

			ZipWriter: class {
				add = vi.fn(async (filename: string, reader: any) => {
					const content = 'text' in reader ? reader.text : reader.blob;
					writtenEntries.push({ filename, content });
				});
				close = vi.fn(async () => new Blob(['mock-zip']));
				constructor() { writtenEntries.length = 0; }
			},

			ZipReader: class {
				getEntries = vi.fn(async () => [] as ReturnType<typeof mockZipEntry>[]);
			},
		};

		// --- Mock Background ---
		mockBackground = {
			getBackground: vi.fn().mockResolvedValue(null),
			setBackground: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).Background = mockBackground;

		// --- Mock Tiles ---
		mockTiles = {
			getAll: vi.fn().mockResolvedValue([]),
			clear: vi.fn().mockResolvedValue(undefined),
			putTile: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).Tiles = mockTiles;

		// --- Mock chrome.storage.local ---
		mockStorageLocal = {
			get: vi.fn((cb: Function) => cb({})),
			set: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage = { local: mockStorageLocal };

		// --- Mock chrome.downloads ---
		mockDownloads = {
			download: vi.fn((_opts: unknown, cb: Function) => cb(42)),
		};
		(globalThis as any).chrome.downloads = mockDownloads;

		// --- Mock chrome.extension.getViews ---
		if (!(globalThis as any).chrome.extension) {
			(globalThis as any).chrome.extension = {};
		}
		(globalThis as any).chrome.extension.getViews = vi.fn(() => []);

		// --- URL.createObjectURL ---
		if (typeof URL.createObjectURL !== 'function') {
			URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		}

		// Save the default ZipReader for restoration in beforeEach.
		DefaultZipReader = (globalThis as any).zip.ZipReader;

		// --- Load export.js ---
		const code = fs.readFileSync(EXPORT_PATH, 'utf8');
		vm.runInThisContext(code, { filename: 'export.js' });

		makeZip = (globalThis as any).makeZip;
		readZip = (globalThis as any).readZip;

		expect(makeZip).toBeTypeOf('function');
		expect(readZip).toBeTypeOf('function');
	});

	beforeEach(() => {
		writtenEntries.length = 0;
		(globalThis as any).zip.ZipReader = DefaultZipReader;
		mockBackground.getBackground.mockClear();
		mockBackground.setBackground.mockClear();
		(mockTiles.getAll as ReturnType<typeof vi.fn>).mockClear();
		(mockTiles.clear as ReturnType<typeof vi.fn>).mockClear();
		(mockTiles.putTile as ReturnType<typeof vi.fn>).mockClear();
		mockStorageLocal.get.mockClear();
		mockStorageLocal.set.mockClear();
		mockDownloads.download.mockClear();
	});

	// ======================== makeZip ========================

	describe('makeZip — export pipeline', () => {
		it('exports prefs.json with internal keys stripped', async () => {
			mockStorageLocal.get.mockImplementationOnce((cb: Function) => cb({
				theme: 'dark',
				rows: 4,
				columns: 5,
				thumbnailSize: 600,
				version: '2.0',
				versionLastUpdate: '2026-01-01',
				versionLastAck: '2026-01-01',
			}));

			await makeZip();

			const prefsEntry = writtenEntries.find(e => e.filename === 'prefs.json');
			expect(prefsEntry).toBeDefined();
			const prefs = JSON.parse(prefsEntry!.content as string);
			expect(prefs.theme).toBe('dark');
			expect(prefs.rows).toBe(4);
			expect(prefs.columns).toBe(5);
			// These internal keys must be stripped:
			expect(prefs).not.toHaveProperty('thumbnailSize');
			expect(prefs).not.toHaveProperty('version');
			expect(prefs).not.toHaveProperty('versionLastUpdate');
			expect(prefs).not.toHaveProperty('versionLastAck');
		});

		it('exports tiles.json with tile data', async () => {
			(mockTiles.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
				{ id: 1, url: 'https://a.com', title: 'A', position: 0 },
			]);

			await makeZip();

			const tilesEntry = writtenEntries.find(e => e.filename === 'tiles.json');
			expect(tilesEntry).toBeDefined();
			const tiles = JSON.parse(tilesEntry!.content as string);
			expect(tiles).toHaveLength(1);
			expect(tiles[0].url).toBe('https://a.com');
		});

		it('extracts tile images as separate tileImages/ entries', async () => {
			const imageBlob = new Blob(['img-data'], { type: 'image/png' });
			(mockTiles.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
				{ id: 7, url: 'https://b.com', title: 'B', position: 0, image: imageBlob },
			]);

			await makeZip();

			const imgEntry = writtenEntries.find(e => e.filename === 'tileImages/7.png');
			expect(imgEntry).toBeDefined();
			expect(imgEntry!.content).toBe(imageBlob);

			// Image should be removed from tiles.json (stored separately)
			const tilesEntry = writtenEntries.find(e => e.filename === 'tiles.json');
			const tiles = JSON.parse(tilesEntry!.content as string);
			expect(tiles[0]).not.toHaveProperty('image');
		});

		it('includes background entry when background exists', async () => {
			const bgBlob = new Blob(['bg-data']);
			mockBackground.getBackground.mockResolvedValueOnce(bgBlob);

			await makeZip();

			const bgEntry = writtenEntries.find(e => e.filename === 'background');
			expect(bgEntry).toBeDefined();
			expect(bgEntry!.content).toBe(bgBlob);
		});

		it('omits background entry when no background is set', async () => {
			mockBackground.getBackground.mockResolvedValueOnce(null);

			await makeZip();

			expect(writtenEntries.find(e => e.filename === 'background')).toBeUndefined();
		});

		it('triggers chrome.downloads.download', async () => {
			await makeZip();

			expect(mockDownloads.download).toHaveBeenCalledWith(
				expect.objectContaining({ filename: 'newtabtools.zip', saveAs: true }),
				expect.any(Function),
			);
		});
	});

	// ======================== readZip — benign ========================

	describe('readZip — benign restore', () => {
		it('restores prefs to chrome.storage.local', async () => {
			const prefs = { theme: 'dark', rows: 4 };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			expect(mockStorageLocal.set).toHaveBeenCalledWith(prefs);
		});

		it('clears existing tiles and stores new ones', async () => {
			const tiles = [
				{ id: 1, url: 'https://c.com', title: 'C', position: 0 },
				{ id: 2, url: 'https://d.com', title: 'D', position: 1 },
			];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			expect(mockTiles.clear).toHaveBeenCalled();
			expect(mockTiles.putTile).toHaveBeenCalledTimes(2);
			expect(mockTiles.putTile).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://c.com' }),
			);
			expect(mockTiles.putTile).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://d.com' }),
			);
		});

		it('rehydrates tile images from tileImages/ entries', async () => {
			const imgBlob = new Blob(['image-data']);
			const tiles = [{ id: 5, url: 'https://e.com', title: 'E', position: 0 }];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
				mockZipEntry('tileImages/5.png', undefined, imgBlob),
			]);

			await readZip(new Blob());

			expect(mockTiles.putTile).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://e.com', image: imgBlob }),
			);
		});

		it('restores background image', async () => {
			const bgBlob = new Blob(['bg-restore']);
			setupReader([
				mockZipEntry('background', undefined, bgBlob),
			]);

			await readZip(new Blob());

			expect(mockBackground.setBackground).toHaveBeenCalledWith(bgBlob);
		});
	});

	// ======================== readZip — malicious inputs (§2.1, §2.5) ========================

	describe('readZip — malicious inputs', () => {
		it('skips tiles with javascript: URLs at restore time (§2.1 fix)', async () => {
			const tiles = [
				{ id: 1, url: 'javascript:alert(document.cookie)', title: 'XSS', position: 0 },
			];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			// The malicious tile must be silently dropped — never stored.
			expect(mockTiles.putTile).not.toHaveBeenCalledWith(
				expect.objectContaining({ url: 'javascript:alert(document.cookie)' }),
			);
		});

		it('skips tiles with data: URLs at restore time (§2.1 fix)', async () => {
			const tiles = [
				{ id: 2, url: 'data:text/html,<h1>phish</h1>', title: 'Phish', position: 0 },
			];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			expect(mockTiles.putTile).not.toHaveBeenCalledWith(
				expect.objectContaining({ url: 'data:text/html,<h1>phish</h1>' }),
			);
		});

		it('strips unexpected pref keys at restore time (§2.5 fix)', async () => {
			const prefs = {
				theme: 'dark',
				evilKey: 'malicious-payload',
				__proto__: 'proto-pollution-attempt',
			};
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			// Only known pref keys pass through — unknown keys are stripped.
			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.theme).toBe('dark');
			expect(storedPrefs).not.toHaveProperty('evilKey');
			expect(storedPrefs).not.toHaveProperty('__proto__');
		});

		it('stores tiles with HTML in titles without sanitization', async () => {
			const tiles = [
				{ id: 3, url: 'https://legit.com', title: '<img src=x onerror=alert(1)>', position: 0 },
			];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			expect(mockTiles.putTile).toHaveBeenCalledWith(
				expect.objectContaining({ title: '<img src=x onerror=alert(1)>' }),
			);
		});
	});

	// ======================== readZip — edge cases ========================

	describe('readZip — edge cases', () => {
		it('returns early when tiles.json is missing', async () => {
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'light' })),
			]);

			await readZip(new Blob());

			// Prefs are still restored
			expect(mockStorageLocal.set).toHaveBeenCalled();
			// But tiles are not touched
			expect(mockTiles.clear).not.toHaveBeenCalled();
			expect(mockTiles.putTile).not.toHaveBeenCalled();
		});

		it('skips prefs restore when prefs.json is missing', async () => {
			const tiles = [{ id: 1, url: 'https://f.com', title: 'F', position: 0 }];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			expect(mockStorageLocal.set).not.toHaveBeenCalled();
			expect(mockTiles.putTile).toHaveBeenCalled();
		});

		it('skips background restore when background entry is missing', async () => {
			setupReader([]);

			await readZip(new Blob());

			expect(mockBackground.setBackground).not.toHaveBeenCalled();
		});

		it('handles empty tiles array', async () => {
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify([])),
			]);

			await readZip(new Blob());

			expect(mockTiles.clear).toHaveBeenCalled();
			expect(mockTiles.putTile).not.toHaveBeenCalled();
		});
	});

	// ======================== Helper ========================

	// Store the default ZipReader class for restoration.
	let DefaultZipReader: any;

	/** Configure the mock zip reader to return the given entries. */
	function setupReader(entries: ReturnType<typeof mockZipEntry>[]) {
		(globalThis as any).zip.ZipReader = class {
			getEntries = vi.fn(async () => entries);
		};
	}
});
