#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Generate the AMO listing screenshots (assets/screenshots/) using the UAT
 * browser daemon. Reproducible and self-contained:
 *
 *   1. Pin a few favourite tiles; browse a curated set of popular, tech-leaning
 *      sites (dismissing cookie banners) so the grid fills from history and
 *      auto-thumbnail captures a real thumbnail per URL.
 *   2. Capture the feature shots (settings drawer, add-tile autocomplete,
 *      per-domain filter, recently-closed row).
 *   3. Render the hero gallery LAST — thumbnails accumulate in IndexedDB (keyed
 *      by URL) over the run, so coverage is highest at the end; they re-attach to
 *      each layout (4×4 medium, 3×3 "maxi") on restore without revisiting.
 *
 * Native 2400×1800 PNG (AMO's maximum resolution). Sites that bot-block headless are omitted.
 *
 *   pnpm build
 *   FIREFOX_BIN=/opt/firefox/firefox node scripts/amo-screenshots.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZipWriter, TextReader, BlobWriter } from '@zip.js/zip.js';
import { SITES, VISIT_URLS, DEFAULT_PINS } from '../tests/uat/_tools/browser-daemon.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DAEMON = path.join(ROOT, 'tests/uat/_tools/browser-daemon.mjs');
const OUT_DIR = path.join(ROOT, 'assets/screenshots');
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || 9876;
const BASE = `http://127.0.0.1:${PORT}`;
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const NEWTAB = `moz-extension://${UUID}/newTab.html`;
const CDN = 'https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/newtab-wallpapers-v2/';
// A few curated wallpapers from Mozilla's Remote Settings catalog (the same
// source the in-app picker uses) — distinct light + dark backdrops so the hero
// gallery shows variety.
const WP = {
	balloons: `${CDN}ade94d3a-9a02-4b30-848f-638725a05180.avif`,    // hot-air-balloons (light)
	darkLandscape: `${CDN}10e23599-85bc-4660-ae06-7a67befbbcf9.avif`, // dark-landscape (dark)
	sandDunes: `${CDN}7dcbd2c8-8982-4108-b044-fae72b46e97f.avif`,    // sand-dunes (light)
	starryCanyon: `${CDN}7d98c7ab-274a-411d-95e4-84afd4e6203c.avif`, // starry-canyon (dark)
};

// Deep article/section URLs (NOT the tile homepages) opened as background tabs.
//   • OPEN_TABS — opened and left OPEN through the autocomplete shot, so it
//     genuinely shows suggestions "from your open tabs". All carry "tech" so a
//     `tech` query matches several. Closed at the end → more recent cards.
let OPEN_TABS = [
	'https://www.theverge.com/',
	'https://techcrunch.com/',
];

async function resolveTopStory(url) {
	try { await call('/navigate', { url }); } catch { /* slow */ }
	await sleep(2000);
	try { await call('/dismiss_consent', {}); } catch {}
	await sleep(1000);
	try { await call('/dismiss_consent', {}); } catch {}
	const links = await ev(`
		const origin = location.origin, seen = new Set(), out = [];
		for (const a of document.querySelectorAll('a[href]')) {
			let u; try { u = new URL(a.href); } catch (e) { continue; }
			if (u.origin !== origin || u.pathname.split('/').filter(Boolean).length < 2) continue;
			if ((a.textContent || '').trim().length <= 40 || seen.has(u.href)) continue;
			seen.add(u.href); out.push(u.href);
			if (out.length >= 1) break;
		}
		return out;
	`);
	return (links && links.length) ? links[0] : url;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(ep, body) {
	const res = await fetch(`${BASE}${ep}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const j = await res.json();
	if (!res.ok) { throw new Error(`${ep} -> ${JSON.stringify(j)}`); }
	return j;
}
const ev = script => call('/evaluate', { script }).then(r => r.value);
const click = selector => call('/click', { selector });
const hover = selector => call('/hover', { selector });
const shot = name => call('/screenshot', { name, dir: OUT_DIR }).then(r => {
	console.log(`  ✓ ${name}.png (${(r.bytes / 1024).toFixed(0)} KB)`);
});

async function waitHealthy(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try { if ((await call('/health')).ready) { return; } } catch { /* not up */ }
		await sleep(1000);
	}
	throw new Error('daemon never became healthy');
}
// Tolerant: wait until the grid has at least `n` tiles, but proceed (logging the
// count) on timeout — the history fill is non-deterministic and may underfill.
async function waitForAtLeast(n, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let last = 0;
	while (Date.now() < deadline) {
		try { last = await ev('return document.querySelectorAll(".newtab-site").length'); if (last >= n) { return last; } } catch { /* reloading */ }
		await sleep(400);
	}
	console.log(`  (grid filled ${last}/${n} — proceeding)`);
	return last;
}

function fixtureBlob(prefs, tiles) {
	const writer = new ZipWriter(new BlobWriter('application/zip'));
	return (async () => {
		await writer.add('prefs.json', new TextReader(JSON.stringify(prefs, null, '\t')));
		await writer.add('tiles.json', new TextReader(JSON.stringify(tiles, null, '\t')));
		return Buffer.from(await (await writer.close()).arrayBuffer());
	})();
}

let fixtureSeq = 0;
// Restore a fixture (always pins the same few tiles; the grid fills the rest from
// history) and reload for a clean render. `target` is the desired grid size to
// wait for, tolerantly.
async function restore(prefs, target) {
	const file = path.join(os.tmpdir(), `ntt-mkt-${fixtureSeq++}.zip`);
	fs.writeFileSync(file, await fixtureBlob(prefs, pinTiles()));
	await call('/navigate', { url: NEWTAB });
	await click('#options-toggle'); await sleep(300);
	await click('[data-drawer-tab="advanced"]'); await sleep(300);
	await call('/file_upload', { selector: '#options-restore-file', path: file }); await sleep(300);
	await click('#options-restore'); await sleep(300);
	await click('#options-restore-confirm');
	await sleep(2000);
	// Reload for a clean single render (restoring over an existing grid otherwise
	// leaves stale tile nodes) — also applies load-time prefs like the wallpaper.
	// The drawer is closed after a fresh load.
	await call('/navigate', { url: NEWTAB });
	await waitForAtLeast(target, 15000);
	await sleep(800);
	fs.rmSync(file, { force: true });
}

// Default pins are injected via the restore payload.
const PIN_COUNT = DEFAULT_PINS.length;
const pinTiles = () => DEFAULT_PINS.map(({url, title}, i) => ({ type: 'url', url, title, favicon: null, id: i + 1, position: i }));
const basePrefs = (wp, theme) => ({ backgroundUrl: wp, history: true, recent: true, locked: false, theme, themeAuto: false, tileAspect: 'fill', titleSize: 'medium', statType: 'none', titleBarSearch: true });
const mediumPrefs = (wp, theme = 'light') => ({ ...basePrefs(wp, theme), columns: 4, rows: 4, spacing: 'medium', margin: ['medium', 'medium', 'medium', 'medium'], tileRadius: 'medium', opacity: 90 });
const maxiPrefs = (wp, theme = 'light') => ({ ...basePrefs(wp, theme), columns: 3, rows: 3, spacing: 'large', margin: ['large', 'large', 'large', 'large'], tileRadius: 'large', opacity: 95, titleBarSearch: false, statType: 'visits' });

fs.mkdirSync(OUT_DIR, { recursive: true });
// Clean prior gallery so removed/renamed shots don't linger.
for (const f of fs.readdirSync(OUT_DIR)) { if (f.endsWith('.png')) { fs.rmSync(path.join(OUT_DIR, f)); } }

// Restores are driven explicitly via the restore UI (not /reset_extension), so
// the daemon's default fixture is irrelevant here.
const env = {
	...process.env,
	UAT_VIEWPORT: '2400x1800',
	UAT_WINDOW: '2400x1800',
	UAT_PAGELOAD_MS: '15000',
	UAT_SEED_URLS: VISIT_URLS.join(','),
	ARTIFACTS_DIR: os.tmpdir(),
};

console.log('amo-screenshots: starting daemon (native 2400×1800)…');
const daemon = spawn('node', [DAEMON], { stdio: ['ignore', 'inherit', 'inherit'], env });

let exitCode = 0;
try {
	await waitHealthy(300000);

	// The daemon has already natively seeded the environment, built frecency,
	// and installed the extension before reaching this point.

	// fast passes just build frecency (history) — a bare navigation is enough and
	// keeps the run short. The capture pass loads fully, dismisses cookie banners,
	// and settles so the auto-captured thumbnail is clean and complete.
	const CAPTURE_URLS = [...new Set([...VISIT_URLS, ...DEFAULT_PINS.map(p => p.url)])];
	const visit = async (label, { fast = false } = {}) => {
		const list = fast ? VISIT_URLS : CAPTURE_URLS;
		console.log(`${label}: visiting ${list.length} sites${fast ? ' (fast)' : ' (ad hiding + capture)'}…`);
		for (const url of list) {
			try { await call('/navigate', { url }); } catch { /* slow page */ }
			if (fast) { await sleep(900); continue; }
			
			// The cookies are already gone (from pre-sweep). We just need to instantly
			// execute the ad/whitespace removal script BEFORE the 2s capture timer fires!
			try { await call('/dismiss_consent', {}); } catch {}
			
			await sleep(3500); // Wait for the extension to safely finalize the capture
		}
	};

	// 1) Pin the few favourites; history is empty so the grid is just the pins.
	console.log(`pinning ${PIN_COUNT} favourites (rest fill from history)…`);
	await restore(mediumPrefs(WP.balloons), PIN_COUNT);

	// 2) Pass 3 (capture): Frecency is already built by the daemon's native seed passes.
	// We just fold topSites into the capture cache and do the final visit pass
	// which loads the clean sites, executes the ad-hider, and captures the thumbnails.
	await call('/navigate', { url: NEWTAB }); await sleep(2500); // fold topSites into the capture cache
	await visit('pass 3 (capture)');

	// 3a) The daemon's native seed pass ALREADY populated recently-closed natively!
	
	console.log('resolving top stories for OPEN_TABS…');
	const resolvedOpen = [];
	for (const u of OPEN_TABS) { resolvedOpen.push(await resolveTopStory(u)); }
	OPEN_TABS = resolvedOpen;

	// 3b) Open the autocomplete batch and leave it open through shot 06.
	await call('/open_tabs', { urls: OPEN_TABS, settleMs: 1500 });

	// 4) Feature shots on the primary layout, but with search bar disabled.
	const featurePrefs = { ...mediumPrefs(WP.balloons), titleBarSearch: false };
	await restore(featurePrefs, 16);

	await click('#options-toggle'); await sleep(300);

	// 05 — add-tile autocomplete (Tile panel). "tech" matches several open tabs
	await click('[data-drawer-tab="tile"]'); await sleep(400);
	await ev('newTabTools.pinURLInput.focus(); newTabTools.pinURLInput.value = "tech"; newTabTools.autocomplete(); return true');
	await sleep(1500);
	console.log(`  (autocomplete suggestions: ${await ev('return newTabTools.pinURLAutocomplete.querySelectorAll(".autocomplete-title").length')})`);
	await shot('05-add-tile-autocomplete');
	await ev('newTabTools.pinURLInput.value = ""; newTabTools.autocomplete(); return true');

	// 06 — settings drawer (Page panel)
	await click('[data-drawer-tab="page"]'); await sleep(500);
	await shot('06-settings-drawer');

	// 07 — per-domain filter cap (Advanced panel) — do before closing tabs
	await click('[data-drawer-tab="advanced"]'); await sleep(400);
	await ev(`
		const h = document.querySelector('#options-filter-host');
		h.value = '.bitcoinmagazine.com'; h.dispatchEvent(new Event('input', { bubbles: true }));
		const c = document.querySelector('#options-filter-count');
		c.value = '2'; c.dispatchEvent(new Event('input', { bubbles: true }));
		return true;
	`);
	await sleep(300);
	await ev("document.querySelector('#options-filter-set').click()"); await sleep(600);
	await shot('07-domain-filter');
	await click('#options-toggle'); await sleep(400); // close drawer

	// (recently-closed row shot was dropped, just close the tabs to prepare for hero gallery)
	await call('/close_other_tabs', {});

	// 5) Hero gallery LAST — auto-thumbnail captures accumulate in IDB (keyed by
	// URL) over the run, so coverage is highest now. Thumbnails re-attach to each
	// layout on restore without revisiting.
	console.log('rendering hero gallery…');
	await call('/navigate', { url: NEWTAB }); await waitForAtLeast(16, 15000); await sleep(1200);
	const total = await ev('return document.querySelectorAll(".newtab-site").length');
	const thumbs = await ev('return [...document.querySelectorAll(".newtab-thumbnail")].filter(t => getComputedStyle(t).backgroundImage.includes("url")).length');
	console.log(`  (grid: ${total} tiles, ${thumbs} with thumbnails)`);
	await hover('.newtab-site:nth-child(1)'); await sleep(400); await shot('01-grid-4x4-medium-light');
	await restore(mediumPrefs(WP.darkLandscape, 'dark'), 16); await sleep(1200); await hover('.newtab-site:nth-child(1)'); await sleep(400); await shot('02-grid-4x4-medium-dark');
	await restore(maxiPrefs(WP.sandDunes, 'light'), 9); await sleep(1200); await hover('.newtab-site:nth-child(1)'); await sleep(400); await shot('03-grid-3x3-maxi-light');
	await restore(maxiPrefs(WP.starryCanyon, 'dark'), 9); await sleep(1200); await hover('.newtab-site:nth-child(1)'); await sleep(400); await shot('04-grid-3x3-maxi-dark');

	console.log(`\namo-screenshots: done → ${OUT_DIR}/`);
} catch (e) {
	console.error(`amo-screenshots FAILED: ${e.message}`);
	exitCode = 1;
} finally {
	daemon.kill('SIGTERM');
	await sleep(3000);
	if (!daemon.killed) { daemon.kill('SIGKILL'); }
}
process.exit(exitCode);
