import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	getNewTabURL,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	siteLinkExists,
	removeTileByUrl,
} from './_helpers.ts';

const TEST_URL = 'https://tile-redesign-test.example.com/';

describe('E2E: Tile redesign — new tile structure', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);

		// Pin a tile so the grid has at least one site to test
		const page = await openNewTab(browser);
		await waitForGridReady(page);
		await page.evaluate((u) => {
			return new Promise(resolve => {
				chrome.runtime.sendMessage({
					name: 'Tiles.pinTile',
					title: 'Redesign Test',
					url: u,
				}, resolve);
			});
		}, TEST_URL);
		const url = await getNewTabURL();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
		await waitForGridReady(page);
		await waitForCondition(page, siteLinkExists, [TEST_URL], { timeout: 15_000, message: 'Setup: pinned tile not in grid' });
		await page.close();
	}, 60_000);

	afterAll(async () => {
		if (browser) {
			// Clean up pinned tile
			const page = await openNewTab(browser);
			await waitForGridReady(page);
			await removeTileByUrl(page, TEST_URL);
			await page.close();
			await browser.disconnect();
		}
	});

	it('tiles have rounded corners (border-radius from --ntt-radius)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const radius = await waitForCondition(
				page,
				() => {
					const site = document.querySelector('.newtab-site');
					if (!site) {return false;}
					const r = getComputedStyle(site).borderRadius;
					return r && r !== '0px' ? r : false;
				},
				[],
				{ timeout: 10_000, message: 'Tiles do not have border-radius' }
			);
			expect(radius).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'tile-redesign-radius');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('tiles have box-shadow from design tokens', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const shadow = await waitForCondition(
				page,
				() => {
					const site = document.querySelector('.newtab-site');
					if (!site) {return false;}
					const s = getComputedStyle(site).boxShadow;
					return s && s !== 'none' ? s : false;
				},
				[],
				{ timeout: 10_000, message: 'Tiles do not have box-shadow' }
			);
			expect(shadow).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'tile-redesign-shadow');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('tiles have .ntt-overlay with gradient background', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasOverlay = await waitForCondition(
				page,
				() => {
					const overlay = document.querySelector('.ntt-overlay');
					if (!overlay) {return false;}
					const bg = getComputedStyle(overlay).background;
					return bg.includes('gradient') || bg.includes('linear');
				},
				[],
				{ timeout: 10_000, message: 'No .ntt-overlay with gradient found' }
			);
			expect(hasOverlay).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-overlay');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('tiles have .ntt-favicon with background color', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasFavicon = await waitForCondition(
				page,
				() => {
					const fav = document.querySelector('.ntt-favicon');
					if (!fav) {return false;}
					const bg = getComputedStyle(fav).backgroundColor;
					return bg && bg !== 'rgba(0, 0, 0, 0)';
				},
				[],
				{ timeout: 10_000, message: 'No .ntt-favicon with background found' }
			);
			expect(hasFavicon).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-favicon');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('tiles without captured thumbnail show .ntt-logo-fallback', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasFallback = await waitForCondition(
				page,
				() => {
					const fallback = document.querySelector('.ntt-logo-fallback');
					return !!fallback;
				},
				[],
				{ timeout: 10_000, message: 'No .ntt-logo-fallback found on tiles' }
			);
			expect(hasFallback).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-fallback');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('logo fallback has .ntt-logo-glyph with letter inside', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const glyphText = await waitForCondition(
				page,
				() => {
					const glyph = document.querySelector('.ntt-logo-glyph');
					if (!glyph) {return false;}
					const text = glyph.textContent?.trim();
					return text && text.length > 0 ? text : false;
				},
				[],
				{ timeout: 10_000, message: 'No .ntt-logo-glyph with text found' }
			);
			expect(glyphText).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'tile-redesign-glyph');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('.ntt-actions container has 4 action buttons', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const btnCount = await waitForCondition(
				page,
				() => {
					const actions = document.querySelector('.ntt-actions');
					if (!actions) {return false;}
					const count = actions.querySelectorAll('.ntt-action-btn').length;
					return count === 4 ? count : false;
				},
				[],
				{ timeout: 10_000, message: 'Expected 4 action buttons in .ntt-actions' }
			);
			expect(btnCount).toBe(4);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-actions');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('action buttons have correct data-action attributes', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const actions = await waitForCondition(
				page,
				() => {
					// Scope to a SINGLE tile's action row — a page-wide
					// `.ntt-action-btn` query returns N×4 buttons when more
					// than one tile is present (test-isolation races), which
					// made the strict `toEqual` assertion intermittently fail.
					const row = document.querySelector('.ntt-actions');
					if (!row) { return false; }
					const btns = row.querySelectorAll('.ntt-action-btn');
					if (btns.length < 4) {return false;}
					return Array.from(btns).map(b => b.getAttribute('data-action'));
				},
				[],
				{ timeout: 10_000, message: 'Action buttons not found' }
			);
			expect(actions).toEqual(['edit', 'never-capture', 'pin', 'remove']);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-action-attrs');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('action buttons contain SVG icons', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const hasSvg = await waitForCondition(
				page,
				() => {
					const btn = document.querySelector('.ntt-action-btn');
					if (!btn) {return false;}
					return !!btn.querySelector('svg');
				},
				[],
				{ timeout: 10_000, message: 'Action buttons do not contain SVG icons' }
			);
			expect(hasSvg).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-action-svg');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('pinned tile has [pinned] attribute and visible pin stripe', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// The tile was pinned in beforeAll
			const hasPinned = await waitForCondition(
				page,
				() => {
					const site = document.querySelector('.newtab-site[pinned]');
					return !!site;
				},
				[],
				{ timeout: 10_000, message: 'No .newtab-site[pinned] found' }
			);
			expect(hasPinned).toBe(true);

			// Verify pin stripe is visible
			const stripeVisible = await page.evaluate(() => {
				const stripe = document.querySelector('.newtab-site[pinned] .ntt-pin-stripe');
				if (!stripe) {return false;}
				return getComputedStyle(stripe).display !== 'none';
			});
			expect(stripeVisible).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-pin-toggle');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('.newtab-title shows site title text', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const titleText = await waitForCondition(
				page,
				() => {
					const title = document.querySelector('.newtab-site .newtab-title');
					if (!title) {return false;}
					const text = title.textContent?.trim();
					return text && text.length > 0 ? text : false;
				},
				[],
				{ timeout: 10_000, message: 'No title text in .newtab-title' }
			);
			expect(titleText).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'tile-redesign-title');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('old .newtab-control elements no longer exist in the DOM', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const oldControls = await page.evaluate(() => {
				return document.querySelectorAll('.newtab-control').length;
			});
			expect(oldControls).toBe(0);
		} catch (e) {
			await captureFailure(page, 'tile-redesign-no-old-controls');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('pin action button toggles [pinned] attribute (§4.3)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Tile was pinned in beforeAll — verify pinned state
			const wasPinned = await waitForCondition(
				page,
				() => !!document.querySelector('.newtab-site[pinned]'),
				[],
				{ timeout: 10_000, message: 'No pinned tile found' }
			);
			expect(wasPinned).toBe(true);

			// Click the pin button to unpin
			await page.evaluate(() => {
				const btn = document.querySelector('.ntt-action-btn[data-action="pin"]');
				if (btn) {(btn as HTMLElement).click();}
			});
			await new Promise(r => setTimeout(r, 1000));

			const unpinned = await page.evaluate(() => {
				return !document.querySelector('.newtab-site[pinned]');
			});
			expect(unpinned).toBe(true);

			// Re-pin for other tests
			await page.evaluate((u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Redesign Test',
						url: u,
					}, resolve);
				});
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 500));
		} catch (e) {
			await captureFailure(page, 'tile-action-pin');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('remove action button removes tile and shows undo (§4.3)', async () => {
		const page = await openNewTab(browser);
		const url = await getNewTabURL();
		await waitForGridReady(page);

		try {
			// Pin a separate tile for this test
			const removeUrl = 'https://tile-remove-test.example.com/';
			await page.evaluate((u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'Remove Test',
						url: u,
					}, resolve);
				});
			}, removeUrl);

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);
			await waitForCondition(page, siteLinkExists, [removeUrl], { timeout: 10_000, message: 'Remove test tile not in grid' });

			// Find and click the remove button on the new tile
			const removed = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) {return false;}
				const btn = site.querySelector('.ntt-action-btn[data-action="remove"]');
				if (!btn) {return false;}
				(btn as HTMLElement).click();
				return true;
			}, removeUrl);
			expect(removed).toBe(true);

			await new Promise(r => setTimeout(r, 1000));

			// Tile should be gone
			const stillExists = await page.evaluate(siteLinkExists, removeUrl);
			expect(stillExists).toBe(false);

			// Undo container should be visible
			const undoVisible = await page.evaluate(() => {
				const undo = document.getElementById('newtab-undo-container');
				return undo && !undo.hidden;
			});
			expect(undoVisible).toBe(true);
		} catch (e) {
			await captureFailure(page, 'tile-action-remove');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	// The "open in new tab" action was dropped in §3c — clicking the tile
	// already opens it (middle-/⌘-click for a new tab), so the arrow was
	// redundant. No action button or behaviour to assert anymore.

	// The "refresh" action button was removed in the tile redesign. The
	// never-capture toggle replaces it in the action row.

	it('never-capture action button toggles host list and purges thumbnail', async () => {
		const CAPTURE_URL = 'https://never-capture-toggle.example.com/';
		const page = await openNewTab(browser);
		const newTabURL = await getNewTabURL();
		await waitForGridReady(page);

		try {
			// Pin a tile for the test URL.
			await page.evaluate((u) => {
				return new Promise(resolve => {
					chrome.runtime.sendMessage({
						name: 'Tiles.pinTile',
						title: 'NeverCapture Test',
						url: u,
					}, resolve);
				});
			}, CAPTURE_URL);

			// Seed a thumbnail via Thumbnails.save so the tile has backgroundImage.
			await page.evaluate((u) => {
				// Create a minimal 1×1 PNG Blob to seed as the thumbnail image.
				const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
				const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
				const blob = new Blob([bytes], { type: 'image/png' });
				chrome.runtime.sendMessage({ name: 'Thumbnails.save', url: u, image: blob });
			}, CAPTURE_URL);

			// Reload so the grid picks up the pinned tile and thumbnail.
			await page.goto(newTabURL, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
			await waitForGridReady(page);

			// Wait until the tile has a backgroundImage (thumbnail applied).
			await waitForCondition(
				page,
				(u) => {
					const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
						.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
					if (!site) { return false; }
					const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
					const bg = thumb && thumb.style.backgroundImage;
					return bg && bg.startsWith('url(') ? bg : false;
				},
				[CAPTURE_URL],
				{ timeout: 15_000, message: 'Seeded thumbnail backgroundImage not applied to tile' }
			);

			// Click the never-capture button.
			await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) { return; }
				const btn = site.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement | null;
				if (btn) { btn.click(); }
			}, CAPTURE_URL);

			// Wait for storage to reflect the added host.
			const host = new URL(CAPTURE_URL).host;
			await waitForCondition(
				page,
				(h) => {
					return new Promise(resolve => {
						chrome.storage.local.get('neverCaptureHosts', (result: Record<string, unknown>) => {
							const list: string[] = (result.neverCaptureHosts as string[]) || [];
							resolve(list.includes(h as string) ? list : false);
						});
					});
				},
				[host],
				{ timeout: 10_000, message: 'neverCaptureHosts storage not updated after click' }
			);

			// Button flips to the listed state (camera icon + never-capture
			// attribute). Polled, not single-sampled: the post-purge Grid.refresh()
			// empties all cells synchronously and re-renders after an async
			// Tiles.getAllTiles round-trip, so a one-shot evaluate can land in the
			// empty-grid window and find no site.
			await waitForCondition(
				page,
				(u) => {
					const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
						.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
					if (!site) { return false; }
					const btn = site.querySelector('.ntt-action-btn[data-action="never-capture"]');
					return !!btn && btn.getAttribute('data-icon') === 'camera'
						&& site.hasAttribute('never-capture');
				},
				[CAPTURE_URL],
				{ timeout: 10_000, message: 'never-capture button did not flip to listed state after click' }
			);

			// Thumbnail should have been purged — wait for grid to refresh.
			await waitForCondition(
				page,
				(u) => {
					const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
						.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
					if (!site) { return false; }
					const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
					const bg = thumb && thumb.style.backgroundImage;
					// After purge + grid.refresh() the tile should show no blob URL.
					return (!bg || !bg.startsWith('url(blob:')) ? true : false;
				},
				[CAPTURE_URL],
				{ timeout: 10_000, message: 'Thumbnail not purged after never-capture click' }
			);

			// Click again to remove host from list.
			await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) { return; }
				const btn = site.querySelector('.ntt-action-btn[data-action="never-capture"]') as HTMLElement | null;
				if (btn) { btn.click(); }
			}, CAPTURE_URL);

			// List should now be empty.
			await waitForCondition(
				page,
				(h) => {
					return new Promise(resolve => {
						chrome.storage.local.get('neverCaptureHosts', (result: Record<string, unknown>) => {
							const list: string[] = (result.neverCaptureHosts as string[]) || [];
							resolve(!list.includes(h as string) ? true : false);
						});
					});
				},
				[host],
				{ timeout: 10_000, message: 'Host not removed from neverCaptureHosts after second click' }
			);

			// Icon should revert to camera-off.
			const iconAfterRemove = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				if (!site) { return null; }
				const btn = site.querySelector('.ntt-action-btn[data-action="never-capture"]');
				return btn ? btn.getAttribute('data-icon') : null;
			}, CAPTURE_URL);
			expect(iconAfterRemove).toBe('camera-off');

			// Thumbnail should NOT be resurrected (no recapture on toggle-off).
			const bgAfterRemove = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				const thumb = site ? site.querySelector('.newtab-thumbnail') as HTMLElement | null : null;
				return thumb ? thumb.style.backgroundImage : '';
			}, CAPTURE_URL);
			expect(bgAfterRemove).not.toMatch(/^url\(blob:/);
		} catch (e) {
			await captureFailure(page, 'tile-action-never-capture');
			throw e;
		} finally {
			// Clean up: unpin and clear neverCaptureHosts.
			await removeTileByUrl(page, CAPTURE_URL);
			await page.evaluate(() => new Promise<void>(resolve => {
				chrome.storage.local.remove('neverCaptureHosts', () => resolve());
			}));
			await page.close();
		}
	}, 90_000);

	// ── Visual sanity: rendered visibility checks ──

	it('action button SVG icons are visible (not display:none)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const svgDisplay = await waitForCondition(
				page,
				() => {
					const svg = document.querySelector('.ntt-action-btn svg');
					if (!svg) {return false;}
					const d = getComputedStyle(svg).display;
					return { display: d };
				},
				[],
				{ timeout: 10_000, message: 'No SVG found inside action buttons' }
			);
			expect(svgDisplay).toBeTruthy();
			expect((svgDisplay as any).display).not.toBe('none');
		} catch (e) {
			await captureFailure(page, 'tile-visual-action-svg-display');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('tile thumbnail area has non-zero rendered dimensions', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const dims = await waitForCondition(
				page,
				() => {
					const thumb = document.querySelector('.newtab-thumbnail');
					if (!thumb) {return false;}
					const r = thumb.getBoundingClientRect();
					return r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : false;
				},
				[],
				{ timeout: 10_000, message: 'Thumbnail area has zero dimensions' }
			);
			expect(dims).toBeTruthy();
		} catch (e) {
			await captureFailure(page, 'tile-visual-thumb-dims');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('logo fallback covers the full thumbnail area when no screenshot is present', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const coverage = await waitForCondition(
				page,
				() => {
					const site = document.querySelector('.newtab-site');
					if (!site) {return false;}
					const thumb = site.querySelector('.newtab-thumbnail');
					const fallback = site.querySelector('.ntt-logo-fallback');
					if (!thumb || !fallback) {return false;}
					const bg = (thumb as HTMLElement).style.backgroundImage;
					if (bg && bg.startsWith('url(')) {return false;}
					const tRect = thumb.getBoundingClientRect();
					const fRect = fallback.getBoundingClientRect();
					if (tRect.width === 0 || tRect.height === 0) {return false;}
					return {
						covers: fRect.width >= tRect.width * 0.95 && fRect.height >= tRect.height * 0.95,
						fallbackVisible: getComputedStyle(fallback).display !== 'none',
					};
				},
				[],
				{ timeout: 10_000, message: 'Could not find tile without screenshot for fallback check' }
			);
			expect(coverage).toEqual({ covers: true, fallbackVisible: true });
		} catch (e) {
			await captureFailure(page, 'tile-visual-fallback-coverage');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('logo glyph letter is contained within its parent (not oversized)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const contained = await waitForCondition(
				page,
				() => {
					const glyph = document.querySelector('.ntt-logo-glyph');
					if (!glyph) {return false;}
					const parent = glyph.parentElement;
					if (!parent) {return false;}
					const gRect = glyph.getBoundingClientRect();
					const pRect = parent.getBoundingClientRect();
					if (gRect.width === 0 || pRect.width === 0) {return false;}
					return {
						withinWidth: gRect.width <= pRect.width,
						withinHeight: gRect.height <= pRect.height,
					};
				},
				[],
				{ timeout: 10_000, message: 'Logo glyph not found for size check' }
			);
			expect(contained).toEqual({ withinWidth: true, withinHeight: true });
		} catch (e) {
			await captureFailure(page, 'tile-visual-glyph-size');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('overlay gradient bar is positioned at bottom of tile', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const position = await waitForCondition(
				page,
				() => {
					const site = document.querySelector('.newtab-site');
					const overlay = document.querySelector('.ntt-overlay');
					if (!site || !overlay) {return false;}
					const sRect = site.getBoundingClientRect();
					const oRect = overlay.getBoundingClientRect();
					if (sRect.height === 0 || oRect.height === 0) {return false;}
					const bottomAligned = Math.abs((oRect.bottom - sRect.bottom)) < 2;
					const partialHeight = oRect.height < sRect.height;
					return { bottomAligned, partialHeight };
				},
				[],
				{ timeout: 10_000, message: 'Overlay not found for position check' }
			);
			expect(position).toEqual({ bottomAligned: true, partialHeight: true });
		} catch (e) {
			await captureFailure(page, 'tile-visual-overlay-position');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);

	it('thumbnail with backgroundImage is not occluded by logo fallback', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const result = await page.evaluate(() => {
				const sites = document.querySelectorAll('.newtab-site');
				const issues: string[] = [];
				sites.forEach(site => {
					const thumb = site.querySelector('.newtab-thumbnail') as HTMLElement | null;
					if (!thumb) {return;}
					const bg = thumb.style.backgroundImage;
					if (!bg || !bg.startsWith('url(')) {return;}
					const fallback = thumb.querySelector('.ntt-logo-fallback');
					if (!fallback) {return;}
					const style = getComputedStyle(fallback);
					if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
						issues.push(`tile ${(site as HTMLElement).dataset?.url || 'unknown'}: fallback covers thumbnail`);
					}
				});
				return { checked: true, issues };
			});

			expect(result.checked).toBe(true);
			expect(result.issues).toEqual([]);
		} catch (e) {
			await captureFailure(page, 'tile-visual-occlusion');
			throw e;
		} finally {
			await page.close();
		}
	}, 60_000);
});
