/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

const webExtGlobals = {
	...globals.browser,
	...globals.webextensions,
	browser: 'readonly',
	chrome: 'readonly',
};

// Extension-specific globals exposed on the new tab page and background page.
// Used inside page.evaluate() callbacks in E2E tests and in integration tests
// that load/mock the extension scripts.
const nttGlobals = {
	Background: 'readonly',
	Blocked: 'readonly',
	Drag: 'readonly',
	DropTargetShim: 'readonly',
	Filters: 'readonly',
	Grid: 'readonly',
	newTabTools: 'readonly',
	Page: 'readonly',
	Prefs: 'readonly',
	Tiles: 'readonly',
	Updater: 'readonly',
};

const projectRules = {
	'comma-dangle': [2, 'only-multiline'],
	'complexity': 0,
	'curly': 2,
	'indent': [2, 'tab', { SwitchCase: 0 }],
	'func-names': [2, 'never'],
	'no-case-declarations': 0,
	'no-inner-declarations': 0,
	'no-tabs': 0,
	'no-unused-vars': [2, { caughtErrors: 'none' }],
	'object-curly-newline': 2,
	'padded-blocks': [2, 'never'],
	'quotes': [2, 'single'],
	'semi': 2,
};

export default [
	{
		// Vendored zip.js library (minified dist from @zip.js/zip.js) — not subject to project style.
		// Firefox-generated test-profile and ephemeral artifact directories — not our code.
		ignores: [
			'webextension/lib/zip.js',
			'tests/e2e/test-profile/**',
			'tests/e2e/_artifacts/**',
		],
	},
	js.configs.recommended,
	{
		// Legacy script-tag files in webextension/, loaded via <script> in
		// newTab.xhtml and the MV2 background array.
		files: ['webextension/**/*.js'],
		languageOptions: {
			ecmaVersion: 2018,
			sourceType: 'script',
			globals: webExtGlobals,
		},
		rules: projectRules,
	},
	{
		// Extracted ES modules under webextension/lib/. Our own code (not the
		// vendored zip.js library, which is ignored above). These are written
		// as ES modules and consumed both by tests (via Vitest) and, in time,
		// by refactored portions of the legacy script-tag code.
		files: ['webextension/lib/**/*.js'],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'module',
			globals: webExtGlobals,
		},
		rules: projectRules,
	},
	{
		// E2E tests and helpers. These run in Node but often contain
		// evaluate() blocks that run in the browser, plus Puppeteer's
		// own browser-like API. nttGlobals covers extension-specific
		// objects (Prefs, Grid, Tiles, etc.) referenced in page.evaluate().
		files: ['tests/e2e/**/*.js', 'tests/e2e/**/*.mjs'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.browser,
				...globals.vitest,
				...nttGlobals,
				chrome: 'readonly',
			},
		},
		rules: {
			...projectRules,
			'no-console': 0, // Logging is expected in E2E tests
		},
	},
	{
		// TypeScript test files. New tests under tests/ are written in TS;
		// existing .test.js files keep working — convert opportunistically.
		// Production code in webextension/ stays JS (with JSDoc); see
		// MIGRATION.md "Language and type safety" for the rules.
		files: ['tests/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.browser,
				...globals.vitest,
				...nttGlobals,
				chrome: 'readonly',
				browser: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			...projectRules,
			// no-unused-vars is handled by the TS parser; the base rule
			// double-reports against TS-only constructs (interfaces,
			// type-only imports), so prefer the TS-aware version.
			'no-unused-vars': 0,
			'@typescript-eslint/no-unused-vars': [2, { caughtErrors: 'none', argsIgnorePattern: '^_' }],
			'no-console': 0,
		},
	},
];
