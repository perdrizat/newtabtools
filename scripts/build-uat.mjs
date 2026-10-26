import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DIST, stageBuild } from './stage.mjs';

// The Firefox UAT package: the Firefox stage (scripts/stage.mjs) with its
// optional permissions promoted to required. MV3 splits permissions into API
// permissions (`permissions`/`optional_permissions`) and host permissions
// (`host_permissions`/`optional_host_permissions`, the latter not currently
// used but handled defensively if it ever is) — only the API side gets
// merged/promoted here; host_permissions is left alone (MV3_MIGRATION.md Slice D).
function promoteOptional(manifest) {
	const m = { ...manifest };
	if (m.optional_permissions) {
		m.permissions = [...(m.permissions || []), ...m.optional_permissions];
		delete m.optional_permissions;
	}
	if (m.optional_host_permissions) {
		m.host_permissions = [...(m.host_permissions || []), ...m.optional_host_permissions];
		delete m.optional_host_permissions;
	}
	return m;
}

const stageDir = stageBuild('firefox', path.join(DIST, '_stage', 'firefox-uat'), { patchManifest: promoteOptional });

// Bare `web-ext` (not `npx web-ext`): npx would fall back to fetching
// web-ext@latest (unpinned, no cooldown) from the registry if node_modules were
// missing/partial — a registry-fetch-and-execute path on every build. The
// pinned local binary is on PATH here, same as scripts/build.mjs (audit m10).
execSync(`web-ext build --source-dir "${stageDir}" --artifacts-dir "${DIST}" --filename "newtab_powertools-uat.zip" --overwrite-dest`, { stdio: 'inherit' });

fs.rmSync(stageDir, { recursive: true, force: true });
try {
	fs.rmdirSync(path.join(DIST, '_stage'));
} catch { /* not empty, or already gone */ }
