/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * chrome-prep C5b (CHROME_PREP.md, Decision 1 / `audit/2026-07-11-chrome-api-
 * divergence.md` #5): Chrome has no `menus` namespace at all, so
 * lib/background-main.js's `createMenuTolerant()` calls and its
 * `menus.onShown`/`update`/`refresh` registration must not run — and must not
 * throw — when `api.menus` is absent. This is a SEPARATE test file (not an
 * addition to event-page-resilience.test.ts) because the assertion requires a
 * fresh import of lib/background-main.js with `browser.menus`/`chrome.menus`
 * deleted BEFORE the module's top-level code runs; vitest's per-file module
 * registry means a second `import()` of the same specifier within one file
 * would just return the already-evaluated (menus-present) instance from
 * another suite.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBEXT = path.resolve(__dirname, '../../webextension');
const EXTENSION_ID = 'newtabtools@symlink.ch';

function webext(relPath: string): string {
	return path.join(WEBEXT, relPath);
}

function mockCursorIteration(entries: Array<Record<string, unknown>> = []) {
	let index = 0;
	let handler: Function;
	const request: Record<string, unknown> = {};
	const advance = () => {
		if (index < entries.length) {
			const entry = entries[index++];
			const cursor = { value: { ...entry }, update: vi.fn(), continue: () => advance(), delete: vi.fn() };
			handler.call({ result: cursor });
		} else {
			handler.call({ result: null });
		}
	};
	Object.defineProperty(request, 'onsuccess', {
		set(cb: Function) { handler = cb; advance(); },
		configurable: true,
	});
	return request;
}

function installAutoResolvingIndexedDB() {
	const stores: Record<string, unknown> = {
		tiles: { put: vi.fn(), get: vi.fn(), getAll: vi.fn(), openCursor: vi.fn(() => mockCursorIteration()), createIndex: vi.fn(), indexNames: { contains: () => true } },
		thumbnails: { put: vi.fn(), get: vi.fn(), delete: vi.fn(), openCursor: vi.fn(() => mockCursorIteration()), index: vi.fn(() => ({ openCursor: vi.fn(() => mockCursorIteration()) })) },
		background: { put: vi.fn(), get: vi.fn() },
	};
	const mockDB = {
		objectStoreNames: { contains: (n: string) => n in stores },
		transaction: vi.fn(() => ({ objectStore: vi.fn((n: string) => stores[n]) })),
		createObjectStore: vi.fn(),
		close: vi.fn(),
	};
	const openMock = vi.fn(() => {
		const handlers: Record<string, Function> = {};
		const req: Record<string, unknown> = {};
		for (const prop of ['onsuccess', 'onblocked', 'onerror', 'onupgradeneeded']) {
			Object.defineProperty(req, prop, { set(cb: Function) { handlers[prop] = cb; }, configurable: true });
		}
		Promise.resolve().then(() => { handlers.onsuccess && handlers.onsuccess.call({ result: mockDB }); });
		return req;
	});
	(globalThis as any).indexedDB = { open: openMock };
}

describe('lib/background-main.js — menus presence-gate (Decision 1, no menus namespace on Chrome)', () => {
	let importError: unknown = null;

	beforeAll(async () => {
		installAutoResolvingIndexedDB();
		(globalThis as any).IDBKeyRange = { upperBound: vi.fn((v: unknown) => ({ upperBound: v })) };

		(globalThis as any).browser.runtime.id = EXTENSION_ID;
		(globalThis as any).chrome.runtime.getURL = vi.fn((p: string) => `moz-extension://test-uuid/${p}`);
		(globalThis as any).chrome.management = { getSelf: vi.fn().mockResolvedValue({ version: '1.0.0' }) };
		(globalThis as any).chrome.idle = { onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		(globalThis as any).chrome.webRequest = {
			onBeforeRequest: { addListener: vi.fn() },
			onCompleted: { addListener: vi.fn() },
			onErrorOccurred: { addListener: vi.fn() },
		};
		(globalThis as any).chrome.webNavigation = { onCompleted: { addListener: vi.fn() } };
		(globalThis as any).chrome.tabs.onActivated = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.onRemoved = { addListener: vi.fn() };
		(globalThis as any).chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).chrome.tabs.get = vi.fn().mockResolvedValue({});
		(globalThis as any).chrome.tabs.query = vi.fn().mockResolvedValue([]);
		(globalThis as any).chrome.i18n.getMessage = vi.fn((k: string) => k);
		(globalThis as any).chrome.permissions.contains = vi.fn().mockResolvedValue(true);
		(globalThis as any).chrome.action = { enable: vi.fn().mockResolvedValue(undefined), disable: vi.fn().mockResolvedValue(undefined) };
		(globalThis as any).browser.runtime.onStartup = { addListener: vi.fn() };
		(globalThis as any).browser.runtime.onInstalled = { addListener: vi.fn() };

		// The one deliberate deviation from every sibling suite's baseline:
		// no `menus` namespace at all (Decision 1 — Chrome has none).
		delete (globalThis as any).browser.menus;
		delete (globalThis as any).chrome.menus;

		try {
			await import(/* @vite-ignore */ webext('lib/background-main.js'));
		} catch (e) {
			importError = e;
		}
	});

	it('imports without throwing when api.menus is absent', () => {
		expect(importError).toBeNull();
	});

	it('registers nothing on the (absent) menus namespace — there is nothing to assert a call against, only that nothing threw above', () => {
		expect((globalThis as any).browser.menus).toBeUndefined();
		expect((globalThis as any).chrome.menus).toBeUndefined();
	});
});
