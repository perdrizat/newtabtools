import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import { connectToFirefox, openNewTab, waitForGridReady, resetTestState, captureFailure } from './_helpers.ts';

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

	it('Layout tab is active by default when drawer opens', async () => {
		const tab = await page.evaluate(() => document.documentElement.getAttribute('drawer-tab'));
		expect(tab).toBe('layout');

		const layoutPanelVisible = await page.evaluate(() => {
			const panel = document.querySelector('[data-drawer-panel="layout"]') as HTMLElement;
			return !panel.hidden;
		});
		expect(layoutPanelVisible).toBe(true);
	});

	it('clicking a segmented columns button updates the pref via Prefs', async () => {
		try {
			await page.evaluate(() => {
				const btn = document.querySelector('.ntt-segmented[data-pref="columns"] [data-value="5"]') as HTMLElement;
				btn.click();
			});
			await new Promise(r => setTimeout(r, 400));

			const cols = await page.evaluate(() => (window as any).Prefs.columns);
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

			const layoutVisible = await page.evaluate(() => {
				const panel = document.querySelector('[data-drawer-panel="layout"]') as HTMLElement;
				return !panel.hidden;
			});
			expect(layoutVisible).toBe(false);

			// Restore default tab so subsequent tests start clean.
			await page.evaluate(() => {
				const tab = document.querySelector('[data-drawer-tab="layout"]') as HTMLElement;
				tab.click();
			});
		} catch (e) {
			await captureFailure(page, 'drawer-tab-fail');
			throw e;
		}
	});

	it('Esc closes the drawer', async () => {
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
		await page.evaluate(() => { (window as any).Prefs.columns = 3; });
	}, 30_000);

	// --- Regressions caught manually during Phase 3-1 review.
	//     These exercise the real XHTML / CSS / Firefox runtime, which is
	//     where the earlier integration suite (jsdom + HTML semantics)
	//     gave false-green results. ---

	it('regression: dispatching an `input` event on the spacing slider updates --ntt-gap in realtime', async () => {
		// jsdom returned tagName === "INPUT" but XHTML returns "input", so
		// the original handler silently no-op'd in the real extension.
		// Also: `<input type="range">` fires `change` only on release; the
		// drawer must listen for `input` for realtime drag feedback.
		await page.evaluate(() => {
			(window as any).newTabTools.openDrawer();
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
		await page.evaluate(() => {
			(window as any).Prefs.spacing = 'small';
			(window as any).newTabTools.closeDrawer();
		});
	}, 60_000);

	it('regression: toggling titleBarWordmark actually hides #ntt-wordmark (CSS [hidden] override)', async () => {
		// `#ntt-wordmark { display: flex }` (ID selector) outranks the UA
		// `[hidden] { display: none }` rule. Without the explicit override
		// in newTab.css the toggle flipped the pref but the wordmark stayed
		// visible.
		try {
			// Baseline: wordmark visible at default.
			const visibleBefore = await page.evaluate(() => {
				const el = document.getElementById('ntt-wordmark') as HTMLElement;
				return el.offsetWidth > 0;
			});
			expect(visibleBefore).toBe(true);

			await page.evaluate(() => { (window as any).Prefs.titleBarWordmark = false; });
			await new Promise(r => setTimeout(r, 400));

			const visibleAfter = await page.evaluate(() => {
				const el = document.getElementById('ntt-wordmark') as HTMLElement;
				return el.offsetWidth > 0;
			});
			expect(visibleAfter).toBe(false);
		} finally {
			await page.evaluate(() => { (window as any).Prefs.titleBarWordmark = true; });
		}
	}, 30_000);

	it('regression: clicking the toggle row label flips the pref (delegation, not direct button click)', async () => {
		// Users naturally click on the row label, not the small toggle
		// button. The handler must walk up to `.ntt-toggle-row[data-pref]`.
		await page.evaluate(() => {
			(window as any).newTabTools.openDrawer();
		});
		await new Promise(r => setTimeout(r, 200));

		try {
			const before = await page.evaluate(() => (window as any).Prefs.titleBarClock);
			await page.evaluate(() => {
				const label = document.querySelector('.ntt-toggle-row[data-pref="titleBarClock"] .ntt-toggle-label') as HTMLElement;
				label.click();
			});
			await new Promise(r => setTimeout(r, 400));

			const after = await page.evaluate(() => (window as any).Prefs.titleBarClock);
			expect(after).toBe(!before);

			// And #ntt-clock should actually be hidden / shown to match.
			const clockVisible = await page.evaluate(() => {
				const el = document.getElementById('ntt-clock') as HTMLElement;
				return el.offsetWidth > 0;
			});
			expect(clockVisible).toBe(after);
		} finally {
			await page.evaluate(() => {
				(window as any).Prefs.titleBarClock = true;
				(window as any).newTabTools.closeDrawer();
			});
		}
	}, 30_000);

	it('regression: rank stat type renders without requiring history permission', async () => {
		// Rank values come from the tile's own grid index; the original
		// `_renderStatChip` forgot to pass `rank` to `TileStats.compute`,
		// so rank fell through to the history-permission branch and
		// returned null for every tile.
		try {
			await page.evaluate(() => { (window as any).Prefs.statType = 'rank'; });
			await new Promise(r => setTimeout(r, 600));

			const chipTexts = await page.evaluate(() => {
				const chips = Array.from(document.querySelectorAll('#newtab-grid .ntt-stat-chip')) as HTMLElement[];
				return chips.map(c => c.textContent).filter(t => t && t.length > 0);
			});

			// At least one tile renders. Pinned-only profiles may have a
			// few empty cells; we just need any non-empty rank chip.
			expect(chipTexts.length).toBeGreaterThan(0);
			// Rank chips look like "#1", "#2", etc.
			expect(chipTexts.every(t => /^#\d+$/.test(t!))).toBe(true);
		} finally {
			await page.evaluate(() => { (window as any).Prefs.statType = 'none'; });
		}
	}, 30_000);
});
