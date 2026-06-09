import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '../webextension/_locales');
const enPath = path.join(localesDir, 'en', 'messages.json');
const enKeys = Object.keys(JSON.parse(fs.readFileSync(enPath, 'utf-8')));

let locales = fs.readdirSync(localesDir).filter(f => fs.statSync(path.join(localesDir, f)).isDirectory() && f !== 'en');

const targetLocale = process.argv[2];
if (targetLocale) {
    if (locales.includes(targetLocale)) {
        locales = [targetLocale];
    } else {
        console.error(`❌ Locale '${targetLocale}' not found in _locales directory.`);
        process.exit(1);
    }
}

for (const locale of locales) {
    const localePath = path.join(localesDir, locale, 'messages.json');
    if (!fs.existsSync(localePath)) continue;
    
    const localeKeys = Object.keys(JSON.parse(fs.readFileSync(localePath, 'utf-8')));
    const missing = enKeys.filter(k => !localeKeys.includes(k));
    
    if (missing.length > 0) {
        console.log(`\n🌍 Locale '${locale}' is missing ${missing.length} keys:`);
        missing.forEach(k => console.log(`  - ${k}`));
    } else {
        console.log(`\n🌍 Locale '${locale}' is 100% translated!`);
    }
}
