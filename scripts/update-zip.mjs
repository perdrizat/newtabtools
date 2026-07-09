#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vendor @zip.js/zip.js's real unbundled ESM "core" build into
 * webextension/lib/zip/.
 *
 * Background: the background page is a single ES-module entry
 * (webextension/lib/background-main.js, MODERNIZATION.md Decision 2 /
 * Stage M / slice M1). The formerly-vendored single-file UMD build
 * (webextension/lib/zip.js, a `dist/zip-core.min.js` copy) does not
 * reliably set `globalThis.zip` when loaded as an ES module — its
 * CommonJS/AMD/global-detection dance in the UMD wrapper is
 * bundler/loader-sensitive (spiked 2026-07-09, M1 Step 0: fails under the
 * Vitest/vite-node module runner). Vendoring the package's real unbundled
 * ESM entry sidesteps that ambiguity: genuine `import`/`export` syntax
 * behaves identically everywhere.
 *
 * `zip-core.js` is the "core" entry — no filesystem API (`zip-fs*`), no
 * WASM decompression fallback (`*-wasm.js`), no Node-native codecs
 * (`*-native.js`) — matching the browser-only, `useWebWorkers: false`
 * usage in webextension/lib/backup.js. FILES below is that entry's full
 * transitive `import`/`export … from` closure (computed by walking the
 * graph from zip-core.js; verified to exclude any `zip-fs*`/`*-wasm`/
 * `*-native`/eval/`new Function`/WebAssembly reference — see the M1 report
 * for the walk). Every file is copied byte-for-byte (own upstream license
 * header intact); nothing here is hand-edited.
 *
 * webextension/lib/backup.js (MODERNIZATION.md M4) imports this tree
 * directly (`import * as zip from './zip/zip-core.js'`) — no more
 * globalThis bridge. zip-core.d.ts (hand-written, see its own header
 * comment) is preserved across this script's rm+recopy below since it isn't
 * part of the vendored FILES list.
 *
 * No new dependency, no lockfile change — same `@zip.js/zip.js` devDependency
 * and exact pinned version as before; this only changes which of its
 * published files get copied into the shipped extension.
 *
 * Run via: pnpm update-zip
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = path.join(root, 'node_modules/@zip.js/zip.js');
const srcLib = path.join(pkgRoot, 'lib');
const destDir = path.join(root, 'webextension/lib/zip');
const legacySingleFile = path.join(root, 'webextension/lib/zip.js');

// The full transitive `import`/`export … from` closure of lib/zip-core.js,
// relative to node_modules/@zip.js/zip.js/lib/. Recomputed by re-running the
// walk below (kept here as the checked-in, human-reviewable result) whenever
// the pinned @zip.js/zip.js version bumps.
const FILES = [
	'core/codec-pool.js',
	'core/codec-worker.js',
	'core/configuration.js',
	'core/constants.js',
	'core/io.js',
	'core/options.js',
	'core/streams/aes-crypto-stream.js',
	'core/streams/codec-stream.js',
	'core/streams/codecs/crc32.js',
	'core/streams/codecs/sjcl.js',
	'core/streams/common-crypto.js',
	'core/streams/crc32-stream.js',
	'core/streams/zip-crypto-stream.js',
	'core/streams/zip-entry-stream.js',
	'core/util/decode-cp437.js',
	'core/util/decode-text.js',
	'core/util/default-mime-type.js',
	'core/util/encode-text.js',
	'core/zip-entry.js',
	'core/zip-reader.js',
	'core/zip-writer.js',
	'zip-core-base.js',
	'zip-core-reader.js',
	'zip-core-writer.js',
	'zip-core.js',
];

/**
 * Re-walk the `import`/`export … from` graph starting at zip-core.js and
 * verify it matches FILES exactly — catches a version bump silently adding
 * or dropping a file this script doesn't know about.
 * @returns {string[]} sorted relative paths, POSIX separators.
 */
function walkClosure() {
	const visited = new Set();
	const queue = ['zip-core.js'];
	const fromRe = /from\s+["']([^"']+\.js)["']/g;
	while (queue.length) {
		const rel = queue.shift();
		if (visited.has(rel)) {
			continue;
		}
		visited.add(rel);
		const abs = path.join(srcLib, rel);
		const text = fs.readFileSync(abs, 'utf8');
		for (const m of text.matchAll(fromRe)) {
			const importRel = m[1];
			if (!importRel.startsWith('.')) {
				continue; // bare specifier — none expected in this closure
			}
			const resolved = path.posix.normalize(
				path.posix.join(path.posix.dirname(rel.split(path.sep).join('/')), importRel),
			);
			if (!visited.has(resolved)) {
				queue.push(resolved);
			}
		}
	}
	return [...visited].sort();
}

const version = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version;

const actual = walkClosure();
const expected = [...FILES].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
	console.error('update-zip: the zip-core.js import closure no longer matches the FILES list in scripts/update-zip.mjs.');
	console.error('  expected:', expected);
	console.error('  actual:  ', actual);
	console.error('Update FILES (and re-review for zip-fs*/*-wasm/*-native/eval/new Function/WebAssembly) before re-running.');
	process.exit(1);
}

// zip-core.d.ts (MODERNIZATION.md M4) is hand-written, not vendored — see its
// own header comment. It normally lives at destDir/zip-core.d.ts, which the
// rmSync below would otherwise delete; read it out first and write it back
// once the vendored FILES are back in place.
const typesFile = path.join(destDir, 'zip-core.d.ts');
const savedTypes = fs.existsSync(typesFile) ? fs.readFileSync(typesFile, 'utf8') : null;

fs.rmSync(destDir, { recursive: true, force: true });
for (const rel of FILES) {
	const src = path.join(srcLib, rel);
	const dest = path.join(destDir, rel);
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
}
if (savedTypes !== null) {
	fs.writeFileSync(typesFile, savedTypes);
} else {
	console.warn('update-zip: webextension/lib/zip/zip-core.d.ts was missing before this run — not restored. ' +
		'If this is not the file\'s first vendoring, check git history.');
}

fs.rmSync(legacySingleFile, { force: true });

console.log(`webextension/lib/zip/: vendored ${FILES.length} files from @zip.js/zip.js v${version} (core ESM build, no fs/wasm/native/worker-script).`);
