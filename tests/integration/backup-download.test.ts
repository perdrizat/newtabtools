/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Page-side backup download (CHROME.md D2, Decision 2a).
 *
 * The background's `Export:backup` handler returns the zip as a Blob +
 * filename over the wire (structured-clone messaging, Chrome 148+ floor —
 * audit m3/A-note); webextension/backup-download.js (page scope) creates the
 * blob URL from it, triggers the download, and revokes the URL once the
 * download reaches a terminal state — the per-download lifecycle that used to
 * live in lib/backup.js.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { downloadBackup, requestBackup } from '../../webextension/backup-download.js';

const PAYLOAD_BYTES = new Uint8Array(256).map((_, i) => i);
const PAYLOAD = { data: new Blob([PAYLOAD_BYTES], { type: 'application/zip' }), filename: 'newtabtools.zip' };

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;
let mockDownloads: {
	download: ReturnType<typeof vi.fn>;
	onChanged: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> } | undefined;
};

beforeEach(() => {
	createSpy = vi.fn(() => 'blob:page-url');
	revokeSpy = vi.fn();
	(URL as any).createObjectURL = createSpy;
	(URL as any).revokeObjectURL = revokeSpy;
	mockDownloads = {
		download: vi.fn().mockResolvedValue(42),
		onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
	};
	(globalThis as any).chrome = {
		downloads: mockDownloads,
		runtime: { sendMessage: vi.fn() },
		i18n: { getMessage: vi.fn((key: string) => key) },
	};
	(globalThis as any).browser = (globalThis as any).chrome;
});

describe('downloadBackup — page-created object URL', () => {
	it('creates the object URL from the payload Blob and downloads via a page-created object URL', async () => {
		await downloadBackup(PAYLOAD);

		expect(createSpy).toHaveBeenCalledTimes(1);
		const blob = createSpy.mock.calls[0][0];
		expect(blob).toBeInstanceOf(Blob);
		// The Blob is used directly (no base64 decode) — same bytes as the wire.
		expect(blob).toBe(PAYLOAD.data);
		const roundTrip = new Uint8Array(await blob.arrayBuffer());
		expect(Array.from(roundTrip)).toEqual(Array.from(PAYLOAD_BYTES));

		expect(mockDownloads.download).toHaveBeenCalledWith({
			url: 'blob:page-url',
			filename: 'newtabtools.zip',
			saveAs: true,
		});
	});

	it('uses the wire payload filename', async () => {
		await downloadBackup({ data: PAYLOAD.data, filename: 'other.zip' });
		expect(mockDownloads.download).toHaveBeenCalledWith(
			expect.objectContaining({ filename: 'other.zip' }),
		);
	});

	it('registers an onChanged listener and revokes the URL when the download reaches "complete"', async () => {
		mockDownloads.download.mockResolvedValueOnce(101);

		await downloadBackup(PAYLOAD);
		expect(mockDownloads.onChanged!.addListener).toHaveBeenCalledTimes(1);
		expect(revokeSpy).not.toHaveBeenCalled();

		const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];
		onChangedListener({ id: 101, state: { current: 'complete' } });

		expect(revokeSpy).toHaveBeenCalledWith('blob:page-url');
		expect(mockDownloads.onChanged!.removeListener).toHaveBeenCalledWith(onChangedListener);
	});

	it('revokes the URL when the download reaches "interrupted"', async () => {
		mockDownloads.download.mockResolvedValueOnce(102);

		await downloadBackup(PAYLOAD);
		const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];
		onChangedListener({ id: 102, state: { current: 'interrupted' } });

		expect(revokeSpy).toHaveBeenCalledWith('blob:page-url');
	});

	it('ignores onChanged events for a different download id', async () => {
		mockDownloads.download.mockResolvedValueOnce(103);

		await downloadBackup(PAYLOAD);
		const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];
		onChangedListener({ id: 999, state: { current: 'complete' } });

		expect(revokeSpy).not.toHaveBeenCalled();
	});

	it('ignores a non-terminal state change (e.g. "in_progress") for the same download id', async () => {
		mockDownloads.download.mockResolvedValueOnce(104);

		await downloadBackup(PAYLOAD);
		const onChangedListener = mockDownloads.onChanged!.addListener.mock.calls[0][0];
		onChangedListener({ id: 104, state: { current: 'in_progress' } });

		expect(revokeSpy).not.toHaveBeenCalled();
	});

	it('revokes immediately and rethrows when downloads.download rejects', async () => {
		mockDownloads.download.mockRejectedValueOnce(new Error('download failed'));

		await expect(downloadBackup(PAYLOAD)).rejects.toThrow('download failed');

		expect(revokeSpy).toHaveBeenCalledWith('blob:page-url');
		expect(mockDownloads.onChanged!.removeListener).toHaveBeenCalled();
	});

	it('does not throw when downloads.onChanged is absent (defensive guard)', async () => {
		mockDownloads.onChanged = undefined;

		await expect(downloadBackup(PAYLOAD)).resolves.toBeDefined();
	});

	it('rejects and revokes when the optional downloads permission is not granted (api.downloads undefined)', async () => {
		delete (globalThis as any).chrome.downloads;

		await expect(downloadBackup(PAYLOAD)).rejects.toThrow();

		expect(revokeSpy).toHaveBeenCalledWith('blob:page-url');
	});
});

describe('requestBackup — Export:backup round-trip into the download', () => {
	it('sends Export:backup and downloads the returned payload', async () => {
		(globalThis as any).chrome.runtime.sendMessage = vi.fn(
			(_msg: unknown, cb: (response: unknown) => void) => cb(PAYLOAD),
		);

		requestBackup();

		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			{ name: 'Export:backup' },
			expect.any(Function),
		);
		await vi.waitFor(() => expect(mockDownloads.download).toHaveBeenCalledTimes(1));
	});

	it('does nothing when the background responds null (makeZip failed)', async () => {
		(globalThis as any).chrome.runtime.sendMessage = vi.fn(
			(_msg: unknown, cb: (response: unknown) => void) => cb(null),
		);

		requestBackup();

		await Promise.resolve();
		expect(createSpy).not.toHaveBeenCalled();
		expect(mockDownloads.download).not.toHaveBeenCalled();
	});

	it('surfaces a user-visible alert when the response is falsy (audit m3: export failure must not fail silently)', async () => {
		(globalThis as any).chrome.runtime.lastError = undefined;
		(globalThis as any).chrome.runtime.sendMessage = vi.fn(
			(_msg: unknown, cb: (response: unknown) => void) => cb(null),
		);
		const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
		const getMessageSpy = vi.spyOn((globalThis as any).chrome.i18n, 'getMessage');

		requestBackup();
		await Promise.resolve();

		expect(getMessageSpy).toHaveBeenCalledWith('backup_export_failed');
		expect(alertSpy).toHaveBeenCalledWith('backup_export_failed');
		expect(mockDownloads.download).not.toHaveBeenCalled();

		alertSpy.mockRestore();
	});

	it('surfaces a user-visible alert when the response has no .data (Chrome oversize case, api.runtime.lastError set)', async () => {
		(globalThis as any).chrome.runtime.lastError = { message: 'Message length exceeded maximum allowed length.' };
		(globalThis as any).chrome.runtime.sendMessage = vi.fn(
			(_msg: unknown, cb: (response: unknown) => void) => cb(undefined),
		);
		const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});

		requestBackup();
		await Promise.resolve();

		expect(alertSpy).toHaveBeenCalledWith('backup_export_failed');
		expect(mockDownloads.download).not.toHaveBeenCalled();

		alertSpy.mockRestore();
		delete (globalThis as any).chrome.runtime.lastError;
	});

	it('logs instead of throwing when the download path fails', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockDownloads.download.mockRejectedValueOnce(new Error('no permission'));
		(globalThis as any).chrome.runtime.sendMessage = vi.fn(
			(_msg: unknown, cb: (response: unknown) => void) => cb(PAYLOAD),
		);

		requestBackup();

		await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
		consoleErrorSpy.mockRestore();
	});
});
