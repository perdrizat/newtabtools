#!/usr/bin/env node
import puppeteer from 'puppeteer-core';

const BIDI_ENDPOINT = 'ws://127.0.0.1:9222/session';

async function main() {
	console.log('Connecting to Firefox...');
	const browser = await puppeteer.connect({
		browserWSEndpoint: BIDI_ENDPOINT,
		protocol: 'webDriverBiDi',
	});

	console.log('Connected.');

	// Wait a bit for extension to settle
	await new Promise(r => setTimeout(r, 5000));

	console.log('--- Checking all browsing contexts ---');
	// In BiDi, we can get all contexts
	// Puppeteer's browser.pages() uses BiDi to get all top-level contexts
	const pages = await browser.pages();
	console.log(`Found ${pages.length} pages.`);
	for (const page of pages) {
		console.log(`Page URL: ${page.url()}`);
	}

	// Try to find the extension UUID by looking at the background page
	// In BiDi, background pages might not be in pages()
	// But they might be in targets if we were using CDP. In BiDi...
  
	// Let's try to navigate to a known extension resource if we had the UUID.
	// Since we don't, let's try to find it via about:debugging
	console.log('--- Navigating to about:debugging ---');
	const page = pages[0] || await browser.newPage();
	try {
		// about:debugging might work if we wait long enough or use a different wait condition
		await page.goto('about:debugging#/runtime/this-firefox', {
			waitUntil: 'load',
			timeout: 30000
		});
		console.log('Navigated to about:debugging');
		await new Promise(r => setTimeout(r, 5000));
    
		const content = await page.evaluate(() => {
			return document.body.innerText;
		});
		console.log('about:debugging content length:', content.length);
    
		const extensionInfo = await page.evaluate(() => {
			const items = Array.from(document.querySelectorAll('.debug-target-item'));
			return items.map(item => {
				const name = item.querySelector('.debug-target-item__name')?.innerText;
				const uuid = item.querySelector('.debug-target-item__uuid')?.innerText;
				return { name, uuid };
			});
		});
		console.log('Extensions found on about:debugging:', JSON.stringify(extensionInfo, null, 2));

		const manifestUuid = await page.evaluate(() => {
			// Try to find the internal UUID more directly
			const links = Array.from(document.querySelectorAll('a'));
			for (const link of links) {
				if (link.href.startsWith('moz-extension://')) {
					return link.href.split('/')[2];
				}
			}
			return null;
		});
		console.log('Discovered UUID via links:', manifestUuid);
	} catch (e) {
		console.log('about:debugging failed:', e.message);
	}

	await browser.disconnect();
}

main().catch(err => {
	console.error('ERROR:', err);
	process.exit(1);
});
