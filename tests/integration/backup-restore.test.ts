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
 *   - readZip: benign round-trip, restore-complete broadcast, tile rehydration
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
	let mockDownloads: {
		download: ReturnType<typeof vi.fn>;
		onChanged: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> } | undefined;
	};
	let mockPurgeNeverCaptureHost: ReturnType<typeof vi.fn>;

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
			get: vi.fn().mockResolvedValue({}),
			set: vi.fn().mockResolvedValue(undefined),
		};
		(globalThis as any).chrome.storage = { local: mockStorageLocal };

		// --- Mock chrome.downloads ---
		mockDownloads = {
			download: vi.fn().mockResolvedValue(42),
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		};
		(globalThis as any).chrome.downloads = mockDownloads;

		// --- URL.createObjectURL ---
		if (typeof URL.createObjectURL !== 'function') {
			URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		}

		// --- Stub Filters (prefs.js is not loaded by the harness) ---
		(globalThis as any).Filters = {
			normalizeHost(input: unknown): string {
				let s = String(input == null ? '' : input).trim();
				if (!s) { return ''; }
				if (/:\/\//.test(s)) {
					try { s = new URL(s).host; } catch (e) { /* fall through */ }
				}
				s = s.toLowerCase().replace(/^\*\./, '.').replace(/\/.*$/, '');
				const lead = s.startsWith('.') ? '.' : '';
				return lead + s.replace(/^\.+/, '').replace(/\.+$/, '');
			},
		};

		// --- Stub purgeNeverCaptureHost (background.js is the real owner) ---
		mockPurgeNeverCaptureHost = vi.fn().mockResolvedValue({ thumbnails: 0, tiles: 0 });
		(globalThis as any).purgeNeverCaptureHost = mockPurgeNeverCaptureHost;

		// Save the default ZipReader for restoration in beforeEach.
		DefaultZipReader = (globalThis as any).zip.ZipReader;

		// --- Load export.js ---
		// eslint-disable-next-line ntt/no-source-grep -- loading module for behavioral test
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
		mockDownloads.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
		(globalThis as any).chrome.downloads = mockDownloads;
		mockPurgeNeverCaptureHost.mockClear();
		((globalThis as any).browser.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();
	});

	// ======================== makeZip ========================

	describe('makeZip — export pipeline', () => {
		it('exports prefs.json with internal keys stripped', async () => {
			mockStorageLocal.get.mockResolvedValueOnce({
				theme: 'dark',
				rows: 4,
				columns: 5,
				thumbnailSize: 600,
				version: '2.0',
			});

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

		it('triggers browser.downloads.download', async () => {
			await makeZip();

			expect(mockDownloads.download).toHaveBeenCalledWith(
				expect.objectContaining({ filename: 'newtabtools.zip', saveAs: true }),
			);
		});
	});

	// ======================== makeZip — object URL revocation (post-MV3 backlog item 1a) ========================

	describe('makeZip — object URL revocation', () => {
		let createSpy: ReturnType<typeof vi.fn>;
		let revokeSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			createSpy = vi.fn(() => 'blob:mock-url');
			revokeSpy = vi.fn();
			(URL as any).createObjectURL = createSpy;
			(URL as any).revokeObjectURL = revokeSpy;
		});

		it('registers a downloads.onChanged listener scoped to the created download id', async () => {
			mockDownloads.download.mockResolvedValueOnce(101);

			await makeZip();

			expect(mockDownloads.onChanged!.addListener).toHaveBeenCalledTimes(1);
			expect(revokeSpy).not.toHaveBeenCalled();
		});

		it('revokes the object URL when the download reaches "complete"', async () => {
			mockDownloads.download.mockResolvedValueOnce(101);

			await makeZip();
			const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];

			onChangedListener({ id: 101, state: { current: 'complete' } });

			expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
			expect(mockDownloads.onChanged!.removeListener).toHaveBeenCalledWith(onChangedListener);
		});

		it('revokes the object URL when the download reaches "interrupted"', async () => {
			mockDownloads.download.mockResolvedValueOnce(102);

			await makeZip();
			const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];

			onChangedListener({ id: 102, state: { current: 'interrupted' } });

			expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
		});

		it('ignores onChanged events for a different download id', async () => {
			mockDownloads.download.mockResolvedValueOnce(103);

			await makeZip();
			const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];

			onChangedListener({ id: 999, state: { current: 'complete' } });

			expect(revokeSpy).not.toHaveBeenCalled();
		});

		it('ignores a non-terminal state change (e.g. "in_progress") for the same download id', async () => {
			mockDownloads.download.mockResolvedValueOnce(104);

			await makeZip();
			const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];

			onChangedListener({ id: 104, state: { current: 'in_progress' } });

			expect(revokeSpy).not.toHaveBeenCalled();
		});

		it('revokes immediately and rethrows when browser.downloads.download rejects', async () => {
			mockDownloads.download.mockRejectedValueOnce(new Error('download failed'));

			await expect(makeZip()).rejects.toThrow('download failed');

			expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
		});

		it('does not throw when browser.downloads.onChanged is absent (defensive guard)', async () => {
			const saved = mockDownloads.onChanged;
			mockDownloads.onChanged = undefined;
			(globalThis as any).chrome.downloads = mockDownloads;

			await expect(makeZip()).resolves.toBeDefined();

			mockDownloads.onChanged = saved;
			(globalThis as any).chrome.downloads = mockDownloads;
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

		it('passes tileAspect through the restore allow-list', async () => {
			const prefs = { theme: 'dark', tileAspect: '16-9' };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.tileAspect).toBe('16-9');
		});

		it('drops a non-CDN backgroundUrl pref at restore (§1.2 fix)', async () => {
			// backgroundUrl is interpolated into `style.backgroundImage` =
			// `url("…")` at render. The img-src CSP blocks loads from arbitrary
			// origins, but per the project's data-boundary pattern the value is
			// also validated at restore: only the Firefox wallpaper CDN passes.
			const prefs = {
				theme: 'dark',
				backgroundUrl: 'https://attacker.example/x.png',
			};
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.theme).toBe('dark');
			// Untrusted origin → dropped, never stored.
			expect(storedPrefs).not.toHaveProperty('backgroundUrl');
		});

		it('also drops a CSS-injection backgroundUrl payload at restore (§1.2 fix)', async () => {
			const prefs = {
				backgroundUrl: 'https://firefox-settings-attachments.cdn.mozilla.net/a.png") ; background: url(http://attacker.example/x',
			};
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			// The trailing junk breaks the strict CDN match → dropped.
			expect(storedPrefs).not.toHaveProperty('backgroundUrl');
		});

		it('preserves a valid Firefox-CDN backgroundUrl at restore (§1.2 fix)', async () => {
			const url = 'https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/newtab-wallpapers-v2/abc.avif';
			const prefs = { backgroundUrl: url };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.backgroundUrl).toBe(url);
		});

		it('sanitizes malicious backgroundColor in restored tiles (§1.1 fix)', async () => {
			const tiles = [
				{ id: 4, url: 'https://legit.com', title: 'Evil BG', position: 0,
					backgroundColor: '#ff0000); background-image: url(http://attacker.example/x' },
			];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			const storedTile = (mockTiles.putTile as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(storedTile).toBeDefined();
			expect(storedTile.url).toBe('https://legit.com');
			// The malicious backgroundColor must be stripped — only valid hex colors pass
			expect(storedTile.backgroundColor).toBeUndefined();
		});

		it('preserves valid hex backgroundColor in restored tiles (§1.1 fix)', async () => {
			const tiles = [
				{ id: 5, url: 'https://safe.com', title: 'Safe BG', position: 0,
					backgroundColor: '#c96442' },
			];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			const storedTile = (mockTiles.putTile as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
			expect(storedTile.backgroundColor).toBe('#c96442');
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

		it('does not half-apply a backup whose tiles.json is malformed (atomic restore)', async () => {
			// A corrupt tiles.json (here: a trailing comma — invalid JSON) must
			// abort the whole restore BEFORE any state is written. Previously the
			// restore applied prefs first and only then parsed tiles.json, so a bad
			// backup left a half-applied state (new grid dimensions, zero tiles)
			// with no error surfaced. Restore must be atomic: parse everything,
			// then apply, or apply nothing.
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'dark', rows: 4, columns: 4 })),
				mockZipEntry('tiles.json', '[\n\t{ "id": 1, "url": "https://a.com", "position": 0, }\n]'),
			]);

			await expect(readZip(new Blob())).rejects.toThrow();

			// Nothing may have been written: not prefs, not the tile store.
			expect(mockStorageLocal.set).not.toHaveBeenCalled();
			expect(mockTiles.clear).not.toHaveBeenCalled();
			expect(mockTiles.putTile).not.toHaveBeenCalled();
		});
	});

	// ======================== Helper ========================

	// ======================== readZip — neverCaptureHosts ========================

	describe('readZip — neverCaptureHosts restore', () => {
		it('validates and normalizes neverCaptureHosts entries, drops bad ones', async () => {
			// 42 (non-string), 'javascript:alert(1)' (bad pattern), '' (empty),
			// 'Sub.Example.COM' (uppercased) are all sanitized.
			// Valid entries: 'example.com', '.corp.example', 'sub.example.com' (normalized).
			const prefs = {
				neverCaptureHosts: ['example.com', '.corp.example', 42, 'javascript:alert(1)', '', 'Sub.Example.COM'],
			};
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs).toHaveProperty('neverCaptureHosts');
			expect(storedPrefs.neverCaptureHosts).toEqual(
				expect.arrayContaining(['example.com', '.corp.example', 'sub.example.com']),
			);
			expect(storedPrefs.neverCaptureHosts).toHaveLength(3);
		});

		it('drops the neverCaptureHosts key when the value is not an array (object)', async () => {
			const prefs = { theme: 'dark', neverCaptureHosts: {} };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.theme).toBe('dark');
			expect(storedPrefs).not.toHaveProperty('neverCaptureHosts');
		});

		it('drops the neverCaptureHosts key when the value is a string', async () => {
			const prefs = { neverCaptureHosts: 'x' };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs).not.toHaveProperty('neverCaptureHosts');
		});

		it('calls purgeNeverCaptureHost once per stored entry after storage.set', async () => {
			const prefs = { neverCaptureHosts: ['example.com', '.corp.example'] };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			// storage.set must have been called before any purge
			expect(mockStorageLocal.set).toHaveBeenCalledTimes(1);
			expect(mockPurgeNeverCaptureHost).toHaveBeenCalledTimes(2);
			expect(mockPurgeNeverCaptureHost).toHaveBeenCalledWith('example.com');
			expect(mockPurgeNeverCaptureHost).toHaveBeenCalledWith('.corp.example');
		});

		it('does not call purgeNeverCaptureHost when neverCaptureHosts is absent from backup', async () => {
			const prefs = { theme: 'light' };
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify(prefs)),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs).not.toHaveProperty('neverCaptureHosts');
			expect(mockPurgeNeverCaptureHost).not.toHaveBeenCalled();
		});
	});

	// ======================== readZip — Page.restoreComplete broadcast ========================

	describe('readZip — Page.restoreComplete broadcast (Slice A)', () => {
		// Slice A (MV3_MIGRATION.md): readZip no longer reaches into page
		// globals via chrome.extension.getViews(); it broadcasts
		// 'Page.restoreComplete' once the restore data is fully written and
		// every open new-tab page refreshes itself.
		function sendMessageMock(): ReturnType<typeof vi.fn> {
			return (globalThis as any).browser.runtime.sendMessage;
		}

		it('broadcasts Page.restoreComplete exactly once after a full restore', async () => {
			const tiles = [{ id: 1, url: 'https://a.com', title: 'A', position: 0 }];
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'dark' })),
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			const broadcasts = sendMessageMock().mock.calls.filter(
				(c: unknown[]) => (c[0] as { name?: string })?.name === 'Page.restoreComplete');
			expect(broadcasts).toHaveLength(1);
		});

		it('broadcasts only after prefs and tiles have been written', async () => {
			const tiles = [{ id: 1, url: 'https://a.com', title: 'A', position: 0 }];
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'dark' })),
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
			]);

			await readZip(new Blob());

			const broadcastOrder = sendMessageMock().mock.invocationCallOrder[0];
			expect(broadcastOrder).toBeGreaterThan(mockStorageLocal.set.mock.invocationCallOrder[0]);
			expect(broadcastOrder).toBeGreaterThan(
				(mockTiles.putTile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
		});

		it('broadcasts on the prefs-only path too, after the never-capture purge', async () => {
			// A prefs-only backup returns early (no tiles.json) — the pages
			// still need the broadcast (e.g. a restored wallpaper).
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ neverCaptureHosts: ['example.com'] })),
			]);

			await readZip(new Blob());

			expect(sendMessageMock()).toHaveBeenCalledWith({ name: 'Page.restoreComplete' });
			expect(sendMessageMock().mock.invocationCallOrder[0])
				.toBeGreaterThan(mockPurgeNeverCaptureHost.mock.invocationCallOrder[0]);
		});

		it('swallows the rejection when no new-tab page is open', async () => {
			sendMessageMock().mockImplementationOnce(
				() => Promise.reject(new Error('Receiving end does not exist')));
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'light' })),
			]);

			await expect(readZip(new Blob())).resolves.toBeUndefined();
		});

		it('does not broadcast from makeZip (export touches no page state)', async () => {
			await makeZip();

			expect(sendMessageMock()).not.toHaveBeenCalledWith({ name: 'Page.restoreComplete' });
		});
	});

	// Store the default ZipReader class for restoration.
	let DefaultZipReader: any;

	/** Configure the mock zip reader to return the given entries. */
	function setupReader(entries: ReturnType<typeof mockZipEntry>[]) {
		(globalThis as any).zip.ZipReader = class {
			getEntries = vi.fn(async () => entries);
		};
	}
});
