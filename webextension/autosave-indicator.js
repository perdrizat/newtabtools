/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): `formatRelativeTime`/
// `_renderAutoSavedIndicator`/`_markAutoSaved`/`_initAutoSaveIndicator`
// extracted verbatim from newTab.js. `_autoSavedAt`/`_autoSaveTickInterval`
// (newTab.js's former `this.` state) become explicit module state. No
// `uiRefs` reads: the drawer footer message node is looked up directly by
// id (`ntt-drawer-footer-msg`), the same as the original — it was never one
// of newTab.js's `uiElements` table entries. A leaf module: never imports
// newTab.js, never calls updateUI. `_markAutoSaved` is called directly by
// page-main.js's `Prefs.onChange` listener (previously `newTabTools.
// _markAutoSaved()`) — see page-main.js's own updated import.
import { getString } from './common.js';

/**
 * Timestamp of the last auto-save (_markAutoSaved/_renderAutoSavedIndicator).
 * @type {number | null}
 */
let _autoSavedAt = null;
/**
 * Interval id for the auto-saved-indicator relative-time tick
 * (_initAutoSaveIndicator). `ReturnType<typeof setInterval>` rather than
 * `number`: this program's `types` array includes `"node"` alongside
 * `"dom"` (for the test-side vitest/Node surface), so ambient
 * `setInterval` resolves to Node's `Timeout`-returning overload here even
 * though this file runs in the browser page, where it's really a
 * `number` — deriving the type sidesteps the conflict either way.
 * @type {ReturnType<typeof setInterval> | undefined}
 */
let _autoSaveTickInterval;

/**
 * @param {number} elapsedMs
 * @returns {string}
 */
export function formatRelativeTime(elapsedMs) {
	// Used by the drawer's auto-save indicator. Returns the localised
	// "just now" / "Nm ago" / "Nh ago" string for the elapsed time.
	if (elapsedMs < 60000) {
		return getString('autosaved_relative_now');
	}
	if (elapsedMs < 3600000) {
		let minutes = Math.floor(elapsedMs / 60000);
		return getString('autosaved_relative_minutes', String(minutes));
	}
	let hours = Math.floor(elapsedMs / 3600000);
	return getString('autosaved_relative_hours', String(hours));
}

export function _renderAutoSavedIndicator() {
	let el = document.getElementById('ntt-drawer-footer-msg');
	if (!el) {
		return;
	}
	if (!_autoSavedAt) {
		// No real save has happened yet — hide the indicator instead
		// of showing a misleading "just now" on a fresh page.
		el.hidden = true;
		el.textContent = '';
		return;
	}
	el.hidden = false;
	let elapsed = Date.now() - _autoSavedAt;
	el.textContent = `${getString('options_autosaved')} · ${formatRelativeTime(elapsed)}`;
}

export function _markAutoSaved() {
	_autoSavedAt = Date.now();
	_renderAutoSavedIndicator();
}

export function _initAutoSaveIndicator() {
	// Don't seed `_autoSavedAt` on init — wait for the first real
	// prefs change. The indicator stays hidden until then.
	_autoSavedAt = null;
	_renderAutoSavedIndicator();
	if (_autoSaveTickInterval) {
		clearInterval(_autoSaveTickInterval);
	}
	// Tick once a minute so the relative timestamp advances without
	// needing further pref activity.
	_autoSaveTickInterval = setInterval(
		() => _renderAutoSavedIndicator(),
		60000
	);
}
