import test from 'node:test';
import assert from 'node:assert/strict';
import { endianness } from 'node:os';
import { Decoder, encode, validateCommand, MAX_MESSAGE } from '../dist/native/protocol.js';
import { installationPlan } from '../dist/native/install.js';

const path = '11111111-1111-4111-8111-111111111111/source';
test('native frames support fragmentation, coalescing and Unicode; reject invalid lengths and truncation', () => {
    const values = [{ hello: '日本語' }, { source: 'line one\nline two 💗' }];
    const raw = Buffer.concat(values.map(encode)), decoder = new Decoder(), result = [];
    for (let n = 0; n < raw.length; n += 3) result.push(...decoder.push(raw.subarray(n, n + 3)));
    decoder.end(); assert.deepEqual(result, values);
    assert.deepEqual(new Decoder().push(raw), values);
    for (const size of [0, MAX_MESSAGE + 1, 0xffffffff]) {
        const header = Buffer.alloc(4);
        if (endianness() === 'LE') header.writeUInt32LE(size); else header.writeUInt32BE(size);
        assert.throws(() => new Decoder().push(header));
    }
    const truncated = new Decoder(); truncated.push(raw.subarray(0, 5)); assert.throws(() => truncated.end());
    assert.throws(() => encode({ source: 'x'.repeat(MAX_MESSAGE) }));
});

test('native permissions reject storage, resources, writes without consent and patches without revisions', () => {
    assert.deepEqual(validateCommand({ action: 'list' }, false), { action: 'list' });
    assert.deepEqual(validateCommand({ action: 'get', path }, false), { action: 'get', path });
    const patch = { action: 'patch', path, value: 'source', lastModified: 123 };
    assert.deepEqual(validateCommand(patch, true), patch);
    for (const value of [patch, { action: 'put' }, { action: 'delete', path },
        { action: 'get', path: path.replace('/source','/storage') }, { action: 'get', path: '../source' },
        { action: 'get', path, extra: true }]) assert.throws(() => validateCommand(value, false));
    for (const value of [{ ...patch, lastModified: undefined }, { ...patch, lastModified: NaN },
        { ...patch, lastModified: -1 }, { ...patch, value: '💗'.repeat(200000) }]) assert.throws(() => validateCommand(value, true));
});

test('installer plans use exact official IDs, fixed host names and local registrations', () => {
    const env = { platform: 'win32', home: 'C:/Users/Test', directory: 'C:/Users/Test/AppData/Native', node: 'C:/Program Files/nodejs/node.exe', entry: 'C:/Package/dist/native/host-main.js' };
    const firefox = installationPlan('firefox', env);
    assert.deepEqual(firefox.manifest.allowed_extensions, ['editor-firefox@tampermonkey.net']);
    assert.match(firefox.key, /^HKCU\\Software\\Mozilla\\NativeMessagingHosts\\/);
    assert.ok(firefox.launcherSource.includes('"C:/Program Files/nodejs/node.exe"'));
    assert.equal(firefox.manifest.allowed_origins, undefined);
    const chrome = installationPlan('chrome', { ...env, platform: 'linux', home: '/home/test', entry: '/package/bin/tampermonkey-native-host' });
    assert.deepEqual(chrome.manifest.allowed_origins, ['chrome-extension://lieodnapokbjkkdkhdljlllmgkmdokcm/']);
    assert.equal(chrome.key, null); assert.ok(chrome.destination.includes('google-chrome'));
    assert.throws(() => installationPlan('firefox', { ...env, node: 'C:/%INJECT%/node.exe' }));
    assert.throws(() => installationPlan('edge', env));
});
