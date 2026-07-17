/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration test: backup/restore (zip pipeline) characterization.
 * Phase 1 slot 3 of the migration plan (MIGRATION.md).
 *
 * MODERNIZATION.md slice M4: migrated from `vm.runInThisContext`-loading the
 * former webextension/export.js (script-mode, with a fake zip transport and
 * Tiles/Background/purgeNeverCaptureHost poked directly onto `globalThis`) to
 * a native `import` of the real webextension/lib/backup.js module —
 * export.js dissolved into that module and has no behavior of its own left
 * to vm-load. lib/backup.js reaches its three collaborators via real
 * `import`s (MODERNIZATION.md Decision 2 doesn't apply to any of them — none
 * are dual-scope page/background files), so this suite substitutes fakes for
 * those imports with `vi.mock` instead of assigning `globalThis` properties:
 *   - `./zip/zip-core.js` (the vendored zip build) — same fake
 *     Promise-based transport layer as before, just expressed as a mocked
 *     module rather than a `globalThis.zip` object.
 *   - `./tiles-store.js` (`Tiles`/`Background`) and `./capture.js`
 *     (`purgeNeverCaptureHost`) — same shape of hand-rolled fakes as before;
 *     these have their own dedicated suites (tiles-pin.test.ts, the capture
 *     integration tests) so re-deriving them from a mocked IndexedDB here
 *     would blur what this suite characterizes (the backup/restore
 *     validation logic itself, not IndexedDB behavior).
 * `Filters` (prefs.js, a dual-scope bridge file per MODERNIZATION.md
 * Decision 2) gained a real `export` in PAGE_MODULES.md P3, and
 * lib/backup.js now imports it for real too — no stub needed here anymore;
 * the real `Filters.normalizeHost()` (pulled in transitively via
 * lib/backup.js's own import) is used as-is.
 *
 * Characterizes:
 *   - makeZip: what gets included, pref-key filtering, tile-image extraction
 *   - readZip: benign round-trip, restore-complete broadcast, tile rehydration
 *   - readZip with malicious inputs: javascript: URLs in tiles (§2.1),
 *     unexpected pref keys (§2.5), HTML in tile titles
 *   - readZip edge cases: missing entries, empty zip
 *
 * CHROME.md D2 (Decision 2a): makeZip no longer downloads anything itself —
 * `URL.createObjectURL` does not exist in a Chrome MV3 service worker, and a
 * Blob would not survive Chrome's JSON-serialized `runtime.sendMessage`
 * response. It returns the zip as base64 bytes + filename; the page side
 * (backup-download.js, tests/integration/backup-download.test.ts) decodes,
 * creates the blob URL, and triggers the download.
 *
 * E2E note: deferred for this slot. The export ends in a saveAs:true system
 * dialog Puppeteer can't easily automate and readZip requires file-input
 * injection. The Integration tests cover the security-critical logic paths.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock zip transport layer + collaborator fakes.
//
// vi.mock factories are hoisted above this file's other imports by Vitest, so
// any outer variable they close over must come from vi.hoisted() — plain
// module-scope `let`s declared below would not exist yet at hoist time.
// ---------------------------------------------------------------------------

/** Entries captured during a makeZip call. */
type WrittenEntry = { filename: string; content: string | Blob };

/** Shape of a mock zip entry, as produced by mockZipEntry() further below. */
type MockZipEntry = { filename: string; getData: ReturnType<typeof vi.fn> };

const zipState = vi.hoisted(() => ({
	writtenEntries: [] as WrittenEntry[],
	readerEntries: [] as MockZipEntry[],
	closeBlob: null as Blob | null,
}));

const mockBackground = vi.hoisted(() => ({
	getBackground: vi.fn(),
	setBackground: vi.fn(),
}));

const mockTiles = vi.hoisted(() => ({
	getAll: vi.fn(),
	clear: vi.fn(),
	putTile: vi.fn(),
}));

const mockPurgeNeverCaptureHost = vi.hoisted(() => vi.fn());

vi.mock('../../webextension/lib/zip/zip-core.js', () => ({
	configure: vi.fn(),
	BlobReader: class { blob: unknown; constructor(b: unknown) { this.blob = b; } },
	BlobWriter: class {},
	TextReader: class { text: string; constructor(t: string) { this.text = t; } },
	TextWriter: class {},

	ZipWriter: class {
		add = vi.fn(async (filename: string, reader: any) => {
			const content = 'text' in reader ? reader.text : reader.blob;
			zipState.writtenEntries.push({ filename, content });
		});
		close = vi.fn(async () => zipState.closeBlob ?? new Blob(['mock-zip']));
		constructor() { zipState.writtenEntries.length = 0; }
	},

	ZipReader: class {
		getEntries = vi.fn(async () => zipState.readerEntries);
	},
}));

vi.mock('../../webextension/lib/tiles-store.js', () => ({
	Tiles: mockTiles,
	Background: mockBackground,
}));

vi.mock('../../webextension/lib/capture.js', () => ({
	purgeNeverCaptureHost: mockPurgeNeverCaptureHost,
}));

import { makeZip, readZip } from '../../webextension/lib/backup.js';

/** Creates a mock zip entry for readZip tests. */
function mockZipEntry(filename: string, textContent?: string, blobContent?: Blob): MockZipEntry {
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

describe('backup/restore — lib/backup.js (MODERNIZATION.md M4)', () => {
	// Mocks
	let mockStorageLocal: Record<string, ReturnType<typeof vi.fn>>;
	let mockDownloads: {
		download: ReturnType<typeof vi.fn>;
		onChanged: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> } | undefined;
	};

	beforeAll(() => {
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

		mockBackground.getBackground.mockResolvedValue(null);
		mockBackground.setBackground.mockResolvedValue(undefined);
		mockTiles.getAll.mockResolvedValue([]);
		mockTiles.clear.mockResolvedValue(undefined);
		mockTiles.putTile.mockResolvedValue(undefined);
		mockPurgeNeverCaptureHost.mockResolvedValue({ thumbnails: 0, tiles: 0 });

		expect(makeZip).toBeTypeOf('function');
		expect(readZip).toBeTypeOf('function');
	});

	beforeEach(() => {
		zipState.writtenEntries.length = 0;
		zipState.readerEntries = [];
		zipState.closeBlob = null;
		mockBackground.getBackground.mockClear();
		mockBackground.setBackground.mockClear();
		mockTiles.getAll.mockClear();
		mockTiles.clear.mockClear();
		mockTiles.putTile.mockClear();
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

			const prefsEntry = zipState.writtenEntries.find(e => e.filename === 'prefs.json');
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

			const tilesEntry = zipState.writtenEntries.find(e => e.filename === 'tiles.json');
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

			const imgEntry = zipState.writtenEntries.find(e => e.filename === 'tileImages/7.png');
			expect(imgEntry).toBeDefined();
			expect(imgEntry!.content).toBe(imageBlob);

			// Image should be removed from tiles.json (stored separately)
			const tilesEntry = zipState.writtenEntries.find(e => e.filename === 'tiles.json');
			const tiles = JSON.parse(tilesEntry!.content as string);
			expect(tiles[0]).not.toHaveProperty('image');
		});

		it('includes background entry when background exists', async () => {
			const bgBlob = new Blob(['bg-data']);
			mockBackground.getBackground.mockResolvedValueOnce(bgBlob);

			await makeZip();

			const bgEntry = zipState.writtenEntries.find(e => e.filename === 'background');
			expect(bgEntry).toBeDefined();
			expect(bgEntry!.content).toBe(bgBlob);
		});

		it('omits background entry when no background is set', async () => {
			mockBackground.getBackground.mockResolvedValueOnce(null);

			await makeZip();

			expect(zipState.writtenEntries.find(e => e.filename === 'background')).toBeUndefined();
		});

		it('returns the zip as a Blob + filename instead of downloading (audit m3/A-note)', async () => {
			const result = await makeZip();

			expect(result.filename).toBe('newtabtools.zip');
			// Structured-clone messaging (Chrome 148+ floor, Decision 10) carries
			// a Blob over the wire intact on both platforms — no base64 leg.
			expect(result.data).toBeInstanceOf(Blob);
			expect(await result.data.text()).toBe('mock-zip');
			expect(mockDownloads.download).not.toHaveBeenCalled();
		});
	});

	// ======================== makeZip — no blob-URL/download machinery (CHROME.md D2, Decision 2a) ========================

	describe('makeZip — background stays free of blob URLs and downloads', () => {
		let createSpy: ReturnType<typeof vi.fn>;
		let revokeSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			createSpy = vi.fn(() => 'blob:mock-url');
			revokeSpy = vi.fn();
			(URL as any).createObjectURL = createSpy;
			(URL as any).revokeObjectURL = revokeSpy;
		});

		it('never calls URL.createObjectURL or URL.revokeObjectURL', async () => {
			await makeZip();

			expect(createSpy).not.toHaveBeenCalled();
			expect(revokeSpy).not.toHaveBeenCalled();
		});

		it('never touches the downloads API (no download, no onChanged listener)', async () => {
			await makeZip();

			expect(mockDownloads.download).not.toHaveBeenCalled();
			expect(mockDownloads.onChanged!.addListener).not.toHaveBeenCalled();
		});

		it('returns a Blob carrying a large (>32 KiB) zip intact — no encode/size ceiling (audit m3/A-note)', async () => {
			const bytes = new Uint8Array(100_000);
			for (let i = 0; i < bytes.length; i++) {
				bytes[i] = i % 256;
			}
			zipState.closeBlob = new Blob([bytes]);

			const { data } = await makeZip();

			expect(data).toBeInstanceOf(Blob);
			const roundTrip = new Uint8Array(await data.arrayBuffer());
			expect(roundTrip.length).toBe(bytes.length);
			let firstMismatch = -1;
			for (let i = 0; i < bytes.length; i++) {
				if (roundTrip[i] !== bytes[i]) {
					firstMismatch = i;
					break;
				}
			}
			expect(firstMismatch).toBe(-1);
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

		// audit 2026-07-16 m1: a crafted backup with `filters: null` (or a
		// non-object) would be stored verbatim; on the next load parsePrefs set
		// `Filters._list = null` and `getList()` threw, hanging the grid. Drop a
		// non-plain-object `filters` at the restore boundary (defense-in-depth
		// with the parsePrefs guard).
		it('drops a null filters value at restore (audit m1)', async () => {
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'dark', filters: null })),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.theme).toBe('dark');
			expect(storedPrefs).not.toHaveProperty('filters');
		});

		it('drops an array filters value at restore (audit m1)', async () => {
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ filters: ['example.com'] })),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs).not.toHaveProperty('filters');
		});

		it('preserves a valid filters object at restore', async () => {
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ filters: { 'example.com': 3 } })),
			]);

			await readZip(new Blob());

			const storedPrefs = mockStorageLocal.set.mock.calls[0][0];
			expect(storedPrefs.filters).toEqual({ 'example.com': 3 });
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

		it('rejects (writing nothing) when tiles.json parses but is not an array (audit finding #2)', async () => {
			// '{"x":1}' is syntactically valid JSON but the wrong SHAPE — it
			// must be rejected just as atomically as a JSON.parse failure,
			// before Background.setBackground/storage.local.set ever run.
			setupReader([
				mockZipEntry('prefs.json', JSON.stringify({ theme: 'dark' })),
				mockZipEntry('tiles.json', '{"x":1}'),
				mockZipEntry('background', undefined, new Blob(['bg-data'])),
			]);

			await expect(readZip(new Blob())).rejects.toThrow();

			expect(mockBackground.setBackground).not.toHaveBeenCalled();
			expect(mockStorageLocal.set).not.toHaveBeenCalled();
			expect(mockTiles.clear).not.toHaveBeenCalled();
			expect(mockTiles.putTile).not.toHaveBeenCalled();
		});

		it('rejects (writing nothing) when prefs.json parses but is not an object (audit finding #2)', async () => {
			// '5' is syntactically valid JSON but the wrong SHAPE.
			setupReader([
				mockZipEntry('prefs.json', '5'),
				mockZipEntry('tiles.json', JSON.stringify([{ id: 1, url: 'https://a.com', position: 0 }])),
				mockZipEntry('background', undefined, new Blob(['bg-data'])),
			]);

			await expect(readZip(new Blob())).rejects.toThrow();

			expect(mockBackground.setBackground).not.toHaveBeenCalled();
			expect(mockStorageLocal.set).not.toHaveBeenCalled();
			expect(mockTiles.clear).not.toHaveBeenCalled();
			expect(mockTiles.putTile).not.toHaveBeenCalled();
		});
	});

	// ======================== readZip — orphan tileImages/ entries (audit finding #3) ========================

	describe('readZip — orphan tileImages/ entries (audit finding #3)', () => {
		it('ignores an orphan image whose id has no matching tile, and completes the restore', async () => {
			const tiles = [{ id: 1, url: 'https://a.com', title: 'A', position: 0 }];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
				mockZipEntry('tileImages/999.png', undefined, new Blob(['orphan'])),
			]);

			await expect(readZip(new Blob())).resolves.toBeUndefined();

			expect(mockTiles.putTile).toHaveBeenCalledTimes(1);
			expect(mockTiles.putTile).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://a.com' }),
			);
		});

		it('ignores a garbage tileImages/ filename (parseInt → NaN) without throwing', async () => {
			const tiles = [{ id: 1, url: 'https://a.com', title: 'A', position: 0 }];
			setupReader([
				mockZipEntry('tiles.json', JSON.stringify(tiles)),
				mockZipEntry('tileImages/abc.png', undefined, new Blob(['garbage'])),
			]);

			await expect(readZip(new Blob())).resolves.toBeUndefined();

			expect(mockTiles.putTile).toHaveBeenCalledTimes(1);
			expect(mockTiles.putTile).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://a.com' }),
			);
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

	/** Configure the mocked zip.ZipReader to return the given entries. */
	function setupReader(entries: MockZipEntry[]) {
		zipState.readerEntries = entries;
	}
});
