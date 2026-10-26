/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `tests/_browsers/registry.mjs` — the single registry of test browsers and
 * their per-tier configuration (default channel, port, health budget), shared
 * by the E2E and UAT tiers.
 *
 * Every tool resolves its browser through this module. An unknown browser
 * name throws instead of falling back to Firefox, a tool that does not
 * implement a registered browser says so by name, and the renamed legacy
 * variables fail loudly instead of being silently ignored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
	BROWSERS,
	TIERS,
	TARGETS,
	DEFAULT_BROWSER,
	tierPorts,
	resolveBrowserEnv,
	browserChildEnv,
	e2eArtifactsDir,
	newTabURL,
} from '../_browsers/registry.mjs';
import { FIREFOX_CHANNEL_BINARIES } from '../_browsers/firefox/firefox-env.mjs';
import { CHROME_CHANNELS } from '../_browsers/chrome/chrome-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BROWSERS_DIR = path.join(ROOT, 'tests/_browsers');
const REGISTRY = path.join(BROWSERS_DIR, 'registry.mjs');

const names = Object.keys(BROWSERS);
const allPorts = names.flatMap(b => TIERS.map(t => BROWSERS[b].tiers[t].port));

describe('BROWSERS registry', () => {
	it('registers firefox and chrome, defaulting to firefox', () => {
		expect([...names].sort()).toEqual(['chrome', 'firefox']);
		expect(DEFAULT_BROWSER).toBe('firefox');
	});

	it('defines the e2e and uat tiers', () => {
		expect([...TIERS]).toEqual(['e2e', 'uat']);
	});

	it('exports TARGETS matching registered browser names', () => {
		expect(TARGETS).toEqual(names);
	});

	it('pins the default channel per tier (CHROME.md Decision 12: production binary on E2E, current on UAT)', () => {
		expect(BROWSERS.firefox.tiers.e2e.channel).toBe('esr');
		expect(BROWSERS.firefox.tiers.uat.channel).toBe('release');
		expect(BROWSERS.chrome.tiers.e2e.channel).toBe('stable');
		expect(BROWSERS.chrome.tiers.uat.channel).toBe('cft');
	});

	it('gives every browser and tier a unique port', () => {
		expect(new Set(allPorts).size).toBe(allPorts.length);
	});

	it('keeps the established ports', () => {
		expect(tierPorts('e2e')).toEqual([9222, 9223]);
		expect(tierPorts('uat')).toEqual([9876, 9877]);
	});

	it('defines every field for every browser and tier', () => {
		for (const profile of Object.values(BROWSERS)) {
			expect(['gecko', 'chromium', 'webkit']).toContain(profile.engine);
			expect(profile.extensionScheme).toMatch(/^[a-z-]+$/);
			for (const tier of TIERS) {
				expect(profile.tiers[tier].channel).toMatch(/^[a-z]+$/);
				expect(profile.tiers[tier].port).toEqual(expect.any(Number));
			}
			expect(profile.tiers.uat.healthTimeoutMs).toBeGreaterThan(0);
		}
	});

	it('uses only browser names that are lowercase words (they become dir names and script suffixes)', () => {
		for (const name of names) {
			expect(name).toMatch(/^[a-z]+$/);
		}
	});

	it('is deeply frozen', () => {
		expect(Object.isFrozen(BROWSERS)).toBe(true);
		for (const profile of Object.values(BROWSERS)) {
			expect(Object.isFrozen(profile)).toBe(true);
			expect(Object.isFrozen(profile.tiers)).toBe(true);
			for (const tier of TIERS) {
				expect(Object.isFrozen(profile.tiers[tier])).toBe(true);
			}
		}
	});
});

describe('per-browser channel resolvers cover every registered channel', () => {
	it('lists each browser\'s channels, including every tier default', () => {
		expect([...BROWSERS.firefox.channels]).toEqual(['esr', 'release']);
		expect([...BROWSERS.chrome.channels]).toEqual(['stable', 'cft']);
		for (const profile of Object.values(BROWSERS)) {
			expect(Object.isFrozen(profile.channels)).toBe(true);
			for (const tier of TIERS) {
				expect(profile.channels).toContain(profile.tiers[tier].channel);
			}
		}
	});

	it('firefox-env maps every firefox channel to a binary', () => {
		expect(Object.keys(FIREFOX_CHANNEL_BINARIES).sort()).toEqual([...BROWSERS.firefox.channels].sort());
	});

	it('chrome-env knows every chrome channel', () => {
		expect([...CHROME_CHANNELS].sort()).toEqual([...BROWSERS.chrome.channels].sort());
	});

	it('every registered browser has an E2E launcher hook', () => {
		for (const name of names) {
			expect(fs.existsSync(path.join(BROWSERS_DIR, name, 'e2e.sh'))).toBe(true);
		}
	});
});

describe('resolveBrowserEnv', () => {
	it('resolves the default browser when NTT_BROWSER is unset or empty', () => {
		expect(resolveBrowserEnv({ tier: 'e2e', env: {} }).browser).toBe('firefox');
		expect(resolveBrowserEnv({ tier: 'e2e', env: { NTT_BROWSER: '' } }).browser).toBe('firefox');
	});

	it('resolves the tier-specific channel and port', () => {
		const e2e = resolveBrowserEnv({ tier: 'e2e', env: {} });
		expect(e2e.channel).toBe('esr');
		expect(e2e.port).toBe(BROWSERS.firefox.tiers.e2e.port);
		const uat = resolveBrowserEnv({ tier: 'uat', env: { NTT_BROWSER: 'chrome' } });
		expect(uat.browser).toBe('chrome');
		expect(uat.engine).toBe('chromium');
		expect(uat.channel).toBe('cft');
		expect(uat.port).toBe(BROWSERS.chrome.tiers.uat.port);
		expect(uat.healthTimeoutMs).toBe(BROWSERS.chrome.tiers.uat.healthTimeoutMs);
	});

	it('requires a known tier', () => {
		expect(() => resolveBrowserEnv({ env: {} } as any)).toThrow(/tier/);
		expect(() => resolveBrowserEnv({ tier: 'compat' as any, env: {} })).toThrow(/unknown tier "compat"/);
	});

	it('throws on an unknown browser instead of falling back to firefox', () => {
		expect(() => resolveBrowserEnv({ tier: 'e2e', env: { NTT_BROWSER: 'edge' } }))
			.toThrow(/unknown NTT_BROWSER "edge".*firefox, chrome/);
	});

	it('is case-sensitive, so a typo is an error rather than a silent default', () => {
		expect(() => resolveBrowserEnv({ tier: 'e2e', env: { NTT_BROWSER: 'Chrome' } })).toThrow(/unknown NTT_BROWSER "Chrome"/);
	});

	it.each(['UAT_BROWSER', 'NTT_E2E_BROWSER', 'FIREFOX_ESR_BIN'])('refuses the renamed variable %s', name => {
		expect(() => resolveBrowserEnv({ tier: 'e2e', env: { [name]: 'x' } })).toThrow(new RegExp(`${name} was renamed`));
	});

	it('honours UAT_DAEMON_PORT on the uat tier only', () => {
		expect(resolveBrowserEnv({ tier: 'uat', env: { NTT_BROWSER: 'chrome', UAT_DAEMON_PORT: '9999' } }).port).toBe(9999);
		expect(resolveBrowserEnv({ tier: 'e2e', env: { UAT_DAEMON_PORT: '9999' } }).port).toBe(BROWSERS.firefox.tiers.e2e.port);
	});

	it('lets NTT_CHANNEL override the tier\'s default channel', () => {
		expect(resolveBrowserEnv({ tier: 'e2e', env: { NTT_CHANNEL: 'release' } }).channel).toBe('release');
		expect(resolveBrowserEnv({ tier: 'uat', env: { NTT_BROWSER: 'chrome', NTT_CHANNEL: 'stable' } }).channel).toBe('stable');
		expect(resolveBrowserEnv({ tier: 'e2e', env: { NTT_CHANNEL: '' } }).channel).toBe('esr');
	});

	it('rejects a channel the browser does not have', () => {
		expect(() => resolveBrowserEnv({ tier: 'e2e', env: { NTT_CHANNEL: 'cft' } }))
			.toThrow(/unknown NTT_CHANNEL "cft" for firefox.*esr, release/);
	});

	it('rejects a malformed UAT_DAEMON_PORT', () => {
		for (const bad of ['abc', '0', '70000']) {
			expect(() => resolveBrowserEnv({ tier: 'uat', env: { UAT_DAEMON_PORT: bad } })).toThrow(/UAT_DAEMON_PORT/);
		}
	});

	it('lets a tool declare which browsers it implements', () => {
		expect(() => resolveBrowserEnv({ tier: 'uat', env: { NTT_BROWSER: 'chrome' }, tool: 'browser-smoke', supported: ['firefox'] }))
			.toThrow(/browser-smoke.*does not implement.*"chrome"/);
		expect(resolveBrowserEnv({ tier: 'uat', env: { NTT_BROWSER: 'firefox' }, tool: 'browser-smoke', supported: ['firefox'] }).browser)
			.toBe('firefox');
	});

	it('rejects a supported list naming an unregistered browser', () => {
		expect(() => resolveBrowserEnv({ tier: 'uat', env: {}, tool: 'x', supported: ['firefox', 'edge'] }))
			.toThrow(/x.*unregistered.*edge/);
	});
});

describe('browserChildEnv', () => {
	it('pins NTT_BROWSER and, on the uat tier, UAT_DAEMON_PORT', () => {
		const uat = resolveBrowserEnv({ tier: 'uat', env: { NTT_BROWSER: 'chrome' } });
		const child = browserChildEnv(uat, { PATH: '/usr/bin', UAT_DAEMON_PORT: '9876' });
		expect(child.NTT_BROWSER).toBe('chrome');
		expect(child.UAT_DAEMON_PORT).toBe(String(BROWSERS.chrome.tiers.uat.port));
		expect(child.PATH).toBe('/usr/bin');
	});

	it('does not invent a UAT_DAEMON_PORT for the e2e tier', () => {
		const e2e = resolveBrowserEnv({ tier: 'e2e', env: {} });
		expect(browserChildEnv(e2e, {})).not.toHaveProperty('UAT_DAEMON_PORT');
	});

	it('merges extra variables last', () => {
		const uat = resolveBrowserEnv({ tier: 'uat', env: {} });
		expect(browserChildEnv(uat, {}, { ARTIFACTS_DIR: '/x' }).ARTIFACTS_DIR).toBe('/x');
	});
});

describe('naming helpers', () => {
	it('puts each browser\'s E2E artifacts under tests/e2e/_artifacts/<browser>', () => {
		for (const name of names) {
			expect(e2eArtifactsDir(name)).toBe(path.join(ROOT, 'tests/e2e/_artifacts', name));
		}
	});

	it('builds each browser\'s extension origin from the registry scheme', () => {
		for (const [name, profile] of Object.entries(BROWSERS)) {
			expect(newTabURL('abc', name)).toBe(`${profile.extensionScheme}://abc/newTab.html`);
		}
		expect(newTabURL('abc')).toBe('moz-extension://abc/newTab.html');
		expect(() => newTabURL('abc', 'edge')).toThrow(/unknown NTT_BROWSER "edge"/);
	});
});

describe('registry shell-env CLI (consumed by tests/e2e/run.sh)', () => {
	function shellEnv(env: Record<string, string>) {
		const clean = Object.fromEntries(Object.entries(process.env)
			.filter(([k]) => !['NTT_BROWSER', 'NTT_CHANNEL', 'UAT_BROWSER', 'NTT_E2E_BROWSER', 'FIREFOX_ESR_BIN'].includes(k)));
		return spawnSync(process.execPath, [REGISTRY, 'shell-env', 'e2e'], { encoding: 'utf8', env: { ...clean, ...env } });
	}

	it('prints quoted exports for the resolved browser', () => {
		const r = shellEnv({ NTT_BROWSER: 'chrome' });
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('export NTT_BROWSER=\'chrome\'');
		expect(r.stdout).toContain('export NTT_ENGINE=\'chromium\'');
		expect(r.stdout).toContain('export NTT_CHANNEL=\'stable\'');
		expect(r.stdout).toContain(`export NTT_E2E_PORT='${BROWSERS.chrome.tiers.e2e.port}'`);
		expect(r.stdout).toContain(`export NTT_E2E_ARTIFACTS_DIR='${e2eArtifactsDir('chrome')}'`);
	});

	it('exports the NTT_CHANNEL override, so the hook launches that channel', () => {
		const r = shellEnv({ NTT_BROWSER: 'firefox', NTT_CHANNEL: 'release' });
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('export NTT_CHANNEL=\'release\'');
	});

	it('exits non-zero with the registry error on an unknown browser', () => {
		const r = shellEnv({ NTT_BROWSER: 'edge' });
		expect(r.status).not.toBe(0);
		expect(r.stderr).toMatch(/unknown NTT_BROWSER "edge"/);
		expect(r.stdout).toBe('');
	});
});

describe('tools resolve their browser only through the registry', () => {
	const files = [
		...fs.readdirSync(path.join(ROOT, 'tests/uat/_tools')).filter(f => f.endsWith('.mjs')).map(f => `tests/uat/_tools/${f}`),
		...['firefox', 'chrome'].flatMap(b => fs.readdirSync(path.join(BROWSERS_DIR, b))
			.filter(f => /\.(mjs|sh)$/.test(f)).map(f => `tests/_browsers/${b}/${f}`)),
		'tests/e2e/_helpers.ts',
		'tests/e2e/run.sh',
	];
	const ports = allPorts.map(String);
	const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

	it.each(files)('%s does not read process.env.NTT_BROWSER directly', file => {
		expect(read(file)).not.toMatch(/process\.env\.NTT_BROWSER/);
	});

	it.each(files)('%s hardcodes no registry port', file => {
		const src = read(file);
		for (const port of ports) {
			expect(src).not.toMatch(new RegExp(`\\b${port}\\b`));
		}
	});

	it.each(files)('%s never treats "not chrome" or "not firefox" as the other browser', file => {
		expect(read(file)).not.toMatch(/!==?\s*['"](chrome|firefox)['"]/);
	});

	it('no E2E file branches on a browser name instead of the engine', () => {
		const e2eDir = path.join(ROOT, 'tests/e2e');
		for (const f of fs.readdirSync(e2eDir).filter(n => n.endsWith('.ts'))) {
			expect(fs.readFileSync(path.join(e2eDir, f), 'utf8'), f).not.toMatch(/\bIS_CHROME\b/);
		}
	});

	// Firefox's goto never resolves on moz-extension:// (compat/NOTEBOOK.md §3),
	// so a raw goto there costs its full timeout. Only _helpers.ts may call
	// goto, plus boot-timing, which fires it unawaited on purpose.
	it('E2E test files navigate via the helpers, not a raw page.goto', () => {
		const e2eDir = path.join(ROOT, 'tests/e2e');
		for (const f of fs.readdirSync(e2eDir).filter(n => n.endsWith('.test.ts') && n !== 'boot-timing.test.ts')) {
			expect(/\.goto\(/.test(fs.readFileSync(path.join(e2eDir, f), 'utf8')), f).toBe(false);
		}
	});
});

describe('package.json per-browser test scripts', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

	it('defines one script per registered browser for each tier command, and a combined one', () => {
		const commands: Record<string, (b: string) => string> = {
			'build': b => `node scripts/build.mjs ${b}`,
			'test:e2e': b => `tests/e2e/run.sh ${b}`,
			'test:uat': b => `NTT_BROWSER=${b} node tests/uat/_tools/runner.mjs`,
			'test:uat:preflight': b => `NTT_BROWSER=${b} node tests/uat/_tools/preflight.mjs`,
			'test:uat:smoke': b => `NTT_BROWSER=${b} node tests/uat/_tools/daemon-smoke.mjs`,
		};
		for (const [base, cmd] of Object.entries(commands)) {
			for (const b of names) {
				expect(pkg.scripts[`${base}:${b}`], `${base}:${b}`).toBe(cmd(b));
			}
			expect(pkg.scripts[base]).toBe(names.map(b => `pnpm ${base}:${b}`).join(' && '));
		}
	});

	it('runs the extension by hand with one dev:<browser> script per registered browser', () => {
		for (const b of names) {
			expect(pkg.scripts[`dev:${b}`], `dev:${b}`).toBeDefined();
		}
		expect(pkg.scripts.dev).toBeUndefined();
		expect(Object.keys(pkg.scripts).filter(k => k.startsWith('stage:'))).toEqual([]);
	});

	it('names every per-browser script command-first, browser last (build:chrome, not chrome:build)', () => {
		for (const key of Object.keys(pkg.scripts)) {
			for (const b of names) {
				expect(key.startsWith(`${b}:`), key).toBe(false);
			}
		}
	});

	it('has no abbreviated browser scripts left', () => {
		for (const key of Object.keys(pkg.scripts)) {
			expect(key).not.toMatch(/:(ff|cft)(:|$)/);
		}
	});
});
