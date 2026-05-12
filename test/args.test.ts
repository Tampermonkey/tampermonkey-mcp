/**
 * Tests for the command-line argument parser in src/shared/args.ts
 */

import { hideBin, quickArgs } from '../src/shared/args';

describe('hideBin', () => {
    it('should remove first two elements from argv', () => {
        const argv = ['/usr/bin/node', '/path/to/script.js', '--port', '8080'];
        expect(hideBin(argv)).toEqual(['--port', '8080']);
    });

    it('should handle empty remaining args', () => {
        const argv = ['/usr/bin/node', '/path/to/script.js'];
        expect(hideBin(argv)).toEqual([]);
    });

    it('should handle single remaining arg', () => {
        const argv = ['/usr/bin/node', '/path/to/script.js', '--help'];
        expect(hideBin(argv)).toEqual(['--help']);
    });
});

describe('quickArgs', () => {
    describe('string options', () => {
        it('should parse long string option with value', () => {
            const result = quickArgs(['--name', 'test'])
                .option('name')
                .parseSync();
            expect(result.name).toBe('test');
        });

        it('should parse long string option with equals syntax', () => {
            const result = quickArgs(['--name=test'])
                .option('name')
                .parseSync();
            expect(result.name).toBe('test');
        });

        it('should set empty string for dangling non-boolean flag', () => {
            const result = quickArgs(['--name'])
                .option('name')
                .parseSync();
            expect(result.name).toBe('');
        });

        it('should set empty string when value is a flag', () => {
            const result = quickArgs(['--name', '--other'])
                .option('name')
                .option('other', { type: 'boolean' })
                .parseSync();
            expect(result.name).toBe('');
            expect(result.other).toBe(true);
        });
    });

    describe('number options', () => {
        it('should parse number option', () => {
            const result = quickArgs(['--port', '8080'])
                .option('port', { type: 'number' })
                .parseSync();
            expect(result.port).toBe(8080);
        });

        it('should parse number option with equals syntax', () => {
            const result = quickArgs(['--port=3000'])
                .option('port', { type: 'number' })
                .parseSync();
            expect(result.port).toBe(3000);
        });

        it('should throw on NaN number value', () => {
            expect(() => {
                quickArgs(['--port', 'abc'])
                    .option('port', { type: 'number' })
                    .parseSync();
            }).toThrow('Expected number');
        });

        it('should parse zero as a valid number', () => {
            const result = quickArgs(['--count', '0'])
                .option('count', { type: 'number' })
                .parseSync();
            expect(result.count).toBe(0);
        });

        it('should parse negative numbers with equals syntax', () => {
            const result = quickArgs(['--offset=-5'])
                .option('offset', { type: 'number' })
                .parseSync();
            expect(result.offset).toBe(-5);
        });
    });

    describe('boolean options', () => {
        it('should parse boolean flag as true', () => {
            const result = quickArgs(['--verbose'])
                .option('verbose', { type: 'boolean' })
                .parseSync();
            expect(result.verbose).toBe(true);
        });

        it('should parse --no- prefix as false', () => {
            const result = quickArgs(['--no-verbose'])
                .option('verbose', { type: 'boolean' })
                .parseSync();
            expect(result.verbose).toBe(false);
        });

        it('should set false for --no- even when value is provided', () => {
            const result = quickArgs(['--no-verbose'])
                .option('verbose', { type: 'boolean' })
                .parseSync();
            expect(result.verbose).toBe(false);
        });

        it('should default boolean flag without value to true', () => {
            const result = quickArgs(['--debug'])
                .option('debug', { type: 'boolean' })
                .parseSync();
            expect(result.debug).toBe(true);
        });
    });

    describe('array options', () => {
        it('should accumulate multiple values into an array', () => {
            const result = quickArgs(['--tag', 'foo', '--tag', 'bar'])
                .option('tag', { type: 'array' })
                .parseSync();
            expect(result.tag).toEqual(['foo', 'bar']);
        });

        it('should handle single array value', () => {
            const result = quickArgs(['--tag', 'foo'])
                .option('tag', { type: 'array' })
                .parseSync();
            expect(result.tag).toEqual(['foo']);
        });

        it('should handle number arrays', () => {
            const result = quickArgs(['--id', '1', '--id', '2'])
                .option('id', { type: 'array', string: false })
                .parseSync();
            expect(result.id).toEqual([1, 2]);
        });

        it('should default to string arrays', () => {
            const result = quickArgs(['--tag', 'foo'])
                .option('tag', { type: 'array' })
                .parseSync();
            expect(result.tag).toEqual(['foo']);
        });
    });

    describe('choices validation', () => {
        it('should accept valid choice', () => {
            const result = quickArgs(['--type', 'server'])
                .option('type', { choices: ['server', 'proxy', 'chat'] })
                .parseSync();
            expect(result.type).toBe('server');
        });

        it('should reject invalid choice', () => {
            expect(() => {
                quickArgs(['--type', 'invalid'])
                    .option('type', { choices: ['server', 'proxy', 'chat'] })
                    .parseSync();
            }).toThrow('Invalid value');
        });

        it('should validate array choices', () => {
            const result = quickArgs(['--mode', 'dynamic', '--mode', 'static'])
                .option('mode', { type: 'array', choices: ['dynamic', 'static'] })
                .parseSync();
            expect(result.mode).toEqual(['dynamic', 'static']);
        });

        it('should reject invalid array choice', () => {
            expect(() => {
                quickArgs(['--mode', 'invalid'])
                    .option('mode', { type: 'array', choices: ['dynamic', 'static'] })
                    .parseSync();
            }).toThrow('Invalid value');
        });
    });

    describe('aliases', () => {
        it('should resolve single alias', () => {
            const result = quickArgs(['-y', 'server'])
                .option('type', { alias: 'y' })
                .parseSync();
            expect(result.type).toBe('server');
            expect(result.y).toBe('server');
        });

        it('should resolve multi-character alias', () => {
            const result = quickArgs(['-t', 'http'])
                .option('transport', { alias: 't' })
                .parseSync();
            expect(result.transport).toBe('http');
            expect(result.t).toBe('http');
        });

        it('should resolve multiple aliases', () => {
            const result = quickArgs(['-n', '65536'])
                .option('num_ctx', { alias: ['n'], type: 'number' })
                .parseSync();
            expect(result.num_ctx).toBe(65536);
            expect(result.n).toBe(65536);
        });
    });

    describe('short options', () => {
        it('should parse short option with value', () => {
            const result = quickArgs(['-p', '8080'])
                .option('port', { alias: 'p', type: 'number' })
                .parseSync();
            expect(result.port).toBe(8080);
        });

        it('should parse short option with glued value', () => {
            const result = quickArgs(['-p8080'])
                .option('port', { alias: 'p', type: 'number' })
                .parseSync();
            expect(result.port).toBe(8080);
        });

        it('should parse boolean short option cluster', () => {
            const result = quickArgs(['-abc'])
                .option('a', { type: 'boolean' })
                .option('b', { type: 'boolean' })
                .option('c', { type: 'boolean' })
                .parseSync();
            expect(result.a).toBe(true);
            expect(result.b).toBe(true);
            expect(result.c).toBe(true);
        });

        it('should parse short option with last having value', () => {
            const result = quickArgs(['-a', 'value'])
                .option('a')
                .parseSync();
            expect(result.a).toBe('value');
        });
    });

    describe('stop parsing', () => {
        it('should stop parsing at --', () => {
            const result = quickArgs(['--port', '8080', '--', '--name', 'test'])
                .option('port', { type: 'number' })
                .option('name')
                .parseSync();
            expect(result.port).toBe(8080);
            expect(result.name).toBeUndefined();
        });
    });

    describe('unknown options', () => {
        it('should ignore unknown options', () => {
            const result = quickArgs(['--unknown', 'value', '--known', 'test'])
                .option('known')
                .parseSync();
            expect(result.known).toBe('test');
            expect(result.unknown).toBeUndefined();
        });
    });

    describe('multiple option types together', () => {
        it('should parse mixed option types', () => {
            const result = quickArgs([
                '--type', 'server',
                '--port', '8080',
                '--verbose',
                '--tag', 'foo',
                '--tag', 'bar',
            ])
                .option('type', { choices: ['server', 'proxy', 'chat'] })
                .option('port', { type: 'number' })
                .option('verbose', { type: 'boolean' })
                .option('tag', { type: 'array' })
                .parseSync();

            expect(result.type).toBe('server');
            expect(result.port).toBe(8080);
            expect(result.verbose).toBe(true);
            expect(result.tag).toEqual(['foo', 'bar']);
        });

        it('should parse with aliases', () => {
            const result = quickArgs(['-y', 'server', '-p', '4001', '-n', '65536'])
                .option('type', { alias: 'y', choices: ['server', 'proxy', 'chat'] })
                .option('port', { alias: 'p', type: 'number' })
                .option('num_ctx', { alias: 'n', type: 'number' })
                .parseSync();

            expect(result.type).toBe('server');
            expect(result.y).toBe('server');
            expect(result.port).toBe(4001);
            expect(result.p).toBe(4001);
            expect(result.num_ctx).toBe(65536);
            expect(result.n).toBe(65536);
        });
    });

    describe('chaining', () => {
        it('should return api for chaining', () => {
            const api = quickArgs([]);
            expect(api.option).toBeDefined();
            expect(api.help).toBeDefined();
            expect(api.parseSync).toBeDefined();
        });

        it('should chain option calls', () => {
            const result = quickArgs(['--port', '8080', '--verbose'])
                .option('port', { type: 'number' })
                .option('verbose', { type: 'boolean' })
                .parseSync();
            expect(result.port).toBe(8080);
            expect(result.verbose).toBe(true);
        });

        it('should chain help() call (returns api)', () => {
            const result = quickArgs(['--port', '8080'])
                .option('port', { type: 'number' })
                .help()
                .parseSync();
            expect(result.port).toBe(8080);
        });
    });
});