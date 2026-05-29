import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'puppeteer-core';
import {
	connectToFirefox,
	openNewTab,
	captureFailure,
	waitForCondition,
	waitForGridReady,
	resetTestState,
	navigateAndConfirm,
} from './_helpers.ts';

describe('E2E: Add-shortcut autocomplete (slot 29)', () => {
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

	it('typing in pin-URL input shows autocomplete suggestions from open tabs', async () => {
		// Open a known page in a separate tab to seed the tab list.
		const seedPage = await browser.newPage();
		await navigateAndConfirm(seedPage, 'https://example.com/', { timeout: 30_000 });

		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Type "example" into the pin-URL input to trigger autocomplete.
			// Use page.evaluate to set value and dispatch input event, since
			// the autocomplete listener is on the 'input' event.
			await page.evaluate(() => {
				const input = document.getElementById('options-pinURL-input') as HTMLInputElement;
				input.value = 'example';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});

			// Wait for the autocomplete list to appear with at least one item.
			const hasAutocomplete = await waitForCondition(
				page,
				() => {
					const ul = document.getElementById('autocomplete');
					if (!ul || ul.hidden) {return false;}
					// Look for non-blocked, non-hidden items.
					const items = ul.querySelectorAll('li:not(#options-pinURL-blocked):not([hidden])');
					return items.length > 0;
				},
				[],
				{ timeout: 10_000, message: 'Autocomplete dropdown did not appear with suggestions' }
			);
			expect(hasAutocomplete).toBeTruthy();

			// Verify at least one suggestion contains "example".
			const suggestions = await page.evaluate(() => {
				const ul = document.getElementById('autocomplete')!;
				const items = ul.querySelectorAll('li:not(#options-pinURL-blocked):not([hidden])');
				return [...items].map(li => ({
					url: (li as HTMLElement).dataset.url || '',
					title: (li as HTMLElement).dataset.title || '',
				}));
			});
			const hasExampleSuggestion = suggestions.some(s =>
				s.url.includes('example') || s.title.toLowerCase().includes('example')
			);
			expect(hasExampleSuggestion).toBe(true);
		} catch (e) {
			await captureFailure(page, 'autocomplete-tabs');
			throw e;
		} finally {
			await seedPage.close();
			await page.close();
		}
	}, 90_000);

	it('pin button is disabled for javascript: URLs and enabled for https: URLs', async () => {
		const page = await openNewTab(browser);
		await waitForGridReady(page);

		try {
			// Open settings.
			await page.evaluate(() => document.getElementById('options-toggle')!.click());
			await new Promise(r => setTimeout(r, 500));

			// Type a javascript: URL — pin button should be disabled.
			await page.evaluate(() => {
				const input = document.getElementById('options-pinURL-input') as HTMLInputElement;
				input.value = 'javascript:alert(1)';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const disabledForJS = await page.evaluate(() => {
				return (document.getElementById('options-pinURL') as HTMLInputElement).disabled;
			});
			expect(disabledForJS).toBe(true);

			// Type an https: URL — pin button should be enabled.
			await page.evaluate(() => {
				const input = document.getElementById('options-pinURL-input') as HTMLInputElement;
				input.value = 'https://example.com';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await new Promise(r => setTimeout(r, 300));

			const enabledForHTTPS = await page.evaluate(() => {
				return (document.getElementById('options-pinURL') as HTMLInputElement).disabled;
			});
			expect(enabledForHTTPS).toBe(false);
		} catch (e) {
			await captureFailure(page, 'autocomplete-validation');
			throw e;
		} finally {
			await page.close();
		}
	}, 90_000);
});
