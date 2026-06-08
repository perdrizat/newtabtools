import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'dist', 'uat-build');
const MANIFEST_PATH = path.join(TMP_DIR, 'manifest.json');

// 1. Copy webextension to a temp dir
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'webextension'), TMP_DIR, { recursive: true });

// 2. Patch manifest.json to promote optional permissions
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
if (manifest.optional_permissions) {
	manifest.permissions = [...(manifest.permissions || []), ...manifest.optional_permissions];
	delete manifest.optional_permissions;
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, '\t'));
}

// 3. Build with web-ext and output as newtab_powertools-uat.zip
execSync(`npx web-ext build --source-dir "${TMP_DIR}" --artifacts-dir "${path.join(ROOT, 'dist')}" --filename "newtab_powertools-uat.zip" --overwrite-dest`, { stdio: 'inherit' });

// 4. Cleanup
fs.rmSync(TMP_DIR, { recursive: true, force: true });
