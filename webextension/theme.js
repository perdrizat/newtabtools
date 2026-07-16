/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

// chrome-prep C4d (CHROME_PREP.md): `updateThemeColours`/`getThemedImageURL`
// extracted verbatim from newTab.js, plus `parseColour` (moved alongside as
// its dominant consumer — `updateThemeColours` is its only caller). No
// `uiRefs` reads: neither function touches any newTab.html element by id.
// `_theme` (newTab.js's former `this._theme`) becomes explicit module state.
// A leaf module: never imports newTab.js, never calls updateUI.
import { Prefs } from './prefs.js';
import { api } from './api.js';

/**
 * Cached `browser.theme.getCurrent()`/`onUpdated` payload (updateThemeColours).
 * @type {browser._manifest.ThemeType | null | undefined}
 */
let _theme;

/**
 * @param {string} str
 * @returns {{r: number, g: number, b: number} | null}
 */
export function parseColour(str) {
	let parts = /^(hsl|rgb)a?\((\d+),\s*([\d.]+%?),\s*([\d.]+%?)/.exec(str);
	if (parts && parts[1] == 'rgb') {
		return {
			r: parseInt(parts[2], 10),
			g: parseInt(parts[3], 10),
			b: parseInt(parts[4], 10),
		};
	}

	if (parts && parts[1] == 'hsl') {
		let h = parseFloat(parts[2]) / 360;
		let s = parseFloat(parts[3]) / 100;
		let l = parseFloat(parts[4]) / 100;
		let r, g, b;

		if (s == 0){
			r = g = b = l;
		} else {
			/**
			 * @param {number} p
			 * @param {number} q
			 * @param {number} t
			 * @returns {number}
			 */
			function hue2rgb(p, q, t) {
				if (t < 0) {
					t += 1;
				}
				if (t > 1) {
					t -= 1;
				}
				if (t < 1/6) {
					return p + (q - p) * 6 * t;
				}
				if (t < 1/2) {
					return q;
				}
				if (t < 2/3) {
					return p + (q - p) * (2/3 - t) * 6;
				}
				return p;
			}

			let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			let p = 2 * l - q;
			r = hue2rgb(p, q, h + 1/3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1/3);
		}

		return {
			r: Math.round(r * 255),
			g: Math.round(g * 255),
			b: Math.round(b * 255),
		};
	}

	parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(str);
	if (parts) {
		return {
			r: parseInt(parts[1], 16),
			g: parseInt(parts[2], 16),
			b: parseInt(parts[3], 16),
		};
	}

	parts = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(str);
	if (parts) {
		return {
			r: parseInt(parts[1].repeat(2), 16),
			g: parseInt(parts[2].repeat(2), 16),
			b: parseInt(parts[3].repeat(2), 16),
		};
	}

	return null;
}

/** @param {browser.theme.ThemeUpdateInfo} [updateInfo] */
export async function updateThemeColours(updateInfo) {
	/** @type {Record<string, string | null>} */
	let properties = {
		'--back-opaque': null,
		'--contrast-opaque': null,
		'--contrast-transp': null,
		'--fore-opaque': null,
		'--fore-trans1': null,
		'--fore-transp': null,
		'--page-background': null,
	};

	if (Prefs.theme === 'system') {
		try {
			// chrome-prep D2 slice 2 (decision of record: `prefers-color-scheme`
			// is the base, `browser.theme` is a Firefox bonus — Chrome has no
			// `theme` namespace at all). `updateInfo` only ever arrives via the
			// `api.theme.onUpdated` listener, which newTab.js now registers
			// only when `'theme' in api` — so the `updateInfo` branch already
			// implies presence. The `getCurrent()` branch is the one that must
			// gate explicitly: falls straight to the null-theme path instead of
			// touching the absent namespace.
			if (updateInfo) {
				_theme = /** @type {browser._manifest.ThemeType} */ (updateInfo.theme);
			} else if ('theme' in api) {
				_theme = await api.theme.getCurrent();
			} else {
				_theme = null;
			}
		} catch (ex) {
			console.debug(ex);
			_theme = null;
		}
		// Firefox's default theme (and wallpaper-only themes) return colors:
		// null or omit the key entirely. Treat both as "no palette to apply"
		// and fall through to the designed NTT palette in tokens.css.
		let colors = _theme && _theme.colors;
		if (colors) {
			// `ThemeColor` can also be an RGB(A) tuple (legacy format);
			// `parseColour` only handles strings and this never guarded
			// against the tuple case — cast, reported not fixed
			// (chrome-prep C3c).
			let back = parseColour(/** @type {string} */ (colors.ntp_background || colors.toolbar));
			let fore = parseColour(/** @type {string} */ (colors.ntp_text || colors.toolbar_text));

			if (back && fore) {
				properties['--back-opaque'] = `rgb(${back.r}, ${back.g}, ${back.b})`;
				properties['--fore-opaque'] = `rgb(${fore.r}, ${fore.g}, ${fore.b})`;
				properties['--fore-trans1'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, 0.1)`;
				properties['--fore-transp'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, var(--opacity))`;
				properties['--page-background'] = `rgb(${back.r}, ${back.g}, ${back.b})`;

				let brightness = 0.299 * fore.r + 0.587 * fore.g + 0.114 * fore.b;
				if (brightness < 144) {
					properties['--contrast-opaque'] = 'rgb(255, 255, 255)';
					properties['--contrast-transp'] = 'rgba(255, 255, 255, var(--opacity))';
				} else {
					properties['--contrast-opaque'] = 'rgb(0, 0, 0)';
					properties['--contrast-transp'] = 'rgba(0, 0, 0, var(--opacity))';
				}
			}
		}
	} else {
		_theme = null;
	}

	for (let [key, value] of Object.entries(properties)) {
		document.documentElement.style.setProperty(key, value);
	}

	for (let [selector, name] of Object.entries({
		'.close-button': 'close',
		'button.arrow': 'arrow',
	})) {
		let url = await getThemedImageURL(name);
		for (let element of document.querySelectorAll(selector)) {
			/** @type {HTMLElement} */ (element).style.backgroundImage = /** @type {string} */ (url ? `url(${url})` : null);
		}
	}
}

/**
 * Relay this page's `prefers-color-scheme` reading to the background via the
 * `Theme.colorScheme` wire message (CHROME.md D4). A Chrome MV3 service
 * worker has no `window`/`matchMedia`, so it cannot read the OS/browser color
 * scheme itself for the toolbar-icon swap Firefox gets for free via manifest
 * `theme_icons` (see lib/platform.js's `syncActionIconWithTheme` for the
 * receiving end and the icon mapping it derives). Sent once at call time and
 * again on every `change` event, unconditionally of `Prefs.theme` — the
 * toolbar icon tracks the OS/browser scheme directly, the same signal
 * Firefox's `theme_icons` reacts to, independent of this page's own
 * light/dark/system color preference. Sent on both platforms rather than
 * gated on a Chrome/Firefox check: the Firefox background handler no-ops
 * (one code path, not a platform branch here).
 * @returns {void}
 */
export function _initThemeColorSchemeRelay() {
	let media = window.matchMedia('(prefers-color-scheme: dark)');
	function relay() {
		api.runtime.sendMessage({ name: 'Theme.colorScheme', dark: media.matches });
	}
	relay();
	media.addEventListener('change', relay);
}

/**
 * @param {string} name
 * @param {string} [theme]
 * @returns {Promise<string | null>}
 */
export async function getThemedImageURL(name, theme = Prefs.theme) {
	let effectiveTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
	let fore = document.documentElement.style.getPropertyValue('--fore-opaque');
	let back = document.documentElement.style.getPropertyValue('--back-opaque');

	if (!fore) {
		return null;
	}

	try {
		let request = await fetch(api.runtime.getURL(`images/${name}-${effectiveTheme}.svg`));
		let content = await request.text();
		content = content.replaceAll('#fff', fore);
		content = content.replaceAll('#1f364c', back);
		return 'data:image/svg+xml;base64,' + btoa(content);
	} catch (ex) {
		console.debug(ex);
		return null;
	}
}
