#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// NTT UAT — browser daemon.
//
// A LONG-LIVED process that owns exactly ONE Selenium + browser session for
// the whole UAT run, and exposes it over a localhost HTTP API. The MCP
// server (mcp-server.mjs) is a thin client that forwards each browser_* tool
// call here; the runner spawns this once, polls /health, runs every scenario
// against the same warm browser, then SIGTERMs it.
//
// Why a daemon (vs. launching a browser inside each `claude -p` session):
//   - Launch + history-seed + extension-install cost is paid ONCE per run, not
//     once per scenario.
//   - History is seeded by real navigation BEFORE the extension is installed, so
//     the first new-tab render is an authentic new-user state (history-filled
//     grid, no thumbnails). This only makes sense paid once.
//   - Established split (browserless / Playwright launch-server / Selenium Grid):
//     browser runtime is separate from the agent's MCP context.
//
// Browser: $UAT_BROWSER selects `firefox` (default) or `chrome` (chrome-prep
// D6) — one parameterized daemon, not a forked implementation, per the
// manifest-overlay philosophy (single source tree, not parallel branches).
// The two browsers diverge in exactly one structural way — WHEN the extension
// is installed:
//   - Firefox: seedEnvironment() runs first (real navigation, no extension
//     loaded → no auto-thumbnail capture), THEN installExtension() calls
//     `driver.installAddon(xpi, true)` — an authentic new-user first render.
//   - Chrome: there is no mid-session unpacked-install equivalent to
//     geckodriver's `installAddon` (the CDP install route needs a pipe
//     transport Selenium doesn't expose), so the staged dev build is loaded
//     via `--load-extension` at LAUNCH — present from the first navigation.
//     installExtension() is a no-op on this path. The first-render
//     authenticity approximation still holds even so: during seeding nothing
//     is pinned yet and the tile cache is empty, so no captures fire — the
//     first NEW TAB render still shows a history-filled grid with no
//     thumbnails, it's just that the extension was technically resident a few
//     minutes earlier than on Firefox. Everything downstream (pin/capture/
//     reset) is wire/DOM-driven through `chrome.runtime.sendMessage` (Firefox
//     also answers to the `chrome.*` alias) and Selenium's browser-agnostic
//     API, so it needs no per-browser branching.
//
// PORT: 9876 by default for Firefox, 9877 for Chrome (chrome-prep D6, so both
// daemons can run in parallel — see tests/e2e-chrome/README.md "Port
// allocation"); $UAT_DAEMON_PORT overrides either. Firefox's default is
// deliberately != E2E's 9222 (tests/e2e/run_esr_tests.sh). preflight.mjs
// enforces the port is free before the runner starts.
//
// Endpoints (all JSON):
//   GET  /health          -> { status, ready, port }
//   POST /navigate         { url }              -> { ok, url }
//   POST /click            { selector }         -> { ok, selector }
//   POST /hover            { selector }         -> { ok, selector }
//   POST /evaluate         { script }           -> { value }
//   POST /file_upload      { selector, path }   -> { ok, path }
//   POST /screenshot       { name, dir? }       -> { saved, bytes }
//   POST /reset_extension                       -> { ok, resetCells }  (→ default 3×3)
//   POST /capture_tiles    { urls, settleMs? }  -> { ok, visited }  (trigger thumbnail capture)
//   POST /open_tabs        { urls, settleMs? }  -> { ok, opened }   (real tabs, left open)
//   POST /close_other_tabs                      -> { ok, closed }   (→ recently-closed)
//   POST /dismiss_consent                       -> { ok, clicked }  (accept cookies)
//
// Env: UAT_BROWSER=firefox|chrome, FIREFOX_BIN, CHROME_BIN, XPI_DIR/EXTENSION_XPI
//      (Firefox only), ARTIFACTS_DIR, UAT_DAEMON_PORT, UAT_WINDOW=WxH (viewport),
//      UAT_VIEWPORT=WxH (exact inner size), UAT_SHOT_SCALE (0<s≤1), UAT_SEED_URLS
//      + UAT_NEWS_URLS (environment seed).
//
// Run standalone (after `pnpm build`):
//   FIREFOX_BIN=/opt/firefox/firefox node tests/uat/_tools/browser-daemon.mjs
//   UAT_BROWSER=chrome node tests/uat/_tools/browser-daemon.mjs

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import chromeWebdriver from 'selenium-webdriver/chrome.js';
import { newTabURL } from './urls.mjs';
import { resolveChromeBinary, stageDevBuild, chromeArgs } from '../../e2e-chrome/_tools/chrome-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const UAT_BROWSER = process.env.UAT_BROWSER === 'chrome' ? 'chrome' : 'firefox';
const DEFAULT_PORT = UAT_BROWSER === 'chrome' ? 9877 : 9876;
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || DEFAULT_PORT;
const XPI_DIR = process.env.XPI_DIR || path.resolve(ROOT, 'dist');
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.resolve(__dirname, '../artifacts');
const UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const ADDON_ID = 'newtabtools@symlink.ch';
// Set once makeDriver() resolves the per-browser id (Firefox UUID / Chrome
// extension id) — every later use (isMain flow, HTTP handlers) runs strictly
// after makeDriver() has returned, so the assignment always lands first.
let NEWTAB_URL;
// { dir, extensionId } from stageDevBuild() — chrome-only, set in makeDriver().
let chromeStage = null;

// Window size for the Firefox viewport. Default Full HD; override with
// $UAT_WINDOW=WxH (e.g. 2560x1600 to supersample marketing screenshots).
const [WIN_W, WIN_H] = (() => {
	const m = /^(\d+)x(\d+)$/.exec(process.env.UAT_WINDOW || '');
	return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1920, 1080];
})();

// Environment seed — real navigation builds Firefox history + frecency so
// chrome.topSites (and thus NTT's default history-filled grid) has real entries
// to render. A merged US/global + Swiss list, tech-leaning, all reachable
// headless. Two visits per URL are needed before a site enters topSites, so the
// seed runs two passes (see seedEnvironment). Override with $UAT_SEED_URLS
export const SITES = [
	['https://github.com/', 'GitHub'],
	['https://news.ycombinator.com/', 'Hacker News'],
	['https://stackoverflow.com/', 'Stack Overflow'],
	['https://store.steampowered.com/', 'Steam'],
	['https://en.wikipedia.org/wiki/Firefox', 'Wikipedia'],
	['https://developer.mozilla.org/en-US/', 'MDN Web Docs'],
	['https://www.theverge.com/', 'The Verge'],
	['https://techcrunch.com/', 'TechCrunch'],
	['https://www.home-assistant.io/', 'Home Assistant'],
	['https://www.heise.de/newsticker/', 'heise online'],
	['https://www.bbc.com/news', 'BBC News'],
	['https://www.digitec.ch/en', 'Digitec'],
	['https://www.tomshardware.com/', 'Tom\'s Hardware'],
	['https://hackaday.com/', 'Hackaday'],
	['https://www.phoronix.com/', 'Phoronix'],
	['https://www.adafruit.com/', 'Adafruit'],
	['https://www.theregister.com/', 'The Register'],
	['https://www.coindesk.com/', 'CoinDesk'],
	['https://bitcoinmagazine.com/', 'Bitcoin Magazine'],
];

export const VISIT_URLS = [...SITES.map(s => s[0])];

const SEED_URLS = process.env.UAT_SEED_URLS ? process.env.UAT_SEED_URLS.split(/[\s,]+/).filter(Boolean) : VISIT_URLS;

// News homepages used to seed the recently-closed row: we open each, find a top
// article, navigate to it, then close the tab (the article URL — distinct from
// the homepage tile — lands in chrome.sessions.getRecentlyClosed).
export const NEWS_URLS = (process.env.UAT_NEWS_URLS
	? process.env.UAT_NEWS_URLS.split(/[\s,]+/).filter(Boolean)
	: [
		'https://www.theregister.com/',
		'https://news.ycombinator.com/',
		'https://techcrunch.com/',
		'https://www.heise.de/newsticker/',
		'https://bitcoinmagazine.com/',
	]);
const SEED_PAGELOAD_TIMEOUT_MS = 8000;
// Cap how long /navigate waits for full page load. Default high (so UAT's
// extension page always finishes); override low (e.g. 15000) when visiting heavy
// external sites so a slow/never-idle page doesn't hang the run — auto-thumbnail
// captures whatever painted.
const NORMAL_PAGELOAD_TIMEOUT_MS = parseInt(process.env.UAT_PAGELOAD_MS, 10) || 300000;

// Grid signature: .newtab-cell count = rows×columns. NTT's default grid is
// 3×3 = 9. /reset_extension returns the extension to this default and VERIFIES
// the count, so a broken reset surfaces as a between-scenario failure.
const DEFAULT_GRID_CELLS = 9;

// Default "favourite" pins applied at startup and after every reset (a factory
// reset wipes pinned tiles), so the board looks lived-in — real users pin a few.
// Heise / Ars / Hacker News match the history-seed URLs (they convert auto →
// pinned, no duplicate); the repo URL is pin-only. `Tiles.pinTile` is idempotent
// (no-ops if already pinned).
export const DEFAULT_PINS = [
	{ url: 'https://www.heise.de/newsticker/', title: 'heise online' },
	{ url: 'https://techcrunch.com/', title: 'TechCrunch' },
	{ url: 'https://news.ycombinator.com/', title: 'Hacker News' },
	{ url: 'https://developer.mozilla.org/en-US/', title: 'MDN Web Docs' },
	{ url: 'https://github.com/perdrizat/newtabtools', title: 'NewTab PowerTools' },
];

const LOG_PATH = path.join(ARTIFACTS_DIR, 'daemon.log');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

function log(msg) {
	const line = `[daemon] ${msg}`;
	console.log(line);
	try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch { /* best-effort log */ }
}

function resolveXpi() {
	if (process.env.EXTENSION_XPI) { return process.env.EXTENSION_XPI; }
	if (!fs.existsSync(XPI_DIR)) { throw new Error(`No ${XPI_DIR} — run \`pnpm build\` first.`); }
	const files = fs.readdirSync(XPI_DIR)
		.filter(n => n.endsWith('.xpi') || n.endsWith('.zip'))
		.map(n => path.join(XPI_DIR, n))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	if (!files.length) { throw new Error(`No EXTENSION_XPI set and no .xpi/.zip in ${XPI_DIR}`); }
	
	const uatBundle = files.find(f => f.includes('-uat.zip'));
	return uatBundle || files[0];
}

// $UAT_VIEWPORT=WxH: size the window so the *inner* viewport (what the
// screenshot captures) is exactly WxH — the outer window is larger by the
// chrome offset, so a naive setRect undershoots. One measure-and-correct pass
// lands it on the dot (used for native 1280×800 marketing screenshots). Shared
// across both browsers — Selenium's window-management API is browser-agnostic.
async function applyWindowSize(driver) {
	await driver.manage().window().setRect({ x: 0, y: 0, width: WIN_W, height: WIN_H });
	const vp = /^(\d+)x(\d+)$/.exec(process.env.UAT_VIEWPORT || '');
	if (vp) {
		const targetW = parseInt(vp[1], 10), targetH = parseInt(vp[2], 10);
		await driver.get('about:blank');
		const inner = await driver.executeScript('return [window.innerWidth, window.innerHeight]');
		const rect = await driver.manage().window().getRect();
		await driver.manage().window().setRect({
			x: 0, y: 0,
			width: targetW + (rect.width - inner[0]),
			height: targetH + (rect.height - inner[1]),
		});
	}
}

async function makeDriver() {
	if (UAT_BROWSER === 'chrome') {
		const found = resolveChromeBinary();
		if (!found) {
			throw new Error('no Chrome binary found ($CHROME_BIN or the Puppeteer cache) — run `pnpm chrome:provision`.');
		}
		// Stage the unpacked dev build (merged Chrome manifest + committed dev
		// key) so `--load-extension` gets a deterministic extension id — see
		// tests/e2e-chrome/_tools/chrome-env.mjs. Unlike Firefox's installAddon,
		// this MUST happen at launch (see the module header divergence note), so
		// NEWTAB_URL is resolved here rather than at module scope.
		chromeStage = stageDevBuild();
		NEWTAB_URL = newTabURL(chromeStage.extensionId, 'chrome');
		const opts = new chromeWebdriver.Options();
		opts.setChromeBinaryPath(found.bin);
		opts.addArguments('--headless=new', ...chromeArgs(chromeStage.dir));
		// Chrome's `--headless=new` renders ad-heavy seed sites much closer to
		// real Chrome (full JS/trackers/ads) than Firefox's classic `-headless`,
		// so some sites' `document.readyState` never settles to `complete` within
		// any reasonable bound — the default 'normal' pageLoadStrategy then hangs
		// `driver.get()` well past the daemon's own pageLoad timeout (observed
		// empirically on the full site list, chrome-prep D6). 'eager' returns once
		// DOMContentLoaded fires, which is enough for history/frecency seeding and
		// consent-banner dismissal. Firefox is unaffected (default strategy kept).
		opts.setPageLoadStrategy('eager');
		const driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
		await applyWindowSize(driver);
		log(`chrome extension id: ${chromeStage.extensionId} (${found.version}, ${found.bin})`);
		return driver;
	}

	NEWTAB_URL = newTabURL(UUID, 'firefox');
	const opts = new firefox.Options();
	if (process.env.FIREFOX_BIN) { opts.setBinary(process.env.FIREFOX_BIN); }
	opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
	opts.addArguments('-headless');
	// 'eager' returns each `driver.get()` at DOMContentLoaded instead of waiting
	// for full load. The environment seed's per-site get times were pinned at the
	// 8s SEED_PAGELOAD_TIMEOUT_MS cap on ~8 heavy sites (they never reach
	// `complete`) under the default 'normal' strategy — enough to push the whole
	// seed past the runner's 300s health budget (measured 325.6s, 2026-07-17).
	// DOMContentLoaded is sufficient for history/frecency seeding and consent
	// dismissal, so 'eager' cuts those stalls without losing visits. Matches the
	// Chrome branch above (added there for the same reason, chrome-prep D6).
	opts.setPageLoadStrategy('eager');
	// Render at Full HD, 100% (device-pixel-ratio 1) — a realistic desktop
	// viewport. Screenshots are saved at full resolution by default (see SHOT_SCALE)
	// so the agent judges a representative FHD layout.
	opts.addArguments(`--width=${WIN_W}`, `--height=${WIN_H}`);
	const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
	await applyWindowSize(driver);
	// NB: the extension is NOT installed here. The daemon seeds history first
	// (no extension loaded → no auto-thumbnail capture), then installs it, so the
	// first new-tab render is an authentic new-user state: history-filled grid
	// with no thumbnails yet. See installExtension(), called after seedEnvironment.
	return driver;
}
async function installExtension(d) {
	if (UAT_BROWSER === 'chrome') {
		// Chrome cannot install unpacked mid-session (no CDP pipe transport in
		// Selenium) — the staged dev build was already loaded via
		// `--load-extension` at launch time (see makeDriver). No-op here; kept
		// as a call site so the isMain flow reads identically for both browsers.
		log(`extension already loaded via --load-extension (chrome extension id: ${chromeStage.extensionId})`);
		return;
	}
	const xpi = resolveXpi();
	await d.installAddon(xpi, true); // temporary = unsigned OK on release
	log(`extension installed: ${path.basename(xpi)}`);
}

// Click an Accept/consent control on the current page AND in (often cross-origin)
// CMP iframes, then hide any leftover full-screen overlay + empty ad slots.
// Reused by the /dismiss_consent endpoint and the environment seed. Best-effort.
async function dismissConsent(d) {
	const clickConsent = () => d.executeScript(`
		// Pre-sweep known CMP consent buttons (OneTrust, Quantcast, SourcePoint, Oath/Yahoo, TrustArc, etc.)
		try {
			const known = document.querySelector('button[name="agree"], button[value="agree"], button.fc-cta-consent, .fc-vendor-preferences-accept-all, button.sp_choice_type_11, #onetrust-accept-btn-handler, #sp-cc-accept, .js-accept-all-cookies, .cmp-intro_acceptAll, [data-testid="cookie-policy-dialog-accept-button"], button[data-action="accept-all"], #truste-consent-button, .qc-cmp2-agree, button.message-component, button.qc-cmp-button, .qc-cmp2-summary-buttons button[mode="primary"], .qc-cmp2-b-p, .qc-cmp-button.qc-cmp-secondary-button:last-child');
			if (known) { known.click(); return 'known-cmp'; }
		} catch (e) {}

		// Reddit specific shadow-DOM CMP
		try {
			const rBtn = document.querySelector('shreddit-app').shadowRoot.querySelector('shreddit-async-button[button-text="Accept All"], button[slot="accept-all"]');
			if (rBtn) { rBtn.click(); return 'reddit-cmp'; }
		} catch (e) {}

		// Click a consent ACCEPT control. Short button labels only; an ACCEPT
		// pattern that must match and a DENY pattern that must NOT (so "I Accept"
		// is clicked but "Do not accept" / "Manage options" / "Reject" are
		// skipped). Pierces shadow DOM and matches in (cross-origin) iframes too.
		const ACCEPT = /\b(accept|consent|agree|allow|got it|continue|yes|zustimmen|akzeptieren|einverstanden|ok)\b/i;
		const DENY = /(do ?n.?t|manage|option|setting|custom|reject|decline|choice|preferenc|more|learn|disagree|essential|necessary|partners|purposes|ablehnen|einstellungen|zwecke)/i;
		const PREF = /\b(accept all|accept|i accept|consent|agree|allow all|zustimmen|alle akzeptieren)\b/i;
		const SEL = 'button,[role="button"],a,input[type="button"],input[type="submit"]';
		const out = [];
		(function collect(root) {
			try { for (const el of root.querySelectorAll(SEL)) { out.push(el); } } catch (e) {}
			try { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { collect(el.shadowRoot); } } } catch (e) {}
		})(document);
		const cands = out
			.map(el => ({ el, t: (el.textContent || el.value || el.getAttribute('aria-label') || '').trim() }))
			.filter(o => o.t && o.t.length <= 35 && ACCEPT.test(o.t) && !DENY.test(o.t));
		cands.sort((a, b) => (PREF.test(b.t) ? 1 : 0) - (PREF.test(a.t) ? 1 : 0) || a.t.length - b.t.length);
		if (cands.length) { cands[0].el.click(); return cands[0].t; }
		return null;
	`);
	const clicked = [];
	try { const r = await clickConsent(); if (r) { clicked.push(`main:${r}`); } } catch { /* ignore */ }
	const frames = await d.findElements(By.css('iframe'));
	for (const f of frames.slice(0, 35)) {
		try {
			await d.switchTo().frame(f);
			const r = await clickConsent();
			if (r) { clicked.push(`iframe:${r}`); }
		} catch { /* inaccessible frame */ } finally {
			try { await d.switchTo().defaultContent(); } catch { /* ignore */ }
		}
	}
	try {
		await d.executeScript(`
			// Hide leftover full-screen fixed/sticky overlays (cookie scrims, etc.).
			for (const el of document.querySelectorAll('body *')) {
				const s = getComputedStyle(el);
				if ((s.position === 'fixed' || s.position === 'sticky')
					&& el.offsetHeight > innerHeight * 0.55 && el.offsetWidth > innerWidth * 0.55) {
					el.style.display = 'none';
				}
			}
			// Collapse empty/served-blank ad slots (ads don't load headless) and known ad containers.
			const adSel = 'iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[src*="adservice"],iframe[src*="amazon-adsystem"],iframe[id*="google_ads"],[id^="ad-"],[id*="-ad-"],[id^="dfp-"],[class*="advertisement"],[class*="sponsored"],[class*="ad-slot"],[class*="ad-unit"],[data-ad],[aria-label="Advertisement" i],.ad-container,.ad-wrapper,[id*="banner-ad"],[class*="banner-ad"],[data-testid*="ad-"]';
			for (const el of document.querySelectorAll(adSel)) {
				el.style.setProperty('display', 'none', 'important');
				el.style.setProperty('min-height', '0', 'important');
				const p = el.parentElement;
				if (p && p.textContent.trim().length < 50) p.style.setProperty('display', 'none', 'important');
			}
			document.documentElement.style.overflow = ''; document.body.style.overflow = '';
			document.body.style.setProperty('margin-top', '0', 'important');
			document.body.style.setProperty('padding-top', '0', 'important');
			document.documentElement.style.setProperty('margin-top', '0', 'important');
			document.documentElement.style.setProperty('padding-top', '0', 'important');
		`);
	} catch { /* ignore */ }
	return { ok: true, clicked };
}

// Seed the recently-closed-tabs row: open each news homepage in a fresh tab,
// accept its cookie banner, pick a prominent same-origin article link, navigate
// to it, then close the tab. The closed tab's URL is the article (distinct from
// the homepage tile, so it survives the row's tile-dedup filter). Runs before
// the extension is installed; closes are still visible to chrome.sessions later.
async function seedRecentlyClosed(d) {
	const main = (await d.getAllWindowHandles())[0];
	let seeded = 0;
	const RC_N = NEWS_URLS.length;
	for (let ri = 0; ri < RC_N; ri++) {
		const home = NEWS_URLS[ri];
		const homeStart = now();
		log(`seed rc ${ri + 1}/${RC_N} start ${home}`);
		// Collect the top 2 distinct article links from the homepage…
		let articles = [];
		try {
			await d.switchTo().newWindow('tab');
			const g0 = now();
			try { await withTimeout(d.get(home), 12000, `recently-closed get ${home}`); } catch { /* slow */ }
			const getMs = now() - g0;
			await sleep(2500);
			try { await withTimeout(dismissConsent(d), 10000, `dismissConsent ${home}`); } catch { /* best effort */ }
			await sleep(1000);
			try { await withTimeout(dismissConsent(d), 10000, `dismissConsent ${home}`); } catch { /* best effort */ }
			log(`seed rc ${ri + 1}/${RC_N} homepage ${home} — get ${secs(getMs)}s`);
			articles = await d.executeScript(`
				const origin = location.origin, seen = new Set(), out = [];
				for (const a of document.querySelectorAll('a[href]')) {
					let u; try { u = new URL(a.href); } catch (e) { continue; }
					if (u.origin !== origin || u.pathname.split('/').filter(Boolean).length < 2) continue;
					if ((a.textContent || '').trim().length <= 40 || seen.has(u.href)) continue;
					seen.add(u.href); out.push(u.href);
					if (out.length >= 2) break;
				}
				return out;
			`);
			await d.close();
			await d.switchTo().window(main);
		} catch { try { await d.switchTo().window(main); } catch { /* ignore */ } }
		// …then visit + close each in its own tab so both land in recently-closed.
		let siteSeeded = 0;
		for (const article of (articles || [])) {
			try {
				await d.switchTo().newWindow('tab');
				const g0 = now();
				try { await withTimeout(d.get(article), 12000, `recently-closed get ${article}`); } catch { /* slow */ }
				const getMs = now() - g0;
				await sleep(1000);
				await d.close();
				await d.switchTo().window(main);
				seeded++; siteSeeded++;
				log(`seed rc ${ri + 1}/${RC_N} article ${article} — get ${secs(getMs)}s`);
			} catch { try { await d.switchTo().window(main); } catch { /* ignore */ } }
		}
		log(`seed rc ${ri + 1}/${RC_N} done ${home} — ${siteSeeded} articles, ${secs(now() - homeStart)}s`);
	}
	log(`recently-closed seeded: ${seeded} articles from ${NEWS_URLS.length} sites`);
}

// Build the environment BEFORE the extension is installed: two navigation passes
// over SEED_URLS (frecency needs ~2 visits before a site enters topSites), then
// the recently-closed seed. Pass 1 also accepts cookie banners (persists in the
// profile for the run); pass 2 just revisits to lift frecency.
async function seedEnvironment(d) {
	await d.manage().setTimeouts({ pageLoad: SEED_PAGELOAD_TIMEOUT_MS });
	const seedStart = now();
	const N = SEED_URLS.length;

	// Pass 1: first visit + cookie-banner dismissal. Per site we log the get
	// time, both dismissConsent times, and the site total — so a stall shows the
	// exact URL and phase, and the fixed-sleep overhead (3.5s/site) is visible
	// against the variable network time (is the seed slow because the network is
	// slow, or because we sleep 3.5s × N unconditionally?).
	log(`seed pass 1/2 starting — ${N} sites (get -> 2.5s settle -> consent -> 1s -> consent)`);
	let p1GetTotal = 0, p1ConsentTotal = 0, p1Clicked = 0;
	for (let i = 0; i < N; i++) {
		const url = SEED_URLS[i];
		const t0 = now();
		log(`seed p1 ${i + 1}/${N} start ${url}`);
		const g0 = now();
		try { await withTimeout(d.get(url), 12000, `seed get ${url}`); } catch { /* timeout harmless — URL still hit history */ }
		const getMs = now() - g0;
		// Settle before dismissing: consent platforms (e.g. Sourcepoint, used by
		// BBC) render their Accept control in an async cross-origin iframe a few
		// seconds after load. Accepting here sets a cookie that persists for the
		// run, so the site is banner-free on every later visit (incl. captures).
		await sleep(2500);
		const d1 = now();
		let r1 = null;
		try { r1 = await withTimeout(dismissConsent(d), 10000, `dismissConsent ${url}`); } catch { /* best effort */ }
		const c1 = now() - d1;
		await sleep(1000);
		const d2 = now();
		let r2 = null;
		try { r2 = await withTimeout(dismissConsent(d), 10000, `dismissConsent ${url}`); } catch { /* best effort */ }
		const c2 = now() - d2;
		const clicked = (r1 && r1.clicked) || (r2 && r2.clicked) || false;
		p1GetTotal += getMs; p1ConsentTotal += c1 + c2;
		if (clicked) { p1Clicked++; }
		log(`seed p1 ${i + 1}/${N} done ${url} — get ${secs(getMs)}s, consent ${secs(c1)}s+${secs(c2)}s${clicked ? ' (banner clicked)' : ''}, +3.5s fixed sleep, site ${secs(now() - t0)}s`);
	}
	log(`seed pass 1 done in ${secs(now() - seedStart)}s — get ${secs(p1GetTotal)}s, consent ${secs(p1ConsentTotal)}s, fixed-sleep ${secs(N * 3500)}s, banners clicked ${p1Clicked}/${N}`);

	// Pass 2: revisit each site to lift frecency past the topSites threshold. No
	// consent work here (cookies already set in pass 1), just get + a 0.5s settle.
	const p2Start = now();
	log(`seed pass 2/2 starting — ${N} sites (revisit for frecency)`);
	let p2GetTotal = 0;
	for (let i = 0; i < N; i++) {
		const url = SEED_URLS[i];
		const g0 = now();
		try { await withTimeout(d.get(url), 12000, `seed get ${url}`); } catch { /* timeout harmless */ }
		const getMs = now() - g0;
		p2GetTotal += getMs;
		await sleep(500);
		log(`seed p2 ${i + 1}/${N} done ${url} — get ${secs(getMs)}s`);
	}
	log(`seed pass 2 done in ${secs(now() - p2Start)}s — get ${secs(p2GetTotal)}s, fixed-sleep ${secs(N * 500)}s`);

	const rcStart = now();
	log(`seed recently-closed starting — ${NEWS_URLS.length} news sites`);
	await seedRecentlyClosed(d);
	log(`seed recently-closed done in ${secs(now() - rcStart)}s`);

	await d.manage().setTimeouts({ pageLoad: NORMAL_PAGELOAD_TIMEOUT_MS });
	log(`environment seeded: ${N} sites × 2 passes + recently-closed in ${secs(now() - seedStart)}s total`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Seed-timing helpers: `now()` is a monotonic-ish millisecond clock and `secs()`
// renders a duration in seconds to one decimal, for the per-site seed logs.
const now = () => Date.now();
const secs = ms => (ms / 1000).toFixed(1);

// Race a Selenium call against a hard deadline — defensive against a rare
// per-site hang in the environment seed (e.g. a pathological cross-origin
// iframe defeating dismissConsent()'s frame-switch walk faster than the
// browser's own pageLoad timeout can catch it; observed empirically under
// chromedriver on the full site list, chrome-prep D6). Callers already treat
// a rejected seed step as best-effort (catch-and-continue), so a timeout just
// looks like any other unreachable/slow site — the seed moves on instead of
// stalling the whole daemon startup indefinitely.
function withTimeout(promise, ms, label) {
	// CHROME-ONLY guard (chrome-prep D6 regression fix, 2026-07-16): on
	// Firefox this is an identity passthrough. Racing past a pending
	// `driver.get()` leaves geckodriver's serialized command queue holding the
	// abandoned navigation, and the seed's subsequent commands then fail to
	// register visits — reproduced as topSites staying EMPTY (daemon-smoke
	// `tiles: 0`) even on a solo run. Firefox keeps its original design: the
	// browser's own pageLoad timeout governs, and a timed-out `get()` still
	// counts as a visit ("URL still hit history"). Chromedriver tolerates the
	// race (verified by the green Chrome daemon-smoke) and needs it — see the
	// hang note above.
	if (UAT_BROWSER !== 'chrome') { return promise; }
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
	]);
}

// Screenshots render at Full HD. By default they are saved at full resolution
// (scale 1). To reduce the agent's image-token cost, they can be downscaled
// (e.g. 0.5 -> a 1920-wide capture is saved ~960 wide, which roughly quarters
// the pixels while keeping text legible).
// Override with $UAT_SHOT_SCALE. The downscale runs in-page on a <canvas>
// (the extension CSP allows `img-src data:`), so it needs no extra
// dependency or external image tool.
const SHOT_SCALE = (() => {
	const v = parseFloat(process.env.UAT_SHOT_SCALE);
	return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
})();
const DOWNSCALE_SCRIPT = `
	const b64 = arguments[0], factor = arguments[1], done = arguments[arguments.length - 1];
	const img = new Image();
	img.onload = () => {
		const w = Math.max(1, Math.round(img.naturalWidth * factor));
		const h = Math.max(1, Math.round(img.naturalHeight * factor));
		const c = document.createElement('canvas');
		c.width = w; c.height = h;
		const ctx = c.getContext('2d');
		ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, w, h);
		done(c.toDataURL('image/png').split(',')[1]);
	};
	img.onerror = () => done(null);
	img.src = 'data:image/png;base64,' + b64;
`;

// Downscale a base64 PNG via the page's canvas. Falls back to the full-res image
// if scaling is disabled or fails, so a screenshot is never lost.
async function downscalePng(b64) {
	if (SHOT_SCALE >= 1) { return b64; }
	try {
		const scaled = await driver.executeAsyncScript(DOWNSCALE_SCRIPT, b64, SHOT_SCALE);
		return scaled || b64;
	} catch (e) {
		log(`screenshot downscale failed (${e.message}); saving full-res`);
		return b64;
	}
}

// Poll the live grid's .newtab-cell count until it equals `expected`. Swallows
// transient errors (the page reloads mid-reset, briefly detaching the context).
async function waitForCells(expected, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		try {
			last = await driver.executeScript('return document.querySelectorAll(".newtab-cell").length');
			if (last === expected) { return last; }
		} catch { /* page reloading — retry */ }
		await sleep(250);
	}
	throw new Error(`grid never reached ${expected} cells (last=${last}) within ${timeoutMs}ms`);
}

// Open each URL in the main tab to trigger the extension's auto-thumbnail +
// favicon capture (the background captures the visible tab on load and stores it
// in the Thumbnails IDB store, keyed by URL), then return to the new-tab page.
async function captureTiles(urls, settleMs = 3000) {
	await driver.manage().setTimeouts({ pageLoad: 20000 });
	let visited = 0;
	for (const u of urls) {
		try { await driver.get(u); } catch { /* slow — a partial load still triggers capture */ }
		visited++;
		await sleep(settleMs); // let the multi-stage capture finalize
	}
	await driver.manage().setTimeouts({ pageLoad: NORMAL_PAGELOAD_TIMEOUT_MS });
	await driver.get(NEWTAB_URL);
	await sleep(1500);
	return visited;
}

// One-time live capture of the DEFAULT_PINS so the pinned favourites carry real
// screenshots + favicons. The capture lands in the Thumbnails IDB store keyed by
// URL; the lighter between-scenario reset preserves that store, so this runs ONCE
// (at startup) and the imagery survives every reset — re-pinned tiles re-fetch it
// by URL via getThumbnails()/getFavicons() (Option B).
let defaultPinsCaptured = false;
async function captureDefaultPins() {
	if (defaultPinsCaptured) { return; }
	await captureTiles(DEFAULT_PINS.map(p => p.url));
	defaultPinsCaptured = true;
	log(`default pin thumbnails + favicons captured: ${DEFAULT_PINS.length}`);
}

// Pin the DEFAULT_PINS via the background `Tiles.pinTile` message (idempotent;
// the handler live-updates the open grid). Applied at startup and after every
// reset so screenshots show a few pinned "favourites". Best-effort: a pin that
// doesn't paint logs a warning rather than aborting the run.
async function pinDefaultTiles() {
	await driver.get(NEWTAB_URL);
	await driver.manage().setTimeouts({ script: 20000 });
	await driver.executeAsyncScript(function(pins, done) {
		(async function() {
			for (const p of pins) {
				await new Promise(function(res) {
					chrome.runtime.sendMessage({ name: 'Tiles.pinTile', title: p.title, url: p.url }, function() { res(); });
				});
			}
			done(true);
		})();
	}, DEFAULT_PINS);
	await driver.get(NEWTAB_URL);
	try {
		await driver.wait(async function() {
			const n = await driver.executeScript('return document.querySelectorAll(".newtab-site[pinned]").length;');
			return n >= DEFAULT_PINS.length;
		}, 10000);
		log(`default tiles pinned: ${DEFAULT_PINS.length}`);
	} catch {
		const n = await driver.executeScript('return document.querySelectorAll(".newtab-site[pinned]").length;').catch(() => 0);
		log(`WARN: only ${n}/${DEFAULT_PINS.length} default pins rendered`);
	}
}

// Between-scenario reset: return the extension to its default state and verify.
// Option B (Thumbnails-preserving): clear the `tiles` + `background` IDB stores and
// prefs (storage.local) via background messages, but DELIBERATELY leave the
// `thumbnails` store intact — the default pins' screenshots + favicons were captured
// once at startup (see captureDefaultPins) and live there keyed by URL, so re-pinning
// below re-attaches them by URL on render with no per-reset recapture. This is lighter
// than driving the UI "Reset everything" path, which also wipes thumbnails. The seeded
// ENVIRONMENT — Firefox history, accepted-cookie state, and the recently-closed list —
// is browser-level and survives regardless, so every scenario starts from the same
// default UI on top of the same environment. Restoring the known-good fixture is an
// explicit scenario step (21-restore), not part of the reset.
async function resetToDefault() {
	await driver.get(NEWTAB_URL);
	await driver.manage().setTimeouts({ script: 20000 });
	await driver.executeAsyncScript(function(done) {
		(async function() {
			await new Promise(function(res) { chrome.runtime.sendMessage({ name: 'Tiles.clear' }, function() { res(); }); });
			await new Promise(function(res) { chrome.runtime.sendMessage({ name: 'Background.setBackground', file: null }, function() { res(); }); });
			await new Promise(function(res) { chrome.storage.local.clear(function() { res(); }); });
			done(true);
		})();
	});
	await driver.get(NEWTAB_URL);
	const resetCells = await waitForCells(DEFAULT_GRID_CELLS, 15000);
	// Re-apply the default pins — Tiles.clear wiped them; their imagery survives in
	// the preserved thumbnails store and re-attaches by URL on render.
	await pinDefaultTiles();
	return { ok: true, resetCells };
}

let driver;
const isMain = process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);

if (isMain) {
	driver = await makeDriver();
	await seedEnvironment(driver);
	// Time the post-seed startup steps too (seedEnvironment already logs its
	// own total): if the next startup stalls, the phase — install vs pin vs the
	// real-capture step — is named rather than guessed. captureDefaultPins does
	// real screenshot captures, so it's the most likely slow one.
	const iStart = now();
	await installExtension(driver);
	log(`startup: installExtension ${secs(now() - iStart)}s`);
	await driver.get(NEWTAB_URL);
	const pStart = now();
	await pinDefaultTiles();
	log(`startup: pinDefaultTiles ${secs(now() - pStart)}s`);
	const cStart = now();
	await captureDefaultPins();
	log(`startup: captureDefaultPins ${secs(now() - cStart)}s`);
	log(`initial newTab.html loaded [browser=${UAT_BROWSER}] (extension ${UAT_BROWSER === 'chrome' ? 'loaded pre-seed via --load-extension' : 'installed post-seed'}; default tiles pinned + imagery captured)`);
}

// ─── HTTP handlers ──────────────────────────────────────────────────────────

function readBody(req) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', c => { raw += c; });
		req.on('end', () => {
			if (!raw) { resolve({}); return; }
			try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
		});
		req.on('error', reject);
	});
}

async function handle(method, url, body) {
	if (method === 'GET' && url === '/health') {
		return { status: 'ok', ready: true, port: PORT };
	}
	if (method !== 'POST') { return { __status: 404, error: `no route ${method} ${url}` }; }

	switch (url) {
	case '/navigate':
		await driver.get(body.url);
		return { ok: true, url: body.url };
	case '/click':
		await driver.findElement(By.css(body.selector)).click();
		return { ok: true, selector: body.selector };
	case '/hover': {
		// Real pointer move so CSS :hover activates (synthetic JS events don't).
		// The pointer stays put, so a follow-up screenshot/evaluate sees the
		// hover state.
		const el = await driver.findElement(By.css(body.selector));
		await driver.actions().move({ origin: el }).perform();
		return { ok: true, selector: body.selector };
	}
	case '/open_tabs': {
		// Open each URL in a real new tab and leave it open (so open-tabs-derived
		// features like add-shortcut autocomplete have something to suggest), then
		// return focus to the first tab.
		const main = (await driver.getAllWindowHandles())[0];
		for (const url of body.urls || []) {
			await driver.switchTo().newWindow('tab');
			try { await driver.get(url); } catch { /* slow page — keep going */ }
			await sleep(body.settleMs || 1500);
		}
		await driver.switchTo().window(main);
		return { ok: true, opened: (body.urls || []).length };
	}
	case '/capture_tiles': {
		// Open each tile URL to trigger the extension's auto-thumbnail + favicon
		// capture, then return to the new-tab page (see captureTiles). Cookies were
		// accepted during the #0 seed and persist in the profile, so these URLs load
		// banner-free and the multi-stage capture finalizes clean. One call replaces N
		// agent navigations — cheap and bounded.
		const visited = await captureTiles(body.urls || [], body.settleMs || 3000);
		return { ok: true, visited };
	}
	case '/close_other_tabs': {
		// Close every tab except the first; closed tabs register in
		// sessions.getRecentlyClosed (drives the recently-closed-tabs row).
		const handles = await driver.getAllWindowHandles();
		for (const h of handles.slice(1)) {
			await driver.switchTo().window(h);
			await driver.close();
		}
		await driver.switchTo().window((await driver.getAllWindowHandles())[0]);
		return { ok: true, closed: handles.length - 1 };
	}
	case '/dismiss_consent':
		// Best-effort cookie/consent dismissal (page + cross-origin CMP iframes) +
		// overlay/ad-slot hiding. Shared with the environment seed.
		return await dismissConsent(driver);
	case '/evaluate':
		// body.async => executeAsyncScript: the script gets a callback as its
		// last argument and must call it with the result (for chrome.* / IDB
		// queries that resolve via callbacks/promises).
		return { value: body.async ? await driver.executeAsyncScript(body.script) : await driver.executeScript(body.script) };
	case '/file_upload':
		await driver.findElement(By.css(body.selector)).sendKeys(body.path);
		return { ok: true, path: body.path };
	case '/screenshot': {
		const dir = body.dir || ARTIFACTS_DIR;
		fs.mkdirSync(dir, { recursive: true });
		const data = await downscalePng(await driver.takeScreenshot());
		const p = path.join(dir, `${body.name}.png`);
		fs.writeFileSync(p, data, 'base64');
		return { saved: p, bytes: fs.statSync(p).size };
	}
	case '/reset_extension':
		return await resetToDefault();
	default:
		return { __status: 404, error: `no route ${method} ${url}` };
	}
}

const server = http.createServer(async (req, res) => {
	let body = {};
	try {
		if (req.method === 'POST') { body = await readBody(req); }
	} catch (e) {
		res.writeHead(400, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: `bad JSON body: ${e.message}` }));
		return;
	}
	const reqPath = req.url.split('?')[0];
	try {
		const out = await handle(req.method, reqPath, body);
		const code = out.__status || 200;
		delete out.__status;
		res.writeHead(code, { 'content-type': 'application/json' });
		res.end(JSON.stringify(out));
	} catch (e) {
		log(`error ${req.method} ${reqPath}: ${e.message}`);
		res.writeHead(500, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: e.message }));
	}
});

server.on('error', (e) => {
	if (e.code === 'EADDRINUSE') {
		log(`FATAL: port ${PORT} already in use — is another daemon (or E2E) running? Set $UAT_DAEMON_PORT.`);
	} else {
		log(`FATAL server error: ${e.message}`);
	}
	void shutdown(1);
});

if (isMain) {
	server.listen(PORT, '127.0.0.1', () => {
		log(`ready on http://127.0.0.1:${PORT} [browser=${UAT_BROWSER}]`);
	});
}

// ─── lifecycle ────────────────────────────────────────────────────────────

let shuttingDown = false;
async function shutdown(code) {
	if (shuttingDown) { return; }
	shuttingDown = true;
	log('shutting down');
	try { server.close(); } catch { /* already closed */ }
	try { await driver.quit(); } catch { /* already gone */ }
	process.exit(code);
}

process.on('SIGTERM', () => { void shutdown(0); });
process.on('SIGINT', () => { void shutdown(0); });
