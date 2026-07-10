/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Raw-eval fixture for tests/unit/raw-module-eval.test.ts (chrome-prep C3b
// incident follow-up — see the test's header comment for the full story).
//
// Dynamically imports `webextension/page-main.js` in RAW Node — no vite/
// vitest module transform — which is the closest cheap approximation of how
// Firefox itself loads the page's ES-module graph. Prints a single JSON line
// describing the outcome so the parent test can assert on the error CLASS:
//
//   {"outcome":"evaluated"}                     — full graph evaluated (won't
//                                                 happen: page modules touch
//                                                 chrome/browser/document at
//                                                 top level, absent in Node)
//   {"outcome":"error","name":...,"message":...} — the graph threw; the test
//                                                 decides whether the error
//                                                 is the ACCEPTABLE kind
//                                                 (missing browser API) or a
//                                                 structural one (SyntaxError,
//                                                 TDZ ReferenceError).
//
// Always exits 0 — the assertion logic lives in the test, not here.

try {
	await import(new URL('../../../webextension/page-main.js', import.meta.url));
	console.log(JSON.stringify({ outcome: 'evaluated' }));
} catch (e) {
	console.log(JSON.stringify({
		outcome: 'error',
		name: e instanceof Error ? e.constructor.name : typeof e,
		message: e instanceof Error ? e.message.split('\n')[0] : String(e),
	}));
}
