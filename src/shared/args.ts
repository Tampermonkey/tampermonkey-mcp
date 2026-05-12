type OptType = 'string' | 'number' | 'boolean' | 'array';

type OptionConfig = {
    alias?: string | string[];
    type?: OptType;              // default: 'string'
    string?: boolean;            // for array: array of strings (default true)
    choices?: string[];          // only for string/array of string
    description?: string;        // ignored (for chaining compatibility)
};

type Schema = Record<string, OptionConfig>;

type Argv = Record<string, unknown>;

const isFlag = (s?: string) => !!s && s.startsWith('-');
const isLong = (s: string) => s.startsWith('--');

function coerce(value: unknown, type: OptType | undefined): unknown {
    if (type === 'boolean') return Boolean(value);
    if (type === 'number') {
        const n = Number(value);
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        if (Number.isNaN(n)) throw new Error(`Expected number, got "${value}"`);
        return n;
    }
    return value; // string or array handled elsewhere
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureArray(dst: any): any[] {
    return Array.isArray(dst) ? dst : (dst === undefined ? [] : [dst]);
}

function normalizeAliases(schema: Schema) {
    const aliasToKey = new Map<string, string>();
    const keyToAliases = new Map<string, string[]>();
    for (const key of Object.keys(schema)) {
        const cfg = schema[key];
        const list = (Array.isArray(cfg.alias) ? cfg.alias : (cfg.alias ? [cfg.alias] : []));
        keyToAliases.set(key, list);
        for (const a of list) aliasToKey.set(a, key);
    }
    return { aliasToKey, keyToAliases };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyChoices(key: string, cfg: OptionConfig, val: any) {
    if (!cfg.choices) return;
    if (cfg.type === 'array') {
        const arr = ensureArray(val);
        for (const v of arr) {
            if (!cfg.choices.includes(String(v))) {
                throw new Error(`Invalid value for --${key}: "${v}". Allowed: ${cfg.choices.join(', ')}`);
            }
        }
    } else {
        if (!cfg.choices.includes(String(val))) {
            throw new Error(`Invalid value for --${key}: "${val}". Allowed: ${cfg.choices.join(', ')}`);
        }
    }
}

export function hideBin(argv: string[]) {
    return argv.slice(2);
}

export function quickArgs(argvInput: string[]) {
    const schema: Schema = {};

    const api = {
        option(name: string, cfg: OptionConfig = {}) {
            schema[name] = cfg;
            return api;
        },
        help() {
            // no-op; keep chainability
            return api;
        },
        parseSync(): Argv {
            const { aliasToKey, keyToAliases } = normalizeAliases(schema);
            const out: Argv = {};
            const argv = [...argvInput];

            let i = 0;
            let stopParsing = false;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const setVal = (rawKey: string, value: any, fromNegation = false) => {
                const key = schema[rawKey] ? rawKey : (aliasToKey.get(rawKey) || rawKey);
                const cfg = schema[key];
                if (!cfg) {
                    // unknown option: ignore (or throw if you prefer strict)
                    return;
                }

                // Types & arrays
                if (cfg.type === 'boolean') {
                    out[key] = fromNegation ? false : Boolean(value === undefined ? true : value);
                } else if (cfg.type === 'number') {
                    out[key] = coerce(value, 'number');
                } else if (cfg.type === 'array') {
                    const isStringArray = cfg.string !== false; // default to strings
                    const arr = ensureArray(out[key]);
                    if (Array.isArray(value)) {
                        for (const v of value) arr.push(isStringArray ? String(v) : coerce(v, 'number'));
                    } else {
                        arr.push(isStringArray ? String(value) : coerce(value, 'number'));
                    }
                    out[key] = arr;
                } else {
                    // string (default)
                    out[key] = value === undefined ? '' : String(value);
                }

                // Validate choices
                applyChoices(key, cfg, out[key]);

                // Mirror to aliases for convenience (yargs lets you read either)
                const aliases = keyToAliases.get(key) || [];
                for (const a of aliases) out[a] = out[key];
            };

            while (i < argv.length) {
                const token = argv[i];

                if (stopParsing) {
                    // positional — ignored in this quick impl
                    i++;
                    continue;
                }

                if (token === '--') {
                    stopParsing = true;
                    i++;
                    continue;
                }

                if (!isFlag(token)) {
                    // positional — ignore
                    i++;
                    continue;
                }

                // Long options
                if (isLong(token)) {
                    // handle --no-foo
                    if (token.startsWith('--no-')) {
                        const key = token.slice(5);
                        setVal(key, false, true);
                        i++;
                        continue;
                    }

                    const eqIdx = token.indexOf('=');
                    if (eqIdx !== -1) {
                        const key = token.slice(2, eqIdx);
                        const val = token.slice(eqIdx + 1);
                        setVal(key, val);
                        i++;
                        continue;
                    }

                    const key = token.slice(2);
                    const cfg = schema[key] || schema[aliasToKey.get(key) || ''];

                    // if boolean, set true; else consume next as value if present and not a flag
                    if (cfg?.type === 'boolean') {
                        setVal(key, true);
                        i++;
                    } else {
                        const next = argv[i + 1];
                        if (next !== undefined && !isFlag(next)) {
                            setVal(key, next);
                            i += 2;
                        } else {
                            // dangling non-boolean => treat as empty string
                            setVal(key, '');
                            i++;
                        }
                    }
                    continue;
                }

                // Short options: could be -a, -a123, -abc, -p 8080
                const cluster = token.slice(1);
                let consumed = false;

                for (let idx = 0; idx < cluster.length; idx++) {
                    const ch = cluster[idx];
                    const key = ch;
                    const mapped = aliasToKey.get(key) || key;
                    const cfg = schema[mapped];

                    // pattern: -p8080 (value glued to flag)
                    const glued = cluster.slice(idx + 1);
                    if (cfg?.type && cfg.type !== 'boolean' && glued.length > 0) {
                        setVal(key, glued);
                        consumed = true;
                        break;
                    }

                    if (cfg?.type === 'boolean' || idx < cluster.length - 1) {
                        // boolean or part of a cluster -> set true
                        setVal(key, true);
                    } else {
                        // last flag in the cluster may have a separate value
                        const next = argv[i + 1];
                        if (next !== undefined && !isFlag(next)) {
                            setVal(key, next);
                            i++; // consume the next token
                        } else {
                            setVal(key, true); // no value provided -> true
                        }
                    }
                }

                i += consumed ? 1 : 1;
            }

            return out;
        },
    };

    return api;
}
