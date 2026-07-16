#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Rasterizes the extension's SVG icons to PNG for the Chrome manifest
 * (CHROME.md D4/Decision 4: committed PNGs, produced by this checked-in
 * regen script rather than a runtime SVG->PNG dependency). Chrome's
 * `icons`/`action.default_icon` manifest keys do not accept SVG — Firefox's
 * do, so `manifest/base.json`'s `icons` and `manifest/firefox.json`'s
 * `action.default_icon` stay on the SVG originals untouched.
 *
 * Zero new dependencies: uses `puppeteer-core` (already a devDependency for
 * the Chrome runtime tier, tests/e2e-chrome/) driving the Chrome for Testing
 * binary already provisioned by `pnpm chrome:provision`. This script
 * resolves that binary itself (a small inline copy of the logic in
 * tests/e2e-chrome/_tools/chrome-env.mjs — deliberately not imported from
 * there, since tests/e2e-chrome/** is owned by a parallel task).
 *
 * Method: each SVG is embedded inline in a page sized to the exact target
 * pixel dimensions (the SVG's own viewBox handles the scaling), then
 * screenshotted with a transparent background (`omitBackground: true`) so
 * the PNG has no baked-in canvas color.
 *
 * Output: assets/chrome-icons/*.png (repo root, NOT webextension/ — the
 * Firefox .xpi packs webextension/ verbatim via `web-ext build`, so keeping
 * generated Chrome-only assets outside that tree is what keeps the Firefox
 * artifact byte-identical). scripts/build.mjs's chrome target copies these
 * into the staged build's images/ directory at build time.
 *
 * Regenerate after editing webextension/images/icon.svg or tools-light.svg:
 *
 *   node scripts/rasterize-icons.mjs
 *
 * Requires Chrome for Testing to already be provisioned (`pnpm chrome:provision`)
 * or $CHROME_BIN pointing at a runnable Chrome/Chromium binary.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = path.join(root, 'webextension', 'images');
const outDir = path.join(root, 'assets', 'chrome-icons');

/**
 * Chrome-for-Testing binaries in the standard Puppeteer cache, newest first.
 * Small inline copy of tests/e2e-chrome/_tools/chrome-env.mjs's resolver —
 * deliberately not imported (that directory is owned by a parallel task).
 * @return {string[]}
 */
function cftCandidates() {
	const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
	const chromeDir = path.join(cacheDir, 'chrome');
	try {
		return fs.readdirSync(chromeDir)
			.sort()
			.reverse()
			.map(build => path.join(chromeDir, build, 'chrome-linux64', 'chrome'))
			.filter(p => fs.existsSync(p));
	} catch {
		return [];
	}
}

/**
 * Locate a runnable Chrome binary: $CHROME_BIN, then Chrome for Testing,
 * then branded/chromium binaries as a last resort.
 * @return {string | null}
 */
function resolveChromeBinary() {
	const candidates = [
		process.env.CHROME_BIN,
		...cftCandidates(),
		'google-chrome-stable',
		'google-chrome',
		'chromium',
		'chromium-browser',
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			const bin = path.isAbsolute(candidate)
				? candidate
				: execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
			if (!bin || !fs.existsSync(bin)) { continue; }
			execFileSync(bin, ['--version'], { encoding: 'utf8' });
			return bin;
		} catch { /* not this one */ }
	}
	return null;
}

/**
 * @typedef {{svg: string, sizes: number[], prefix: string}} RasterJob
 */

/** @type {RasterJob[]} */
const JOBS = [
	{ svg: 'icon.svg', sizes: [16, 32, 48, 128], prefix: 'icon' },
	// Chrome's action.default_icon has no theme_icons equivalent (Decision 2)
	// — only the light glyph is needed; the dark-mode action.setIcon wiring
	// is the separately-landing platform.js piece.
	{ svg: 'tools-light.svg', sizes: [16, 32], prefix: 'tools-light' },
];

/**
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} svgMarkup
 * @param {number} size
 * @param {string} outPath
 */
async function rasterize(browser, svgMarkup, size, outPath) {
	const page = await browser.newPage();
	try {
		await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
		const html = `<!doctype html><html><head><style>
			html, body { margin: 0; padding: 0; background: transparent; }
			#wrap { width: ${size}px; height: ${size}px; }
			#wrap svg { display: block; width: 100%; height: 100%; }
		</style></head><body><div id="wrap">${svgMarkup}</div></body></html>`;
		await page.setContent(html, { waitUntil: 'load' });
		const wrap = await page.$('#wrap');
		if (!wrap) { throw new Error('rasterize: #wrap element missing'); }
		const buffer = await wrap.screenshot({ omitBackground: true });
		fs.writeFileSync(outPath, buffer);
	} finally {
		await page.close();
	}
}

async function main() {
	const bin = resolveChromeBinary();
	if (!bin) {
		console.error('[rasterize-icons] x no Chrome binary found ($CHROME_BIN or the Puppeteer cache).');
		console.error('[rasterize-icons]   Run `pnpm chrome:provision` (Chrome for Testing) or set CHROME_BIN.');
		process.exit(1);
	}

	fs.mkdirSync(outDir, { recursive: true });

	const browser = await puppeteer.launch({ executablePath: bin, headless: true });
	try {
		for (const job of JOBS) {
			const svgMarkup = fs.readFileSync(path.join(imagesDir, job.svg), 'utf8');
			for (const size of job.sizes) {
				const outPath = path.join(outDir, `${job.prefix}-${size}.png`);
				await rasterize(browser, svgMarkup, size, outPath);
				console.log(`[rasterize-icons] wrote ${path.relative(root, outPath)}`);
			}
		}
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error('[rasterize-icons] failed:', err);
	process.exit(1);
});
