// Parse-check every first-party script with `node --check`.
//
// The extension has no build step, so a syntax error is not caught until the
// browser loads the page — it shows up as a silently broken feature rather
// than an error message. `node --check` catches it in CI in milliseconds.
//
// Every script under chrome/scripts is first-party: the zTree/jQuery bundle
// shipped with the extension was dropped along with the last page that loaded
// it, so there is nothing left to skip.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME_DIR = new URL('../chrome/', import.meta.url).pathname;
const SCRIPTS_DIR = path.join(CHROME_DIR, 'scripts');

function collect(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collect(p));
        else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
}

const files = collect(SCRIPTS_DIR).sort();
if (files.length === 0) {
    console.error('No first-party scripts found — check the path.');
    process.exit(1);
}

const failed = [];
for (const file of files) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (error) {
        const stderr = String(error.stderr || error.message);
        console.error(`✗ ${path.relative(CHROME_DIR, file)}\n${stderr.trim()}`);
        failed.push(file);
    }
}

if (failed.length > 0) {
    console.error(`\n${failed.length} of ${files.length} script(s) failed to parse`);
    process.exit(1);
}

console.log(`${files.length} first-party scripts parse cleanly`);
