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

// A handful of fast-tier integration suites still read a bare `Prefs.foo`/
// `Tiles.foo`/`Filters.foo`/`Updater.foo` identifier as vm-harness plumbing —
// a fixture seeded via `globalThis.X = {...}` for a `vm`-extracted/sandboxed
// method body to read, not a page/production bridge (chrome-prep C3d retired
// every production `globalThis.X = X;` bridge assignment, and with it, the
// E2E/UAT harness's page-global reads — this allowlist no longer needs to
// cover those; see globals.d.ts's matching prune). Kept minimal: only the
// four names actually still read bare, grepped as of chrome-prep C3d.
const nttVmHarnessGlobals = {
	Filters: 'readonly',
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
		// Extracted ES modules under webextension/lib/, plus every webextension/
		// page file — all of them are now real ES modules, and every one of
		// them (including action.js) is loaded via `<script type="module">`
		// (PAGE_MODULES.md P1). Our own code (not the vendored zip.js library,
		// which is ignored above). page-main.js side-effect-imports the eight
		// page files and runs the hoisted boot sequence, so it needs `import`
		// syntax; icons.js/stats.js/tiles-shim.js (P2), common.js/prefs.js
		// (P3), awesomebar.js (P4), and newTab.js (P5) all gained real
		// `import`/`export` syntax in their own slice. action.js has no
		// `import`/`export` of its own (self-scoped, references only
		// chrome/browser APIs) but is still parsed as sourceType: 'module' here
		// to match how the browser actually loads it — there is no remaining
		// script-mode (`sourceType: 'script'`) webextension/*.js file, so the
		// former separate script-mode block (MODERNIZATION.md Stage M through
		// PAGE_MODULES.md P4) is retired; this is now the one block for all of
		// webextension/**/*.js.
		//
		// Every page file's `globalThis.X = X;` bridge assignment (once
		// TEST-ONLY as of P5, for E2E/UAT page-context evaluation and any
		// fast-tier suite reading a bare identifier off a computed-path
		// dynamic import) is deleted as of chrome-prep C3d: the E2E/UAT
		// harness now drives the real page via runtime messages/
		// `browser.storage.local`/DOM observation/synthesized DOM events
		// instead of page globals, so zero bridge assignments remain in this
		// glob's files.
		files: ['webextension/**/*.js'],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'module',
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
		// Chrome-prep C1 guard: the background scope (webextension/lib/**)
		// runs as a Firefox event page today (full DOM/window/canvas access)
		// but must stay portable to a future Chrome MV3 service worker, which
		// has none of that. lib/thumbnail-image.js is the one designated
		// Chrome-swap seam (CHROME_PREP.md C1) — everything else in lib/ must
		// stay DOM/canvas-free so a Chrome port only has to fork that one
		// file. zip/** is vendored and already globally ignored above; listed
		// again here so this entry is self-contained and obviously correct.
		files: ['webextension/lib/**/*.js'],
		ignores: ['webextension/lib/thumbnail-image.js', 'webextension/lib/zip/**'],
		rules: {
			'no-restricted-globals': [2,
				{ name: 'document', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
				{ name: 'window', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
				{ name: 'Image', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
				{ name: 'OffscreenCanvas', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
				{ name: 'DOMParser', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
				{ name: 'XMLSerializer', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
				{ name: 'localStorage', message: 'DOM/canvas work belongs in lib/thumbnail-image.js — CHROME_PREP.md C1.' },
			],
		},
	},
	{
		// E2E tests and helpers. These run in Node but often contain
		// evaluate() blocks that run in the browser, plus Puppeteer's
		// own browser-like API. Extension-specific globals (Prefs, Grid,
		// Tiles, etc.) needed no allowlist here as of chrome-prep C3d: the
		// E2E/UAT harness no longer reads page-context globals (runtime
		// messages/storage/DOM/synthesized events instead), so the
		// `nttGlobals` allowlist that used to cover them was deleted.
		// tests/unit/_fixtures/*.mjs are Node child-process fixtures (the
		// raw-module-eval net, chrome-prep C3b) — same Node runtime profile.
		files: ['tests/e2e/**/*.js', 'tests/e2e/**/*.mjs', 'tests/uat/**/*.mjs', 'tests/unit/_fixtures/**/*.mjs', 'scripts/**/*.mjs'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.browser,
				...globals.vitest,
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
				...nttVmHarnessGlobals,
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
