import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	waitForCondition,
	resetTestState,
	getPref,
	openDrawerUI,
	closeDrawerUI,
	switchDrawerTabUI,
} from './_helpers.ts';

const TEST_URL = 'https://edit-cue.example.com/';

/**
 * Board A / Edit mode (DESIGNv2_REVIEW §2): there is no titlebar padlock and no
 * standalone lock checkbox. Lock is transient — opening the drawer IS edit mode
 * (board unlocks, button reads "Done"); closing it (Done/Esc) re-locks (button
 * reads "Edit"). This replaces the old padlock/checkbox lock toggle.
 */
describe('E2E: Edit/Done mode lock cycle (Board A §2)', () => {
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

	it('opening the drawer enters edit mode (unlocks + "Done"); closing re-locks (+ "Edit")', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open the drawer = enter edit mode.
			await openDrawerUI(page);
			await new Promise(r => setTimeout(r, 300));
			const editingDom = await page.evaluate(() => ({
				drawerOpen: document.documentElement.hasAttribute('drawer-open'),
				locked: document.documentElement.hasAttribute('locked'),
				btn: (document.getElementById('options-toggle')!.textContent || '').trim(),
			}));
			const editing = { ...editingDom, prefLocked: await getPref(page, 'locked') };
			expect(editing.drawerOpen).toBe(true);
			expect(editing.locked).toBe(false);
			expect(editing.prefLocked).toBe(false);
			expect(editing.btn).toBe('Done');

			// Close = exit edit mode, re-lock.
			await closeDrawerUI(page);
			await new Promise(r => setTimeout(r, 300));
			const doneDom = await page.evaluate(() => ({
				drawerOpen: document.documentElement.hasAttribute('drawer-open'),
				locked: document.documentElement.hasAttribute('locked'),
				btn: (document.getElementById('options-toggle')!.textContent || '').trim(),
			}));
			const done = { ...doneDom, prefLocked: await getPref(page, 'locked') };
			expect(done.drawerOpen).toBe(false);
			expect(done.locked).toBe(true);
			expect(done.prefLocked).toBe(true);
			expect(done.btn).toBe('Edit');
		} catch (e) {
			await captureFailure(page, 'edit-mode-lock');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('no titlebar padlock or standalone lock checkbox exists (Board A)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			const gone = await page.evaluate(() => ({
				noPadlock: !document.getElementById('locked-toggle'),
				noCheckbox: !document.querySelector('[name="locked"]'),
			}));
			expect(gone.noPadlock).toBe(true);
			expect(gone.noCheckbox).toBe(true);
		} catch (e) {
			await captureFailure(page, 'no-padlock');
			throw e;
		} finally {
			await page.close();
		}
	});

	it('edit mode: the selected pinned tile shows the copper ring + drag handle + action row, no dashed', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Pin a tile (live grid update), then open edit mode and select it.
			await page.evaluate((u) => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'Edit Cue', url: u }, resolve);
			}), TEST_URL);
			await waitForCondition(
				page,
				(u) => Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.some(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u && s.hasAttribute('pinned')),
				[TEST_URL],
				{ timeout: 15_000, message: 'tile not pinned' }
			);
			// Select the tile via its own in-tile "edit" action button —
			// fx-newTab.js's Site._onClick 'edit' case opens the drawer,
			// switches to the Tile tab, AND sets selectedSiteIndex, all from
			// one real click.
			await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u);
				const editBtn = site!.querySelector('.ntt-action-btn[data-action="edit"]') as HTMLElement;
				editBtn.click();
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 300));
			// Hover the selected tile — the elevation shadow (.newtab-site:hover) is
			// equal-specificity and later in the cascade, so the ring must survive
			// hover (this is exactly where it regressed before).
			await page.hover('.newtab-site[data-selected="true"]').catch(() => {});
			await new Promise(r => setTimeout(r, 150));

			const cues = await page.evaluate((u) => {
				const node = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u) as HTMLElement;
				const cs = getComputedStyle(node);
				const handle = node.querySelector('.ntt-drag-handle');
				const actions = node.querySelector('.ntt-actions');
				return {
					selected: node.getAttribute('data-selected'),
					ring: cs.boxShadow,
					accent: getComputedStyle(document.documentElement).getPropertyValue('--ntt-accent').trim(),
					outlineStyle: cs.outlineStyle,
					handleDisplay: handle ? getComputedStyle(handle).display : 'none',
					actionsOpacity: actions ? getComputedStyle(actions).opacity : '0',
					doneBtn: (document.getElementById('options-toggle')!.textContent || '').trim(),
				};
			}, TEST_URL);

			expect(cues.selected).toBe('true');
			// The ring must be the copper accent (both accent hexes → rgb), NOT just the
			// neutral elevation shadow — assert the accent colour is present.
			const ACCENTS = ['rgb(201, 100, 66)', 'rgb(224, 122, 93)'];
			expect(ACCENTS.some(a => cues.ring.includes(a)), `ring "${cues.ring}" lacks the accent`).toBe(true);
			expect(cues.outlineStyle).not.toBe('dashed'); // no redundant dashed on pinned
			expect(cues.handleDisplay).toBe('flex');      // drag handle visible
			expect(parseFloat(cues.actionsOpacity)).toBe(1); // persistent action row
			expect(cues.doneBtn).toBe('Done');

			// cleanup so the pinned tile doesn't leak into later tests
			await page.evaluate(() => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.clear' }, resolve);
			}));
		} catch (e) {
			await captureFailure(page, 'edit-mode-cues');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('edit mode: clicking a tile body opens the Tile dialog prefilled (from any drawer tab)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			await page.evaluate((u) => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: 'Edit Click', url: u }, resolve);
			}), TEST_URL);
			await waitForCondition(
				page,
				(u) => Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.some(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u && s.hasAttribute('pinned')),
				[TEST_URL],
				{ timeout: 15_000, message: 'tile not pinned' }
			);
			// Open the drawer to the ADVANCED tab — proves the tile click switches to
			// the Tile tab rather than relying on it already being active.
			await openDrawerUI(page);
			await switchDrawerTabUI(page, 'advanced');
			await new Promise(r => setTimeout(r, 300));
			// Click the tile body (the link) — not an action button.
			await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u)!;
				(site.querySelector('.newtab-link') as HTMLElement || site).click();
			}, TEST_URL);
			await new Promise(r => setTimeout(r, 300));

			const state = await page.evaluate((u) => {
				const site = Array.from(document.querySelectorAll('#newtab-grid .newtab-site'))
					.find(s => (s.querySelector('a.newtab-link') as HTMLAnchorElement | null)?.href === u)!;
				return {
					tab: document.documentElement.getAttribute('drawer-tab'),
					selected: site.getAttribute('data-selected'),
					editorVisible: !(document.getElementById('options-tile') as HTMLElement).hidden,
				};
			}, TEST_URL);

			expect(state.tab).toBe('tile');          // switched to the Tile menu
			expect(state.selected).toBe('true');     // prefilled for this tile
			expect(state.editorVisible).toBe(true);  // the tile editor is shown

			await page.evaluate(() => new Promise(resolve => {
				chrome.runtime.sendMessage({ name: 'Tiles.clear' }, resolve);
			}));
		} catch (e) {
			await captureFailure(page, 'edit-click-tile');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);

	it('hover actions remain available in normal (locked) mode — not gated on lock (§3c)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Ensure normal/locked mode (drawer closed).
			await closeDrawerUI(page);
			await new Promise(r => setTimeout(r, 300));
			// The action row is opacity:0 at rest but NOT display:none — it is
			// reachable on hover even while the board is locked.
			const actionsDisplay = await page.evaluate(() => {
				const a = document.querySelector('.ntt-actions');
				return a ? getComputedStyle(a).display : 'no-actions';
			});
			expect(actionsDisplay).not.toBe('none');
		} catch (e) {
			await captureFailure(page, 'actions-available-locked');
			throw e;
		} finally {
			await page.close();
		}
	});
});
