import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	navigateAndConfirm,
	openDrawerUI,
	switchDrawerTabUI,
	removeTileByUrl,
} from './_helpers.ts';

// Reuse example.com — the same stable target auto-thumbnail.test.ts navigates to.
// It is publicly reachable and reliably loads; the capture pipeline triggers on
// webNavigation.onCompleted for any pinned URL.
const PIPELINE_URL = 'https://example.com/';

describe('E2E: Never-capture feature', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			await browser.disconnect();
		}
	});

	// Clear neverCaptureHosts between tests so each starts from a known state.
	afterEach(async () => {
		const page = await openNewTab(browser);
		try {
			await waitForCondition(
				page,
				() => typeof chrome !== 'undefined' && chrome.storage && typeof chrome.storage.local !== 'undefined',
				[],
				{ timeout: 10_000, message: 'chrome.storage not available for cleanup' }
			);
			await page.evaluate(() => new Promise<void>(resolve => {
				chrome.storage.local.remove('neverCaptureHosts', () => resolve());
			}));
		} finally {
			await page.close();
		}
	}, 30_000);

	// ── Test 1: Advanced UI — add host via drawer panel ──

	it('Advanced UI add: typing a host and clicking Add inserts a list row and saves to storage', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open the drawer and switch to the advanced tab.
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'advanced');
			await new Promise(r => setTimeout(r, 500));

			// Verify the never-capture group is visible.
			const groupVisible = await page.evaluate(() => {
				const group = document.getElementById('options-nevercapture');
				return group ? group.offsetParent !== null : false;
			});
			expect(groupVisible).toBe(true);

			// Type a host pattern into the input and click Add.
			await page.evaluate(() => {
				const input = document.getElementById('options-nevercapture-host') as HTMLInputElement | null;
				if (input) {
					input.value = '.example.com';
					input.dispatchEvent(new Event('input', { bubbles: true }));
				}
			});
			await page.evaluate(() => {
				const btn = document.getElementById('options-nevercapture-add') as HTMLButtonElement | null;
				if (btn) { btn.click(); }
			});

			await new Promise(r => setTimeout(r, 500));

			// A list row with text '.example.com' should appear.
			const rowText = await waitForCondition(
				page,
				() => {
					const rows = document.querySelectorAll('#options-nevercapture-list .ntt-nevercapture-row');
					for (const row of Array.from(rows)) {
						const span = row.querySelector('span');
						if (span && span.textContent && span.textContent.trim() === '.example.com') {
							return span.textContent.trim();
						}
					}
					return false;
				},
				[],
				{ timeout: 5_000, message: 'Never-capture list row not rendered after Add' }
			);
			expect(rowText).toBe('.example.com');

			// Storage must reflect the entry.
			const stored = await waitForCondition(
				page,
				() => new Promise(resolve => {
					chrome.storage.local.get('neverCaptureHosts', (result: Record<string, unknown>) => {
						const list: string[] = (result.neverCaptureHosts as string[]) || [];
						resolve(list.includes('.example.com') ? list : false);
					});
				}),
				[],
				{ timeout: 5_000, message: 'neverCaptureHosts not updated in storage after Add' }
			);
			expect(stored).toContain('.example.com');
		} catch (e) {
			await captureFailure(page, 'nevercapture-ui-add');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	// ── Test 2: Pipeline guard — navigation to a listed host skips capture ──

	it('Pipeline guard: navigating to a listed host does not produce a thumbnail record', async () => {
		// Pin the test URL first (pipeline only fires for tiles in the cache).
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		const newTabURL = await getNewTabURL();

		try {
			// Seed the pref directly — faster than driving the UI.
			const host = new URL(PIPELINE_URL).host;
			await page.evaluate((h) => new Promise<void>(resolve => {
				chrome.storage.local.set({ neverCaptureHosts: [h] }, () => resolve());
			}), host);

			// Pin the URL so the background capture pipeline considers it.
			await page.evaluate((u) => new Promise(resolve => {
				chrome.runtime.sendMessage({
					name: 'Tiles.pinTile',
					title: 'NeverCapture Pipeline',
					url: u,
				}, resolve);
			}), PIPELINE_URL);

			// Navigate to the URL (triggers webNavigation.onCompleted → capture pipeline).
			await navigateAndConfirm(page, PIPELINE_URL, { timeout: 30_000 });
			// Give the content script time to run (if it did, which it should not).
			await new Promise(r => setTimeout(r, 3000));

			// Navigate back to the new tab page.
			await page.goto(newTabURL, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// No thumbnail record should exist for this URL.
			const thumbResult = await page.evaluate((u) => new Promise<boolean>(resolve => {
				chrome.runtime.sendMessage({ name: 'Thumbnails.get', urls: [u] }, (map: Map<string, unknown>) => {
					// map may be a plain object (serialised) or a Map — check both.
					if (map instanceof Map) {
						resolve(!map.has(u) || map.get(u) == null);
					} else {
						const obj = map as Record<string, unknown>;
						resolve(obj[u] == null);
					}
				});
			}), PIPELINE_URL);
			expect(thumbResult).toBe(true);

			// The tile should show the logo fallback (no backgroundImage blob).
			const noThumb = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) { return false; }
				const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
				const bg = thumb && thumb.style.backgroundImage;
				return !bg || !bg.startsWith('url(blob:');
			}, PIPELINE_URL);
			expect(noThumb).toBe(true);
		} catch (e) {
			await captureFailure(page, 'nevercapture-pipeline-guard');
			throw e;
		} finally {
			// Clean up: unpin the tile.
			await removeTileByUrl(page, PIPELINE_URL);
			await page.close();
		}
	}, 90_000);

	// ── Test 3: Guarded save — Thumbnails.save refuses listed-host writes ──

	it('Guarded save: Thumbnails.save silently drops images for a listed host', async () => {
		const GUARDED_URL = 'https://guarded-save-test.example.com/';
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// List the host so the background guard is active.
			const host = new URL(GUARDED_URL).host;
			await page.evaluate((h) => new Promise<void>(resolve => {
				chrome.storage.local.set({ neverCaptureHosts: [h] }, () => resolve());
			}), host);

			// Attempt to save a thumbnail via Thumbnails.save (same idiom as the
			// thumbnail.js content script — a small PNG Blob).
			await page.evaluate((u) => {
				const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
				const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
				const blob = new Blob([bytes], { type: 'image/png' });
				chrome.runtime.sendMessage({ name: 'Thumbnails.save', url: u, image: blob });
			}, GUARDED_URL);

			// Small delay for the background to process the (dropped) message.
			await new Promise(r => setTimeout(r, 500));

			// Thumbnails.get should return nothing for the guarded URL.
			const thumbEmpty = await page.evaluate((u) => new Promise<boolean>(resolve => {
				chrome.runtime.sendMessage({ name: 'Thumbnails.get', urls: [u] }, (map: Map<string, unknown>) => {
					if (map instanceof Map) {
						resolve(!map.has(u) || map.get(u) == null);
					} else {
						const obj = map as Record<string, unknown>;
						resolve(obj[u] == null);
					}
				});
			}), GUARDED_URL);
			expect(thumbEmpty).toBe(true);
		} catch (e) {
			await captureFailure(page, 'nevercapture-guarded-save');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	// ── Test 4: Advanced UI — remove host via drawer panel ──

	it('Advanced UI remove: clicking the remove button deletes the row and updates storage', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Seed two entries directly so we know exactly what to render.
			await page.evaluate(() => new Promise<void>(resolve => {
				chrome.storage.local.set({ neverCaptureHosts: ['keep.example.com', 'remove.example.com'] }, () => resolve());
			}));

			// Open the advanced tab.
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'advanced');
			await new Promise(r => setTimeout(r, 500));

			// Trigger a UI refresh so the panel reflects the seeded storage.
			// fillNeverCaptureUI is invoked on storage changes; fire it manually
			// via a second storage write to force the onChanged listener.
			await page.evaluate(() => new Promise<void>(resolve => {
				// Re-set to the same value — the onChanged listener still fires.
				chrome.storage.local.set({ neverCaptureHosts: ['keep.example.com', 'remove.example.com'] }, () => resolve());
			}));
			await new Promise(r => setTimeout(r, 400));

			// Click the remove button for 'remove.example.com'.
			await page.evaluate(() => {
				const rows = document.querySelectorAll('#options-nevercapture-list .ntt-nevercapture-row');
				for (const row of Array.from(rows)) {
					const span = row.querySelector('span');
					if (span && span.textContent && span.textContent.trim() === 'remove.example.com') {
						const btn = row.querySelector('.ntt-nevercapture-remove') as HTMLButtonElement | null;
						if (btn) { btn.click(); }
						break;
					}
				}
			});
			await new Promise(r => setTimeout(r, 500));

			// The row for 'remove.example.com' must be gone.
			const rowGone = await page.evaluate(() => {
				const rows = document.querySelectorAll('#options-nevercapture-list .ntt-nevercapture-row');
				return !Array.from(rows).some(row => {
					const span = row.querySelector('span');
					return span && span.textContent && span.textContent.trim() === 'remove.example.com';
				});
			});
			expect(rowGone).toBe(true);

			// Storage must contain only the kept entry.
			const finalList = await waitForCondition(
				page,
				() => new Promise(resolve => {
					chrome.storage.local.get('neverCaptureHosts', (result: Record<string, unknown>) => {
						const list: string[] = (result.neverCaptureHosts as string[]) || [];
						if (list.length === 1 && list[0] === 'keep.example.com') {
							resolve(list);
						} else {
							resolve(false);
						}
					});
				}),
				[],
				{ timeout: 5_000, message: 'Storage not updated after row removal' }
			);
			expect(finalList).toEqual(['keep.example.com']);
		} catch (e) {
			await captureFailure(page, 'nevercapture-ui-remove');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);
});
