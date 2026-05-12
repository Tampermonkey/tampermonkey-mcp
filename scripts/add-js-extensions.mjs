/**
 * Post-build script: adds .js extensions to import paths in dist/.
 *
 * tsc with moduleResolution "node" allows extensionless relative imports in source
 * but emits them verbatim. Node ESM requires .js extensions, so we add them here.
 * Also fixes deep SDK imports like @modelcontextprotocol/sdk/server/mcp which
 * need .js for Node ESM resolution through the package's "./*" exports map.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = import.meta.url ? fileURLToPath(new URL('..', import.meta.url)) : '';

const DIST = join(ROOT, 'dist');

function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
        } else if (entry.name.endsWith('.js')) {
            processFile(full);
        }
    }
}

// Matches relative imports: from './...' or from '../...'
const FROM_RE = /(from\s+['"`])(\.\.?[/][^'"`]+)(['"`])/g;
// Matches dynamic imports: import('./...')
const DYNAMIC_RE = /(import\s*\(\s*['"`])(\.\.?[/][^'"`]+)(['"`]\s*\))/g;
// Matches deep SDK imports: from '@modelcontextprotocol/sdk/...'
const SDK_RE = /(from\s+['"`])(@modelcontextprotocol\/sdk\/[^'"`]+)(['"`])/g;

function hasExtension(path) {
    return /\.(js|mjs|cjs)$/.test(path);
}

function addJs(match, prefix, path, suffix) {
    if (hasExtension(path)) return match;
    return `${prefix}${path}.js${suffix}`;
}

function processFile(file) {
    let src = readFileSync(file, 'utf8');
    let changed = false;

    const next = src
    .replace(FROM_RE, (m, p, path, s) => { const r = addJs(m, p, path, s); if (r !== m) changed = true; return r })
    .replace(DYNAMIC_RE, (m, p, path, s) => { const r = addJs(m, p, path, s); if (r !== m) changed = true; return r })
    .replace(SDK_RE, (m, p, path, s) => { const r = addJs(m, p, path, s); if (r !== m) changed = true; return r });

    if (changed) {
        writeFileSync(file, next, 'utf8');
    }
}

walk(DIST);