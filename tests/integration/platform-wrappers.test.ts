/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * chrome-prep C5b (CHROME_PREP.md, `audit/2026-07-11-chrome-api-divergence.md`):
 * unit coverage for lib/platform.js's new wrappers. Each is a thin pass-
 * through today (Firefox behavior unchanged, Chrome paths dormant/unwired) —
 * this suite pins the delegation itself, not any gating logic (the gating
 * wrapper, menus presence, is covered by event-page-menus-gate.test.ts
 * instead, since it needs to observe lib/background-main.js's top-level
 * registrations rather than a pure function).
 */

import { describe, it, expect, vi } from 'vitest';
import {
	sessionGet,
	sessionSet,
	isCaptureAvailable,
	isCaptureAvailableViaPermission,
	isCaptureAvailableForScope,
	syncActionIconWithTheme,
} from '../../webextension/lib/platform.js';

describe('sessionGet/sessionSet (storage.session wrapper)', () => {
	it('sessionGet delegates to api.storage.session.get with the same argument', async () => {
		const getMock = vi.fn().mockResolvedValue({ foo: 'bar' });
		const original = (globalThis as any).browser.storage.session.get;
		(globalThis as any).browser.storage.session.get = getMock;
		try {
			const result = await sessionGet('foo');
			expect(getMock).toHaveBeenCalledWith('foo');
			expect(result).toEqual({ foo: 'bar' });
		} finally {
			(globalThis as any).browser.storage.session.get = original;
		}
	});

	it('sessionSet delegates to api.storage.session.set with the same argument', async () => {
		const setMock = vi.fn().mockResolvedValue(undefined);
		const original = (globalThis as any).browser.storage.session.set;
		(globalThis as any).browser.storage.session.set = setMock;
		try {
			await sessionSet({ foo: 'bar' });
			expect(setMock).toHaveBeenCalledWith({ foo: 'bar' });
		} finally {
			(globalThis as any).browser.storage.session.set = original;
		}
	});
});

describe('isCaptureAvailable / isCaptureAvailableViaPermission (capture-availability wrapper)', () => {
	it('isCaptureAvailable keeps the typeof-probe as the sole Firefox check (unchanged)', () => {
		const original = (globalThis as any).browser.tabs.captureVisibleTab;
		(globalThis as any).browser.tabs.captureVisibleTab = undefined;
		try {
			expect(isCaptureAvailable()).toBe(false);
		} finally {
			(globalThis as any).browser.tabs.captureVisibleTab = original;
		}
	});

	it('isCaptureAvailable returns true when captureVisibleTab is a function, independent of permission state', () => {
		(globalThis as any).browser.tabs.captureVisibleTab = vi.fn();
		expect(isCaptureAvailable()).toBe(true);
	});

	it('isCaptureAvailableViaPermission is the Chrome-dormant fork: delegates to the permission check, not the typeof probe', async () => {
		const containsMock = vi.fn().mockResolvedValue(true);
		const original = (globalThis as any).browser.permissions.contains;
		(globalThis as any).browser.permissions.contains = containsMock;
		// Even with captureVisibleTab hidden (Firefox no-permission state), the
		// permission-based check reflects the permission grant, not the probe.
		const originalCapture = (globalThis as any).browser.tabs.captureVisibleTab;
		(globalThis as any).browser.tabs.captureVisibleTab = undefined;
		try {
			const result = await isCaptureAvailableViaPermission();
			expect(containsMock).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
			expect(result).toBe(true);
		} finally {
			(globalThis as any).browser.permissions.contains = original;
			(globalThis as any).browser.tabs.captureVisibleTab = originalCapture;
		}
	});
});

describe('isCaptureAvailableForScope (CHROME.md D3 slice 1: the scope fork lib/capture.js actually calls)', () => {
	it('DOM scope (isServiceWorkerScope=false, the Firefox event page case): delegates to the typeof probe and never touches the permission API', async () => {
		(globalThis as any).browser.tabs.captureVisibleTab = vi.fn();
		const containsMock = vi.fn().mockResolvedValue(true);
		const original = (globalThis as any).browser.permissions.contains;
		(globalThis as any).browser.permissions.contains = containsMock;
		try {
			const result = await isCaptureAvailableForScope(false);
			expect(result).toBe(true);
			expect(containsMock).not.toHaveBeenCalled();
		} finally {
			(globalThis as any).browser.permissions.contains = original;
		}
	});

	it('service-worker scope (isServiceWorkerScope=true, the Chrome case): delegates to the permission-based check, ignoring captureVisibleTab presence', async () => {
		// Chrome always defines captureVisibleTab (never hides it) — set it so a
		// wrongly-still-typeof-probing implementation would misreport "available".
		(globalThis as any).browser.tabs.captureVisibleTab = vi.fn();
		const containsMock = vi.fn().mockResolvedValue(false);
		const original = (globalThis as any).browser.permissions.contains;
		(globalThis as any).browser.permissions.contains = containsMock;
		try {
			const result = await isCaptureAvailableForScope(true);
			expect(containsMock).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
			expect(result).toBe(false);
		} finally {
			(globalThis as any).browser.permissions.contains = original;
		}
	});
});

describe('syncActionIconWithTheme (CHROME.md D4: the Chrome action-icon relay)', () => {
	it('Firefox (isServiceWorkerScope=false): stays a no-op — theme_icons already handles it declaratively', () => {
		const setIconMock = vi.fn();
		(globalThis as any).browser.action.setIcon = setIconMock;
		expect(syncActionIconWithTheme(true, false)).toBeUndefined();
		expect(syncActionIconWithTheme(false, false)).toBeUndefined();
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('Firefox (isServiceWorkerScope omitted, the pre-Chrome call shape): stays a no-op', () => {
		const setIconMock = vi.fn();
		(globalThis as any).browser.action.setIcon = setIconMock;
		expect(syncActionIconWithTheme()).toBeUndefined();
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('Chrome service worker (isServiceWorkerScope=true) + dark scheme: setIcon called with the tools-dark path map', () => {
		const setIconMock = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).browser.action.setIcon = setIconMock;
		syncActionIconWithTheme(true, true);
		expect(setIconMock).toHaveBeenCalledWith({
			path: { 16: 'images/tools-dark-16.png', 32: 'images/tools-dark-32.png' },
		});
	});

	it('Chrome service worker (isServiceWorkerScope=true) + light scheme: setIcon called with the tools-light path map', () => {
		const setIconMock = vi.fn().mockResolvedValue(undefined);
		(globalThis as any).browser.action.setIcon = setIconMock;
		syncActionIconWithTheme(false, true);
		expect(setIconMock).toHaveBeenCalledWith({
			path: { 16: 'images/tools-light-16.png', 32: 'images/tools-light-32.png' },
		});
	});

	it('Chrome service worker: a rejected setIcon is caught, never thrown/unhandled', async () => {
		const setIconMock = vi.fn().mockRejectedValue(new Error('teardown'));
		(globalThis as any).browser.action.setIcon = setIconMock;
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(() => syncActionIconWithTheme(true, true)).not.toThrow();
		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		errorSpy.mockRestore();
	});
});
