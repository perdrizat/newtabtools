#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Preinstall guard: enforce pnpm as the package manager.
 *
 * Defense in depth alongside the `packageManager` field in package.json
 * (which corepack reads to fetch the right pnpm version). The `.npmrc`
 * `minimum-release-age` supply-chain guard is a pnpm-native feature; running
 * npm or yarn here would silently bypass it. So we abort early instead.
 */

const execpath = process.env.npm_execpath || '';
if (!/pnpm/i.test(execpath)) {
	console.error('');
	console.error('  This project uses pnpm, not npm or yarn.');
	console.error('  (Needed for the `.npmrc` minimum-release-age supply-chain guard.)');
	console.error('');
	console.error('  One-time setup:');
	console.error('    corepack enable');
	console.error('    corepack prepare pnpm@<version-from-package.json> --activate');
	console.error('');
	console.error('  Then: pnpm install');
	console.error('');
	process.exit(1);
}
