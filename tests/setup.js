import { vi } from 'vitest';

// jest-webextension-mock calls `jest.fn(...)` at module load time, so we shim
// `globalThis.jest` to Vitest's `vi` (API-compatible) before importing it.
globalThis.jest = vi;

await import('jest-webextension-mock');

// jest-webextension-mock doesn't model `browser.menus` at all. Both
// lib/background-main.js (module-scope.test.ts) and the page's newTab.js
// (page-module-scope.test.ts) register menu listeners at import time, and
// each test file used to hand-roll its own differently-shaped ad-hoc mock
// (code review, 2026-07-10-page-modules-p1-code-review.md finding 7). This is
// the union of both shapes so either consumer's top-level registration calls
// succeed without throwing; `create` invokes its callback synchronously
// (matching module-scope.test.ts's usage, where lib/background-main.js's
// `browser.menus.create(props, callback)` call depends on the callback firing).
globalThis.browser.menus = {
	create: vi.fn((_props, cb) => { if (cb) { cb(); } }),
	update: vi.fn(),
	refresh: vi.fn(),
	onShown: { addListener: vi.fn() },
	onClicked: { addListener: vi.fn() },
};
