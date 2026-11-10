import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { generate } from 'selfsigned';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startBroker } from '../dist/native/broker.js';
import { credentials, brokerRequest, ensureBroker, health } from '../dist/native/runtime.js';
import { Decoder, encode } from '../dist/native/protocol.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = '11111111-1111-4111-8111-111111111111/source';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function temporary(run) {
    const directory = await mkdtemp(join(tmpdir(), 'tm-native-integration-'));
    try { await run(directory); } finally {
        assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(basename(directory).startsWith('tm-native-integration-'));
        await rm(directory, { recursive: true, force: true });
    }
}
function host(directory, write, respond = true) {
    const child = spawn(process.execPath, [join(root, 'dist/native/host-main.js'), 'editor-firefox@tampermonkey.net'], {
        env: { ...process.env, TAMPERMONKEY_NATIVE_DIRECTORY: directory }, windowsHide: true, stdio: ['pipe','pipe','pipe'],
    });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    const decoder = new Decoder(), messages = [], waiters = [], calls = [];
    child.stdout.on('data', chunk => {
        for (const message of decoder.push(chunk)) {
            if (message.type === 'request') {
                calls.push(message);
                if (respond) child.stdin.write(encode({ type: 'response', id: message.id, response: { value: 'fixture source', lastModified: 123 } }));
            }
            const waiter = waiters.shift(); if (waiter) waiter(message); else messages.push(message);
        }
    });
    const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve));
    child.stdin.write(encode({ type: 'hello', protocol: 1, write }));
    return { child, calls, next, exited, stderr: () => stderr };
}
async function stopHost(peer) {
    if (!peer || peer.child.exitCode !== null) return;
    peer.child.stdin.end(); await peer.exited;
}
async function client(directory) {
    const result = new Client({ name: 'native-integration-test', version: '1' });
    await result.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--transport=native'],
        env: { ...process.env, TAMPERMONKEY_NATIVE_DIRECTORY: directory }, stderr: 'pipe' }));
    return result;
}

test('real native host framing and independent MCP clients share consent, revisions and browser reconnect', { timeout: 60000 }, () => temporary(async directory => {
    const broker = await startBroker(directory); let peer; const clients = [];
    try {
        peer = host(directory, false); assert.equal((await peer.next()).type, 'ready');
        const a = await client(directory), b = await client(directory); clients.push(a, b);
        assert.deepEqual((await a.listTools()).tools.map(tool => tool.name).sort(), ['tampermonkey_connection_status','tampermonkey_get','tampermonkey_list','tampermonkey_patch']);
        const blocked = await a.callTool({ name: 'tampermonkey_patch', arguments: { path, value: 'changed', lastModified: 123 } });
        assert.equal(blocked.isError, true); assert.equal(peer.calls.length, 0);
        const read = await b.callTool({ name: 'tampermonkey_get', arguments: { path } });
        assert.equal(JSON.parse(read.content[0].text).lastModified, 123);
        const forbidden = await a.callTool({ name: 'tampermonkey_get', arguments: { path: path.replace('/source','/storage') } });
        assert.equal(forbidden.isError, true); assert.equal(peer.calls.length, 1);
        const first = await readFile(join(directory, 'credentials.json'), 'utf8');
        await stopHost(peer); peer = null;
        peer = host(directory, true); assert.equal((await peer.next()).type, 'ready');
        const updated = await a.callTool({ name: 'tampermonkey_patch', arguments: { path, value: 'changed', lastModified: 123 } });
        assert.equal(updated.isError, false); assert.equal(peer.calls[0].command.lastModified, 123);
        assert.equal(await readFile(join(directory, 'credentials.json'), 'utf8'), first);
        assert.equal((await ensureBroker(directory)).port, broker.port);
    } finally { for (const c of clients) await c.close(); await stopHost(peer); await broker.close(); }
}));

test('disconnect during a patch fails without replaying it to a replacement browser', { timeout: 45000 }, () => temporary(async directory => {
    const broker = await startBroker(directory); let peer;
    try {
        peer = host(directory, true, false); await peer.next();
        const saved = await credentials(directory);
        const pending = brokerRequest({ ...saved, port: broker.port }, '/command', { action: 'patch', path, value: 'changed', lastModified: 123 });
        assert.equal((await peer.next()).type, 'request'); assert.equal(peer.calls.length, 1);
        await stopHost(peer); peer = null;
        const failed = await pending; assert.equal(failed.status, 400); assert.match(failed.body.error, /not retried/);
        peer = host(directory, true, false); await peer.next();
        await delay(50); assert.equal(peer.calls.length, 0);
    } finally { await stopHost(peer); await broker.close(); }
}));

test('broker rejects unauthenticated/browser-origin access and untrusted TLS identities', { timeout: 45000 }, () => temporary(async directory => {
    const broker = await startBroker(directory);
    try {
        const get = headers => new Promise((resolve, reject) => {
            const req = https.get({ hostname: '127.0.0.1', port: broker.port, path: '/health', ca: broker.cert, headers }, res => {
                res.resume(); resolve(res.statusCode);
            }); req.on('error', reject);
        });
        assert.equal(await get({}), 403);
        assert.equal(await get({ authorization: `Bearer ${broker.token}`, origin: 'https://example.com' }), 403);
        const pems = await generate([{ name: 'commonName', value: 'localhost' }], { algorithm: 'sha256' });
        const wrong = { token: broker.token, cert: pems.cert, key: pems.private };
        await assert.rejects(brokerRequest({ ...wrong, port: broker.port }, '/health'));
        let receivedHttp = false;
        const impersonator = https.createServer({ key: wrong.key, cert: wrong.cert }, (_req, res) => { receivedHttp = true; res.end('{}'); });
        impersonator.listen(0, '127.0.0.1'); await once(impersonator, 'listening');
        try {
            await assert.rejects(brokerRequest({ ...(await credentials(directory)), port: impersonator.address().port }, '/health'));
            assert.equal(receivedHttp, false, 'A different TLS identity must not receive the bearer token');
        } finally { await new Promise(resolve => impersonator.close(resolve)); }
        const ws = new WebSocket(`wss://127.0.0.1:${broker.port}/native`, { ca: broker.cert, headers: { authorization: `Bearer ${broker.token}` }, origin: 'https://example.com' });
        await assert.rejects(once(ws, 'open')); ws.terminate();
        await writeFile(join(directory, 'credentials.json'), '{invalid');
        await assert.rejects(credentials(directory));
    } finally { await broker.close(); }
}));

test('a native runtime override cannot change permissions on an unrelated directory', () => temporary(async directory => {
    await writeFile(join(directory, 'unrelated-note.txt'), 'fixture');
    await assert.rejects(credentials(directory), /unrelated files/);
    assert.equal(await readFile(join(directory, 'unrelated-note.txt'), 'utf8'), 'fixture');
}));

test('cold startup is shared across processes; broker restart preserves credentials and recovers', { timeout: 60000 }, () => temporary(async directory => {
    let pid, mcp;
    try {
        const [a, b] = await Promise.all([ensureBroker(directory), ensureBroker(directory)]);
        assert.equal(a.port, b.port); assert.equal(a.token, b.token);
        const first = await brokerRequest(a, '/health'); pid = first.body.pid;
        assert.ok(Number.isInteger(pid) && pid !== process.pid);
        mcp = await client(directory);
        process.kill(pid, 'SIGTERM'); pid = null;
        for (let n = 0; n < 100 && await health(directory, a); n++) await delay(50);
        const status = await mcp.callTool({ name: 'tampermonkey_connection_status', arguments: {} });
        assert.equal(status.isError, undefined);
        const recovered = JSON.parse(status.content[0].text); pid = recovered.pid;
        assert.ok(Number.isInteger(pid) && pid !== process.pid);
        const second = await ensureBroker(directory);
        assert.equal(second.token, a.token); assert.equal(second.cert, a.cert);
        const next = await brokerRequest(second, '/health'); pid = next.body.pid;
        assert.notEqual(pid, first.body.pid);
    } finally { await mcp?.close(); if (pid) process.kill(pid, 'SIGTERM'); }
}));
