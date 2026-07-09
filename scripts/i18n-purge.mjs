import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.join(__dirname, '../webextension');
const localesDir = path.join(extDir, '_locales');

// 1. Determine target locale
const argLocale = process.argv[2];
if (!argLocale) {
    console.error(`❌ Error: You must specify exactly one locale to purge (e.g., 'pnpm i18n:purge de'). Purging multiple languages at once is disabled for safety.`);
    process.exit(1);
}

const targetLocales = fs.readdirSync(localesDir).filter(f => fs.statSync(path.join(localesDir, f)).isDirectory());
if (!targetLocales.includes(argLocale)) {
    console.error(`❌ Locale '${argLocale}' not found in _locales directory.`);
    process.exit(1);
}

const localePath = path.join(localesDir, argLocale, 'messages.json');
if (!fs.existsSync(localePath)) {
    console.error(`❌ messages.json not found for locale '${argLocale}'.`);
    process.exit(1);
}

let content = fs.readFileSync(localePath, 'utf-8');
const json = JSON.parse(content);
const keys = Object.keys(json);
let staleKeys = [];

// 2. Find stale keys
if (argLocale === 'en') {
    function getSourceFiles(dir) {
        let results = [];
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                if (file !== '_locales') {
                    results = results.concat(getSourceFiles(filePath));
                }
            } else if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.json')) {
                results.push(filePath);
            }
        }
        return results;
    }

    const sourceFiles = getSourceFiles(extDir);
    let combinedContent = '';
    for (const file of sourceFiles) {
        combinedContent += fs.readFileSync(file, 'utf-8') + '\n';
    }

    staleKeys = keys.filter(key => !combinedContent.includes(key));
} else {
    const enPath = path.join(localesDir, 'en', 'messages.json');
    const enKeys = Object.keys(JSON.parse(fs.readFileSync(enPath, 'utf-8')));
    staleKeys = keys.filter(key => !enKeys.includes(key));
}

if (staleKeys.length === 0) {
    console.log(`✨ Locale '${argLocale}' has no stale keys. Nothing to purge!`);
    process.exit(0);
}

// 3. Purge!
let removed = 0;
for (const key of staleKeys) {
    delete json[key];
    removed++;
}

fs.writeFileSync(localePath, JSON.stringify(json, null, '\t') + '\n');
console.log(`🧹 Purged ${removed} stale keys from '${argLocale}'!`);
