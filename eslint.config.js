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
	// ES2020 added `globalThis`; the webextension/**/*.js glob below pins
	// ecmaVersion to 2018 for parser compat with the rest of that glob, so it
	// isn't picked up automatically the way a newer ecmaVersion preset would.
	globalThis: 'readonly',
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

const nttPlugin = {
	rules: {
		'no-source-grep': {
			meta: {
				type: 'suggestion',
				messages: {
					avoid: 'Prefer behavioral tests over source-grep. If this is a legitimate wiring check or module load, add an eslint-disable comment with justification.',
				},
			},
			create(context) {
				return {
					CallExpression(node) {
						const { callee } = node;
						const isReadFileSync =
							(callee.type === 'MemberExpression' &&
								callee.property.type === 'Identifier' &&
								callee.property.name === 'readFileSync') ||
							(callee.type === 'Identifier' &&
								callee.name === 'readFileSync');

						if (!isReadFileSync || !node.arguments.length) {
							return;
						}

						const arg = node.arguments[0];

						if (arg.type === 'Literal' && typeof arg.value === 'string' &&
							arg.value.includes('webextension/')) {
							context.report({ node, messageId: 'avoid' });
							return;
						}

						if (arg.type === 'TemplateLiteral' &&
							arg.quasis.some(q => q.value.raw.includes('webextension/'))) {
							context.report({ node, messageId: 'avoid' });
							return;
						}

						if (arg.type === 'Identifier' && arg.name.endsWith('_PATH')) {
							context.report({ node, messageId: 'avoid' });
							return;
						}

						if (arg.type === 'CallExpression' &&
							arg.arguments.some(a =>
								a.type === 'Literal' && typeof a.value === 'string' &&
								a.value.includes('webextension/'))) {
							context.report({ node, messageId: 'avoid' });
						}
					},
				};
			},
		},
		'no-hardcoded-text': {
			meta: {
				type: 'problem',
				messages: {
					avoid: 'Do not assign hardcoded strings to textContent/innerText/innerHTML. Use browser.i18n.getMessage() instead.',
				},
			},
			create(context) {
				return {
					AssignmentExpression(node) {
						if (node.left.type === 'MemberExpression') {
							const propName = node.left.property.name;
							if (['textContent', 'innerText', 'innerHTML'].includes(propName)) {
								// Check if right side is a literal string with alphabetical chars
								if (node.right.type === 'Literal' && typeof node.right.value === 'string') {
									if (/[a-zA-Z]/.test(node.right.value)) {
										context.report({ node, messageId: 'avoid' });
									}
								}
								// Check if right side is a template literal with alphabetical chars
								if (node.right.type === 'TemplateLiteral') {
									if (node.right.quasis.some(q => /[a-zA-Z]/.test(q.value.raw))) {
										context.report({ node, messageId: 'avoid' });
									}
								}
							}
						}
					},
				};
			},
		},
	},
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
		// Vendored zip.js library (unbundled ESM "core" build from
		// @zip.js/zip.js, copied verbatim by scripts/update-zip.mjs) — not
		// subject to project style. Firefox-generated test-profile and
		// ephemeral artifact directories — not our code.
		ignores: [
			'webextension/lib/zip/**',
			'tests/e2e/test-profile/**',
			'tests/e2e/_artifacts/**',
			'tests/uat/artifacts/**',
			'dist/**',
		],
	},
	js.configs.recommended,
	{
		// Script-mode files in webextension/ (MODERNIZATION.md Stage M, slice
		// M5 — background.js and its tiles.js bridge shim are gone). This is
		// now exactly: the page files loaded via classic `<script>` in
		// newTab.xhtml (newTab.js, fx-newTab.js, icons.js, awesomebar.js,
		// stats.js, action.js, tiles-shim.js) plus common.js/prefs.js, the two
		// dual-scope bridge files (MODERNIZATION.md Decision 2) that are ALSO
		// side-effect-imported by lib/background-main.js (a real ES module) —
		// classic script syntax (`globalThis.X = …`, no `import`/`export`)
		// works identically either way, which is the whole point of the
		// bridge; it stays permanently, unlike the M1–M4 bridges this glob
		// used to also cover.
		files: ['webextension/**/*.js'],
		languageOptions: {
			ecmaVersion: 2018,
			sourceType: 'script',
			globals: webExtGlobals,
		},
		plugins: {
			'ntt': nttPlugin,
		},
		rules: {
			...projectRules,
			'ntt/no-hardcoded-text': 2,
		},
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
		files: ['tests/e2e/**/*.js', 'tests/e2e/**/*.mjs', 'tests/uat/**/*.mjs', 'scripts/**/*.mjs'],
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
			'no-console': 0, // Logging is expected in E2E tests + tooling scripts
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
			'ntt': nttPlugin,
		},
		rules: {
			...projectRules,
			// no-unused-vars is handled by the TS parser; the base rule
			// double-reports against TS-only constructs (interfaces,
			// type-only imports), so prefer the TS-aware version.
			'no-unused-vars': 0,
			'@typescript-eslint/no-unused-vars': [2, { caughtErrors: 'none', argsIgnorePattern: '^_' }],
			'no-console': 0,
			'ntt/no-source-grep': 2,
		},
	},
];
