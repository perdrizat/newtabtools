import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, waitForCondition, resetTestState, captureFailure, getNewTabURL, removeTileByUrl } from './_helpers.ts';

/**
 * Set one or more prefs via `browser.storage.local` and wait for the
 * read-back fence (chrome.storage serialises operations, so the get
 * callback fires only once the set has fully applied) — the principled
 * (non-page-global) way to seed/restore pref state from page context
 * (chrome-prep C3d, CHROME_PREP.md maintainer directive 1).
 */
async function setPrefs(page: Page, prefs: Record<string, unknown>): Promise<void> {
	await page.evaluate(p => new Promise<void>(resolve => {
		chrome.storage.local.set(p, () => {
			chrome.storage.local.get(() => resolve());
		});
	}), prefs);
}

/** Read one pref's current stored value via `browser.storage.local`. */
async function getPref(page: Page, name: string): Promise<unknown> {
	return page.evaluate(n => new Promise(resolve => {
		chrome.storage.local.get([n], (result: Record<string, unknown>) => resolve(result[n]));
	}), name);
}

describe('E2E: Configure drawer — open / close / push-layout / Layout tab (Phase 3-1)', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await connectToFirefox();
		await resetTestState(browser);
		page = await openNewTab(browser);
		await waitForGridReady(page);
	}, 60_000);

	afterAll(async () => {
		if (page) {
			await page.close();
		}
		if (browser) {
			await browser.disconnect();
		}
	});

	it('cogwheel click opens the drawer (sets [drawer-open] on <html>)', async () => {
		const openBefore = await page.evaluate(() =>
			document.documentElement.hasAttribute('drawer-open')
		);
		expect(openBefore).toBe(false);

		try {
			await page.evaluate(() => {
				(document.getElementById('options-toggle') as HTMLElement).click();
			});
			await new Promise(r => setTimeout(r, 400));

			const openAfter = await page.evaluate(() =>
				document.documentElement.hasAttribute('drawer-open')
			);
			expect(openAfter).toBe(true);
		} catch (e) {
			await captureFailure(page, 'drawer-open-fail');
			throw e;
		}
	});

	it('drawer pushes the scrollbox (drawer flex-basis becomes nonzero when open)', async () => {
		// Drawer is open from previous test.
		const drawerWidth = await page.evaluate(() => {
			const d = document.getElementById('ntt-drawer') as HTMLElement;
			return d.getBoundingClientRect().width;
		});
		expect(drawerWidth).toBeGreaterThanOrEqual(300);
	});

	it('Page tab is active by default when drawer opens', async () => {
		const tab = await page.evaluate(() => document.documentElement.getAttribute('drawer-tab'));
		expect(tab).toBe('page');

		const pagePanelVisible = await page.evaluate(() => {
			const panel = document.querySelector('[data-drawer-panel="page"]') as HTMLElement;
			return !panel.hidden;
		});
		expect(pagePanelVisible).toBe(true);
	});

	it('clicking a segmented columns button updates the pref via Prefs', async () => {
		try {
			await page.evaluate(() => {
				const btn = document.querySelector('.ntt-segmented[data-pref="columns"] [data-value="5"]') as HTMLElement;
				btn.click();
			});
			await new Promise(r => setTimeout(r, 400));

			const cols = await getPref(page, 'columns');
			expect(cols).toBe(5);

			// Active state should be reflected on the button via aria-checked.
			const active = await page.evaluate(() => {
				const btn = document.querySelector('.ntt-segmented[data-pref="columns"] [data-value="5"]') as HTMLElement;
				return btn.getAttribute('aria-checked');
			});
			expect(active).toBe('true');
		} catch (e) {
			await captureFailure(page, 'drawer-segmented-fail');
			throw e;
		}
	});

	it('clicking a tab switches the visible panel', async () => {
		try {
			await page.evaluate(() => {
				const tab = document.querySelector('[data-drawer-tab="advanced"]') as HTMLElement;
				tab.click();
			});
			await new Promise(r => setTimeout(r, 200));

			const tabAttr = await page.evaluate(() => document.documentElement.getAttribute('drawer-tab'));
			expect(tabAttr).toBe('advanced');

			const advancedVisible = await page.evaluate(() => {
				const panel = document.querySelector('[data-drawer-panel="advanced"]') as HTMLElement;
				return !panel.hidden;
			});
			expect(advancedVisible).toBe(true);

			const pageVisible = await page.evaluate(() => {
				const panel = document.querySelector('[data-drawer-panel="page"]') as HTMLElement;
				return !panel.hidden;
			});
			expect(pageVisible).toBe(false);

			// Restore default tab so subsequent tests start clean.
			await page.evaluate(() => {
				const tab = document.querySelector('[data-drawer-tab="page"]') as HTMLElement;
				tab.click();
			});
		} catch (e) {
			await captureFailure(page, 'drawer-tab-fail');
			throw e;
		}
	});

	it('Esc closes the drawer', async () => {
		// The window-level keydown handler (newTab.js) closes the drawer on
		// Escape regardless of what's focused, as long as the wallpaper
		// picker and pinURL autocomplete are both closed.
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 400));

		const open = await page.evaluate(() =>
			document.documentElement.hasAttribute('drawer-open')
		);
		expect(open).toBe(false);

		const drawerWidth = await page.evaluate(() => {
			const d = document.getElementById('ntt-drawer') as HTMLElement;
			return d.getBoundingClientRect().width;
		});
		expect(drawerWidth).toBeLessThan(50);

		// Reset columns to default so the next test file is hermetic.
		await setPrefs(page, { columns: 3 });
	}, 30_000);

	// --- Regressions caught manually during Phase 3-1 review.
	//     These exercise the real page / CSS / Firefox runtime, which is
	//     where the earlier integration suite (jsdom + HTML semantics)
	//     gave false-green results. ---

	it('regression: dispatching an `input` event on the spacing slider updates --ntt-gap in realtime', async () => {
		// jsdom returned tagName === "INPUT" but the (then-XHTML) production
		// page returned "input", so the original handler silently no-op'd
		// in the real extension.
		// Also: `<input type="range">` fires `change` only on release; the
		// drawer must listen for `input` for realtime drag feedback.
		// Drawer is closed from the previous test — the cogwheel toggles it.
		await page.evaluate(() => {
			(document.getElementById('options-toggle') as HTMLElement).click();
		});
		await new Promise(r => setTimeout(r, 200));

		const sequence = [
			{ idx: '2', expectedGap: '28px', expectedLabel: '28px' },
			{ idx: '0', expectedGap: '10px', expectedLabel: '10px' },
			{ idx: '1', expectedGap: '18px', expectedLabel: '18px' },
		];

		for (const step of sequence) {
			await page.evaluate(idx => {
				const slider = document.querySelector('input[type="range"][data-pref="spacing"]') as HTMLInputElement;
				slider.value = idx;
				slider.dispatchEvent(new Event('input', { bubbles: true }));
			}, step.idx);
			// Realtime label update is synchronous; CSS var update arrives
			// via the storage-onChanged round-trip.
			await new Promise(r => setTimeout(r, 400));

			const result = await page.evaluate(() => ({
				gap: document.documentElement.style.getPropertyValue('--ntt-gap'),
				label: (document.querySelector('.ntt-slider-snap[data-pref="spacing"] .ntt-slider-value') as HTMLElement).textContent,
			}));
			expect(result.gap).toBe(step.expectedGap);
			expect(result.label).toBe(step.expectedLabel);
		}

		// Restore default + close drawer.
		await setPrefs(page, { spacing: 'small' });
		await page.keyboard.press('Escape');
		await new Promise(r => setTimeout(r, 300));
	}, 60_000);

	it('Board A: no wordmark/masthead — a single visible Edit button is the titlebar action', async () => {
		// §1 removed the wordmark, masthead, and lock/cogwheel cluster; the one
		// titlebar action is the Edit button (#options-toggle).
		const result = await page.evaluate(() => {
			const edit = document.getElementById('options-toggle') as HTMLElement;
			return {
				noMasthead: !document.getElementById('ntt-masthead'),
				noWordmark: !document.getElementById('ntt-wordmark'),
				editText: edit ? (edit.textContent || '').trim() : null,
				editVisible: !!edit && edit.offsetWidth > 0,
			};
		});
		expect(result.noMasthead).toBe(true);
		expect(result.noWordmark).toBe(true);
		expect(result.editText).toBe('Edit');
		expect(result.editVisible).toBe(true);
	}, 30_000);

	it('regression: clicking the toggle row label flips the pref (delegation, not direct button click)', async () => {
		// Users naturally click on the row label, not the small toggle
		// button. The handler must walk up to `.ntt-toggle-row[data-pref]`.
		// Drawer is closed from the previous escape — the cogwheel opens it.
		await page.evaluate(() => {
			(document.getElementById('options-toggle') as HTMLElement).click();
		});
		await new Promise(r => setTimeout(r, 200));

		try {
			const before = await getPref(page, 'titleBarSearch');
			await page.evaluate(() => {
				const label = document.querySelector('.ntt-toggle-row[data-pref="titleBarSearch"] .ntt-toggle-label') as HTMLElement;
				label.click();
			});
			await new Promise(r => setTimeout(r, 400));

			const after = await getPref(page, 'titleBarSearch');
			expect(after).toBe(!before);

			// And #ntt-search should actually be hidden / shown to match.
			const searchHidden = await page.evaluate(() => {
				const el = document.getElementById('ntt-search') as HTMLElement;
				return el.hidden;
			});
			expect(searchHidden).toBe(!after);
		} finally {
			await setPrefs(page, { titleBarSearch: true });
			await page.keyboard.press('Escape');
			await new Promise(r => setTimeout(r, 300));
		}
	}, 30_000);

	it('Phase 3-2: clicking a theme card flips <html theme="..."> and the active card is aria-checked', async () => {
		await page.evaluate(() => {
			(document.getElementById('options-toggle') as HTMLElement).click();
		});
		await new Promise(r => setTimeout(r, 200));
		await page.evaluate(() => {
			const tab = document.querySelector('[data-drawer-tab="page"]') as HTMLElement;
			tab.click();
		});
		await new Promise(r => setTimeout(r, 200));

		try {
			await page.evaluate(() => {
				const card = document.querySelector('.ntt-theme-card[data-value="contrast"]') as HTMLElement;
				card.click();
			});
			await new Promise(r => setTimeout(r, 400));

			const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('theme'));
			expect(themeAttr).toBe('contrast');

			const checkedCard = await page.evaluate(() => {
				return Array.from(document.querySelectorAll('.ntt-theme-card[aria-checked="true"]'))
					.map(c => (c as HTMLElement).getAttribute('data-value'));
			});
			expect(checkedCard).toEqual(['contrast']);
		} finally {
			await setPrefs(page, { theme: 'system' });
			await page.keyboard.press('Escape');
			await new Promise(r => setTimeout(r, 300));
		}
	}, 30_000);

	it('Phase 3-2: Tile tab shows empty state when nothing is selected', async () => {
		// selectedSiteIndex is transient page-only state with no wire/storage
		// surface, so it can't be forced to null directly. Its setter (the
		// code that actually toggles the empty-state/edit-area DOM — the
		// static markup itself defaults BOTH to visible) only runs when
		// something explicitly assigns it; merely having an empty grid never
		// triggers it (newTab.js's `_autoSelectFirstTileIfNeeded` is a no-op
		// when there's no candidate to select). The one real, DOM-driven path
		// that reaches `selectedSiteIndex = null` is the Tile tab's "Remove"
		// button (`#options-url-remove` — newTab.js's `options-url-remove`
		// case): select a real tile first, then click Remove.
		const TEST_URL = 'https://drawer-empty-state.example/';
		await page.evaluate(u => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.pinTile', url: u, title: 'Empty state test' }, () => resolve());
		}), TEST_URL);
		const url = await getNewTabURL();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
		await waitForGridReady(page);
		await waitForCondition(
			page,
			u => Array.from(document.querySelectorAll('#newtab-grid a.newtab-link'))
				.some(a => (a as HTMLAnchorElement).href === u),
			[TEST_URL],
			{ timeout: 10_000, message: 'pinned tile did not surface in grid' }
		);

		await page.evaluate(() => {
			(document.getElementById('options-toggle') as HTMLElement).click();
		});
		await new Promise(r => setTimeout(r, 200));
		await page.evaluate(() => {
			const tab = document.querySelector('[data-drawer-tab="tile"]') as HTMLElement;
			tab.click();
		});
		await new Promise(r => setTimeout(r, 300));

		try {
			// Select the tile (auto-select may have already done this, since
			// it's the only tile — click it explicitly anyway, to not depend
			// on that).
			await page.evaluate(u => {
				const tiles = Array.from(document.querySelectorAll('#newtab-grid .newtab-site')) as HTMLElement[];
				const target = tiles.find(t => (t.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u) || tiles[0];
				target.click();
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 300));

			const selected = await page.evaluate(() => (document.getElementById('options-tile') as HTMLElement).hidden);
			expect(selected).toBe(false);

			// Click Remove — this both unpins/blocks the tile AND runs
			// `this.selectedSiteIndex = null`, which is what actually flips
			// the empty-state/edit-area visibility.
			await page.evaluate(() => {
				(document.getElementById('options-url-remove') as HTMLElement).click();
			});
			await new Promise(r => setTimeout(r, 300));

			const state = await page.evaluate(() => ({
				emptyHidden: (document.querySelector('[data-tile-empty]') as HTMLElement).hidden,
				editHidden: (document.getElementById('options-tile') as HTMLElement).hidden,
			}));
			expect(state.emptyHidden).toBe(false);
			expect(state.editHidden).toBe(true);
		} finally {
			// Belt-and-braces cleanup: options-url-remove already
			// unpinned/blocked the tile, but remove it from the tiles store
			// too in case that path didn't run (e.g. an earlier assertion
			// threw before the Remove click).
			await removeTileByUrl(page, TEST_URL);
			await page.keyboard.press('Escape');
			await new Promise(r => setTimeout(r, 300));
		}
	}, 30_000);

	it('Phase 3-2: clicking a tile while Tile tab is active selects it (copper ring + edit area)', async () => {
		// Pin a tile and reload the page so the grid surfaces it (the running
		// page caches Grid.sites; Updater.updateGrid alone isn't enough to
		// guarantee the DOM nodes are present).
		const TEST_URL = 'https://drawer-tile-select.example/';
		await page.evaluate(u => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.pinTile', url: u, title: 'Tile select test' }, () => resolve());
		}), TEST_URL);
		const url = await getNewTabURL();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
		await waitForGridReady(page);
		await waitForCondition(
			page,
			u => Array.from(document.querySelectorAll('#newtab-grid a.newtab-link'))
				.some(a => (a as HTMLAnchorElement).href === u),
			[TEST_URL],
			{ timeout: 10_000, message: 'pinned tile did not surface in grid' }
		);

		await page.evaluate(() => {
			(document.getElementById('options-toggle') as HTMLElement).click();
		});
		await new Promise(r => setTimeout(r, 200));
		await page.evaluate(() => {
			const tab = document.querySelector('[data-drawer-tab="tile"]') as HTMLElement;
			tab.click();
		});
		await new Promise(r => setTimeout(r, 300));

		try {
			// Click the tile body (not an action button) while the drawer's
			// Tile tab is open — site.js's Site._onClick treats this as
			// "select for editing" whenever `drawer-open` is set.
			await page.evaluate(u => {
				const tiles = Array.from(document.querySelectorAll('#newtab-grid .newtab-site')) as HTMLElement[];
				const target = tiles.find(t => (t.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u) || tiles[0];
				target.click();
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 400));

			const result = await page.evaluate(() => {
				const tile = document.querySelector('#newtab-grid .newtab-site[data-selected="true"]') as HTMLElement | null;
				const empty = document.querySelector('[data-tile-empty]') as HTMLElement;
				return {
					hasSelected: tile != null,
					emptyHidden: empty.hidden,
				};
			});
			expect(result.hasSelected).toBe(true);
			expect(result.emptyHidden).toBe(true);
		} finally {
			await removeTileByUrl(page, TEST_URL);
			await page.keyboard.press('Escape');
			await new Promise(r => setTimeout(r, 300));
		}
	}, 90_000);

	it('regression: rank stat type renders without requiring history permission', async () => {
		// Rank values come from the tile's own grid index; the original
		// `_renderStatChip` forgot to pass `rank` to `TileStats.compute`,
		// so rank fell through to the history-permission branch and
		// returned null for every tile.
		const TEST_URL = 'https://drawer-rank.example/';
		await page.evaluate(u => new Promise<void>(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.pinTile', url: u, title: 'Rank test' }, () => resolve());
		}), TEST_URL);
		const url = await getNewTabURL();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
		await waitForGridReady(page);
		await waitForCondition(
			page,
			u => Array.from(document.querySelectorAll('#newtab-grid a.newtab-link'))
				.some(a => (a as HTMLAnchorElement).href === u),
			[TEST_URL],
			{ timeout: 10_000, message: 'pinned tile did not surface in grid' }
		);

		try {
			await setPrefs(page, { statType: 'rank' });
			// Poll for the first rendered chip instead of a fixed sleep: the
			// setPrefs write only STARTS the async chain (storage.onChanged →
			// prefsChanged → updateUI → TileStats.compute → chip render),
			// which under full-suite load can take longer than any fixed
			// budget picked in a targeted run.
			await waitForCondition(
				page,
				() => Array.from(document.querySelectorAll('#newtab-grid .ntt-stat-chip'))
					.some(c => (c.textContent || '').length > 0),
				[],
				{ timeout: 10_000, message: 'no non-empty stat chip rendered after statType=rank' }
			);

			const chipTexts = await page.evaluate(() => {
				const chips = Array.from(document.querySelectorAll('#newtab-grid .ntt-stat-chip')) as HTMLElement[];
				return chips.map(c => c.textContent).filter(t => t && t.length > 0);
			});

			expect(chipTexts.length).toBeGreaterThan(0);
			expect(chipTexts.every(t => /^#\d+$/.test(t!))).toBe(true);
		} finally {
			await setPrefs(page, { statType: 'none' });
			await removeTileByUrl(page, TEST_URL);
		}
	}, 60_000);
});
