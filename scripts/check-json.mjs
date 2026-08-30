// Validate every JSON file that ships with the extension.
//
// Extracted from the CI workflow so that GitHub Actions and CNB run the exact
// same code — an inline `node -e` blob duplicated across two CI configs drifts.
//
// A malformed messages.json does not fail loudly in the browser: Chrome just
// falls back to the default locale, so a typo surfaces as missing UI text.

import fs from 'node:fs';
import path from 'node:path';

const CHROME_DIR = new URL('../chrome/', import.meta.url).pathname;

const TARGETS = [
    'manifest.json',
    '_locales/en/messages.json',
    '_locales/zh_CN/messages.json',
];

let failed = 0;

for (const rel of TARGETS) {
    const abs = path.join(CHROME_DIR, rel);
    if (!fs.existsSync(abs)) {
        console.error(`✗ ${rel}: file not found`);
        failed++;
        continue;
    }
    try {
        JSON.parse(fs.readFileSync(abs, 'utf8'));
        console.log(`✓ ${rel}`);
    } catch (error) {
        console.error(`✗ ${rel}: ${error.message}`);
        failed++;
    }
}

if (failed > 0) {
    console.error(`\n${failed} JSON file(s) invalid`);
    process.exit(1);
}

console.log(`\n${TARGETS.length} JSON files valid`);
