/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Hand-written type declaration for the vendored @zip.js/zip.js "core" ESM
 * build (zip-core.js, this same directory), added in MODERNIZATION.md Stage
 * M slice M4 when webextension/lib/backup.js gained a real
 * `import * as zip from './zip/zip-core.js'` (replacing the old
 * globalThis.zip bridge, which tsc's checkJs never had to look through).
 *
 * Why this file exists: the vendored tree is real, untyped JS (its `Entry`
 * class assigns properties dynamically — `PROPERTY_NAMES.forEach(name =>
 * this[name] = data[name])` — so structural inference can't see
 * `.filename`/`.getData()` at all) that we deliberately don't fix or type by
 * our own rules (see tsconfig.json's exclude comment). Once an included file
 * does a REAL static import of it, though, tsc's "exclude doesn't stop
 * following a real import" gotcha means it would traverse the whole
 * transitive closure and report dozens of implicit-any errors on code we
 * don't own. A sibling `.d.ts` next to the `.js` it types is TypeScript's
 * standard shadowing mechanism for exactly this — tsc resolves the import to
 * this declaration file instead of parsing zip-core.js's own JS, so the
 * vendored tree's internals are never opened.
 *
 * This directory is otherwise fully regenerated (`rm -rf` then re-copy) by
 * scripts/update-zip.mjs on every `pnpm update-zip` run — that script reads
 * this file back out before the rm and writes it back afterward, so it
 * survives being NOT part of the vendored FILES list. Keep this in sync by
 * hand with what webextension/lib/backup.js actually calls; it only needs to
 * cover that surface, not the whole zip.js API.
 */

export function configure(options: { useWebWorkers?: boolean }): void;

export interface ZipEntry {
	filename: string;
	getData(writer: unknown): Promise<unknown>;
}

export class ZipWriter {
	constructor(writer: unknown, options?: unknown);
	add(name: string, reader: unknown, options?: unknown): Promise<ZipEntry>;
	close(comment?: unknown, options?: unknown): Promise<Blob>;
}

export class ZipReader {
	constructor(reader: unknown, options?: unknown);
	getEntries(options?: unknown): Promise<ZipEntry[]>;
}

export class BlobReader {
	constructor(blob: Blob);
}

export class BlobWriter {
	constructor(contentType?: string);
}

export class TextReader {
	constructor(text: string);
}

export class TextWriter {
	constructor(encoding?: string);
}
