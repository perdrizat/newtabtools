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

describe('syncActionIconWithTheme (action/theme-icon stub)', () => {
	it('is a documented no-op: does not call any action/theme API', () => {
		const enableSpy = vi.spyOn((globalThis as any).browser.action, 'enable');
		const setIconSpy = (globalThis as any).browser.action.setIcon
			? vi.spyOn((globalThis as any).browser.action, 'setIcon')
			: null;
		expect(syncActionIconWithTheme()).toBeUndefined();
		expect(enableSpy).not.toHaveBeenCalled();
		if (setIconSpy) {
			expect(setIconSpy).not.toHaveBeenCalled();
		}
		enableSpy.mockRestore();
	});
});
