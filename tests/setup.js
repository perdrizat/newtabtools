import { vi } from 'vitest';

// jest-webextension-mock calls `jest.fn(...)` at module load time, so we shim
// `globalThis.jest` to Vitest's `vi` (API-compatible) before importing it.
globalThis.jest = vi;

await import('jest-webextension-mock');

// page-modules P5 (PAGE_MODULES.md): jest-webextension-mock's own default
// `chrome.i18n.getMessage` mock returns `Translated<${key}>` — harmless while
// `newTabTools`/`AwesomeBar` etc. were vm-loaded classic scripts whose test
// harnesses supplied their OWN `getString(name) { return name; }` stand-in
// (mountSite()'s old `newTabTools` stub, and several per-suite vm harnesses).
// Now that newTab.js is a real module with a real `getString` implementation
// (`chrome.i18n.getMessage(name, substitutions)`), any suite that natively
// imports it (mountSite, page-module-scope.test.ts, page-main-boot.test.ts,
// …) goes through this mock for real. Every suite whose assertions depend on
// `getString`'s return value assumed the bare key (never `Translated<...>`,
// which no suite in this repo asserts on — grepped) — overriding the mock to
// echo the key back keeps that assumption true instead of silently changing
// meaning under suites that migrate to a real import this slice.
globalThis.chrome.i18n.getMessage = vi.fn((key) => key);

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
