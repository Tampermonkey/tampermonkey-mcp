import { existsSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

/* -------------------------------------------------------------
   Configuration
----------------------------------------------------------------*/
const SUPPORTED_EXTENSIONS = ['mjs', 'js', 'json'];
const RESOLVE_DIRECTORIES = false;               // set true to allow “index” resolution

/* -------------------------------------------------------------
   Helper data
----------------------------------------------------------------*/
const INDEX_FILES = RESOLVE_DIRECTORIES
    ? SUPPORTED_EXTENSIONS.map(ext => `index.${ext}`)
    : [];

const POSTFIXES = [
    ...SUPPORTED_EXTENSIONS.map(ext => `.${ext}`), // .mjs, .js, .json
    ...INDEX_FILES.map(file => `/${file}`)        // /index.mjs, /index.js …
];

/* -------------------------------------------------------------
   Core utilities
----------------------------------------------------------------*/
/**
 * Returns the first postfix that makes `specifier` point to an existing file.
 *
 * @param {string} specifier – the import specifier as written in the source.
 * @param {object} context  – the ResolveHook context (contains parentURL).
 * @returns {string} Empty string if nothing matches.
 */
function findExistingPostfix(specifier, context) {
  // If the import ends with a slash we only look for index files,
  // otherwise we try every possible postfix.
    const candidates = specifier.endsWith('/') ? INDEX_FILES : POSTFIXES;

    const baseDir = dirname(fileURLToPath(context.parentURL));

    return candidates.find(postfix => {
        const fullPath = specifier.startsWith('/')
            ? `${specifier}${postfix}`
            : join(baseDir, `${specifier}${postfix}`);

        return existsSync(fullPath);
    }) ?? '';
}

/* -------------------------------------------------------------
   Resolve hook
----------------------------------------------------------------*/
const VALID_PREFIXES = ['/', './', '../'];

export function resolve(specifier, context, nextResolve) {
    // console.log('resolve', {context, specifier});
    const needsPostfix = VALID_PREFIXES.some(p => specifier.startsWith(p)) && !extname(basename(specifier));

    const postfix = specifier.startsWith('@modelcontextprotocol') && !specifier.endsWith('.js')
        ? '.js'
        : needsPostfix ? findExistingPostfix(specifier, context) : '';

    return nextResolve(specifier + postfix);
}
