/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `tests/uat/_tools/uat-browsers.mjs` — the single registry of UAT browsers
 * and their per-browser configuration (daemon port, health timeout, artifact
 * suffix, extension URL scheme).
 *
 * Every UAT tool resolves its browser through this module. An unknown browser
 * name throws instead of falling back to Firefox, and a tool that does not
 * implement a registered browser says so by name.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
	UAT_BROWSERS,
	DEFAULT_UAT_BROWSER,
	RESERVED_E2E_PORTS,
	resolveUatEnv,
	uatChildEnv,
} from '../uat/_tools/uat-browsers.mjs';
import { newTabURL } from '../uat/_tools/urls.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(__dirname, '../uat/_tools');
const ROOT = path.resolve(__dirname, '../..');

/** The port each E2E tier's own launcher actually uses. */
function e2ePortsFromLaunchers(): number[] {
	const firefox = fs.readFileSync(path.join(ROOT, 'tests/e2e/run_esr_tests.sh'), 'utf8').match(/^PORT=(\d+)$/m);
	const chrome = fs.readFileSync(path.join(ROOT, 'tests/e2e-chrome/_tools/launch-chrome.mjs'), 'utf8').match(/^const PORT = (\d+);$/m);
	if (!firefox || !chrome) {
		throw new Error('could not find the PORT assignment in an E2E launcher — update this test to match');
	}
	return [Number(firefox[1]), Number(chrome[1])];
}

describe('UAT_BROWSERS registry', () => {
	it('registers firefox and chrome', () => {
		expect(Object.keys(UAT_BROWSERS).sort()).toEqual(['chrome', 'firefox']);
	});

	it('defaults to firefox', () => {
		expect(DEFAULT_UAT_BROWSER).toBe('firefox');
		expect(UAT_BROWSERS).toHaveProperty(DEFAULT_UAT_BROWSER);
	});

	it('gives every browser a unique daemon port', () => {
		const ports = Object.values(UAT_BROWSERS).map(b => b.port);
		expect(new Set(ports).size).toBe(ports.length);
	});

	it('reserves exactly the ports the E2E launchers use', () => {
		expect([...RESERVED_E2E_PORTS].sort()).toEqual(e2ePortsFromLaunchers().sort());
	});

	it('keeps every daemon port clear of the E2E tiers', () => {
		for (const { port } of Object.values(UAT_BROWSERS)) {
			expect(RESERVED_E2E_PORTS).not.toContain(port);
		}
	});

	it('gives every browser a unique artifact suffix', () => {
		const suffixes = Object.values(UAT_BROWSERS).map(b => b.artifactSuffix);
		expect(new Set(suffixes).size).toBe(suffixes.length);
	});

	it('defines every field for every browser', () => {
		for (const profile of Object.values(UAT_BROWSERS)) {
			expect(profile.port).toEqual(expect.any(Number));
			expect(profile.healthTimeoutMs).toBeGreaterThan(0);
			expect(profile.artifactSuffix).toMatch(/^[a-z]+$/);
			expect(profile.extensionScheme).toMatch(/^[a-z-]+$/);
		}
	});

	it('is frozen', () => {
		expect(Object.isFrozen(UAT_BROWSERS)).toBe(true);
		for (const profile of Object.values(UAT_BROWSERS)) {
			expect(Object.isFrozen(profile)).toBe(true);
		}
	});
});

describe('resolveUatEnv', () => {
	it('resolves firefox when UAT_BROWSER is unset', () => {
		const uat = resolveUatEnv({ env: {} });
		expect(uat.browser).toBe('firefox');
		expect(uat.port).toBe(UAT_BROWSERS.firefox.port);
		expect(uat.healthTimeoutMs).toBe(UAT_BROWSERS.firefox.healthTimeoutMs);
	});

	it('resolves firefox when UAT_BROWSER is empty', () => {
		expect(resolveUatEnv({ env: { UAT_BROWSER: '' } }).browser).toBe('firefox');
	});

	it('resolves chrome with chrome\'s own port and timeout', () => {
		const uat = resolveUatEnv({ env: { UAT_BROWSER: 'chrome' } });
		expect(uat.browser).toBe('chrome');
		expect(uat.port).toBe(UAT_BROWSERS.chrome.port);
		expect(uat.healthTimeoutMs).toBe(UAT_BROWSERS.chrome.healthTimeoutMs);
		expect(uat.artifactSuffix).toBe(UAT_BROWSERS.chrome.artifactSuffix);
	});

	it('throws on an unknown browser instead of falling back to firefox', () => {
		expect(() => resolveUatEnv({ env: { UAT_BROWSER: 'edge' } }))
			.toThrow(/unknown UAT_BROWSER "edge".*firefox.*chrome|unknown UAT_BROWSER "edge".*chrome.*firefox/);
	});

	it('is case-sensitive, so a typo is an error rather than a silent default', () => {
		expect(() => resolveUatEnv({ env: { UAT_BROWSER: 'Chrome' } })).toThrow(/unknown UAT_BROWSER "Chrome"/);
	});

	it('honours UAT_DAEMON_PORT', () => {
		expect(resolveUatEnv({ env: { UAT_BROWSER: 'chrome', UAT_DAEMON_PORT: '9999' } }).port).toBe(9999);
	});

	it('rejects a malformed UAT_DAEMON_PORT', () => {
		expect(() => resolveUatEnv({ env: { UAT_DAEMON_PORT: 'abc' } })).toThrow(/UAT_DAEMON_PORT/);
		expect(() => resolveUatEnv({ env: { UAT_DAEMON_PORT: '0' } })).toThrow(/UAT_DAEMON_PORT/);
		expect(() => resolveUatEnv({ env: { UAT_DAEMON_PORT: '70000' } })).toThrow(/UAT_DAEMON_PORT/);
	});

	it('lets a tool declare which browsers it implements', () => {
		expect(() => resolveUatEnv({ env: { UAT_BROWSER: 'chrome' }, tool: 'browser-smoke', supported: ['firefox'] }))
			.toThrow(/browser-smoke.*does not implement.*"chrome"/);
	});

	it('accepts a browser the tool implements', () => {
		const uat = resolveUatEnv({ env: { UAT_BROWSER: 'firefox' }, tool: 'browser-smoke', supported: ['firefox'] });
		expect(uat.browser).toBe('firefox');
	});

	it('rejects a supported list naming an unregistered browser', () => {
		expect(() => resolveUatEnv({ env: {}, tool: 'x', supported: ['firefox', 'edge'] }))
			.toThrow(/x.*unregistered.*edge/);
	});
});

describe('uatChildEnv', () => {
	it('pins UAT_BROWSER and UAT_DAEMON_PORT for a child process', () => {
		const uat = resolveUatEnv({ env: { UAT_BROWSER: 'chrome' } });
		const child = uatChildEnv(uat, { PATH: '/usr/bin' });
		expect(child.UAT_BROWSER).toBe('chrome');
		expect(child.UAT_DAEMON_PORT).toBe(String(UAT_BROWSERS.chrome.port));
		expect(child.PATH).toBe('/usr/bin');
	});

	it('overrides a stale UAT_DAEMON_PORT inherited from the parent', () => {
		const uat = resolveUatEnv({ env: { UAT_BROWSER: 'chrome' } });
		const child = uatChildEnv(uat, { UAT_DAEMON_PORT: '9876' });
		expect(child.UAT_DAEMON_PORT).toBe(String(UAT_BROWSERS.chrome.port));
	});

	it('merges extra variables last', () => {
		const uat = resolveUatEnv({ env: {} });
		expect(uatChildEnv(uat, {}, { ARTIFACTS_DIR: '/x' }).ARTIFACTS_DIR).toBe('/x');
	});
});

describe('newTabURL', () => {
	it('builds each registered browser\'s extension origin from the registry scheme', () => {
		for (const [name, profile] of Object.entries(UAT_BROWSERS)) {
			expect(newTabURL('abc', name)).toBe(`${profile.extensionScheme}://abc/newTab.html`);
		}
	});

	it('still defaults to firefox for single-argument callers', () => {
		expect(newTabURL('abc')).toBe('moz-extension://abc/newTab.html');
	});

	it('throws on an unknown browser', () => {
		expect(() => newTabURL('abc', 'edge')).toThrow(/unknown UAT_BROWSER "edge"/);
	});
});

describe('UAT tools resolve their browser only through the registry', () => {
	const files = fs.readdirSync(TOOLS_DIR)
		.filter(f => f.endsWith('.mjs') && f !== 'uat-browsers.mjs');
	const ports = Object.values(UAT_BROWSERS).map(b => String(b.port));

	it.each(files)('%s does not read process.env.UAT_BROWSER directly', file => {
		const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
		expect(src).not.toMatch(/process\.env\.UAT_BROWSER/);
	});

	it.each(files)('%s hardcodes no daemon port', file => {
		const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
		for (const port of ports) {
			expect(src).not.toMatch(new RegExp(`\\b${port}\\b`));
		}
	});

	it.each(files)('%s never treats "not chrome" or "not firefox" as the other browser', file => {
		const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
		expect(src).not.toMatch(/!==?\s*['"](chrome|firefox)['"]/);
	});
});
