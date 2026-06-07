import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForGridReady,
	resetTestState,
} from './_helpers.ts';

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
			await page.evaluate(() => (window as any).newTabTools.openDrawer());
			await new Promise(r => setTimeout(r, 300));
			const editing = await page.evaluate(() => ({
				drawerOpen: document.documentElement.hasAttribute('drawer-open'),
				locked: document.documentElement.hasAttribute('locked'),
				prefLocked: (window as any).Prefs.locked,
				btn: (document.getElementById('options-toggle')!.textContent || '').trim(),
			}));
			expect(editing.drawerOpen).toBe(true);
			expect(editing.locked).toBe(false);
			expect(editing.prefLocked).toBe(false);
			expect(editing.btn).toBe('Done');

			// Close = exit edit mode, re-lock.
			await page.evaluate(() => (window as any).newTabTools.closeDrawer());
			await new Promise(r => setTimeout(r, 300));
			const done = await page.evaluate(() => ({
				drawerOpen: document.documentElement.hasAttribute('drawer-open'),
				locked: document.documentElement.hasAttribute('locked'),
				prefLocked: (window as any).Prefs.locked,
				btn: (document.getElementById('options-toggle')!.textContent || '').trim(),
			}));
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

	it('hover actions remain available in normal (locked) mode — not gated on lock (§3c)', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Ensure normal/locked mode (drawer closed).
			await page.evaluate(() => (window as any).newTabTools.closeDrawer());
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
