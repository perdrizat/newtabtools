import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.join(__dirname, '../webextension');
const localesDir = path.join(extDir, '_locales');

const targetLocale = process.argv[2] || 'en';
const localePath = path.join(localesDir, targetLocale, 'messages.json');

if (!fs.existsSync(localePath)) {
    console.error(`❌ Locale '${targetLocale}' not found in _locales directory.`);
    process.exit(1);
}

const targetKeys = Object.keys(JSON.parse(fs.readFileSync(localePath, 'utf-8')));
let unusedKeys = [];

if (targetLocale === 'en') {
    // Master locale: source of truth is the codebase
    function getSourceFiles(dir) {
        let results = [];
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                if (file !== '_locales') {
                    results = results.concat(getSourceFiles(filePath));
                }
            } else if (filePath.endsWith('.js') || filePath.endsWith('.xhtml') || filePath.endsWith('.html') || filePath.endsWith('.json')) {
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

    unusedKeys = targetKeys.filter(key => !combinedContent.includes(key));
} else {
    // Other locales: source of truth is en/messages.json
    const enPath = path.join(localesDir, 'en', 'messages.json');
    const enKeys = Object.keys(JSON.parse(fs.readFileSync(enPath, 'utf-8')));
    unusedKeys = targetKeys.filter(key => !enKeys.includes(key));
}

if (unusedKeys.length > 0) {
    console.log(`\n🧹 Found ${unusedKeys.length} unused keys in ${targetLocale}/messages.json:`);
    unusedKeys.forEach(k => console.log(`  - ${k}`));
} else {
    console.log(`\n✨ All keys in ${targetLocale}/messages.json are actively used!`);
}
