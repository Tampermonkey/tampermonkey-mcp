import http from 'node:http';
import https from 'node:https';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { credentials } from './runtime';
import { object, validateCommand, PROTOCOL, MAX_MESSAGE, type Result } from './protocol';

export async function startBroker(directory: string) {
    const saved = await credentials(directory);
    const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
    let peer: WebSocket | null = null;
    let write = false;
    const pending = new Map<string, { socket: WebSocket; resolve: (value: Result) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const authorized = (request: http.IncomingMessage) => {
        const received = Buffer.from(request.headers.authorization ?? '');
        const expected = Buffer.from(`Bearer ${saved.token}`);
        return received.length === expected.length && timingSafeEqual(received, expected) && !request.headers.origin &&
            request.headers.host === `127.0.0.1:${port}`;
    };
    const request = (command: unknown): Promise<Result> => {
        if (!peer || peer.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Enable the native connection in Tampermonkey Editors'));
        const checked = validateCommand(command, write);
        if (pending.size >= 32) return Promise.reject(new Error('Native request queue is full'));
        const socket = peer, id = randomUUID();
        const message = JSON.stringify({ type: 'request', id, command: checked });
        if (Buffer.byteLength(message) > MAX_MESSAGE) return Promise.reject(new Error('Native request is too large'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native request timed out; it was not retried and its outcome may be unknown')) }, 30000);
            pending.set(id, { socket, resolve, reject, timer });
            socket.send(message, error => {
                if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('Native send failed; outcome may be unknown')) }
            });
        });
    };
    let port = 0;
    const listener = https.createServer({ key: saved.key, cert: saved.cert, minVersion: 'TLSv1.2' }, async (req, res) => {
        try {
            if (!authorized(req)) { res.writeHead(403).end(); return }
            res.setHeader('content-type', 'application/json');
            if (req.method === 'GET' && req.url === '/health') {
                res.end(JSON.stringify({ protocol: PROTOCOL, pid: process.pid, connected: !!peer, write })); return;
            }
            if (req.method !== 'POST' || req.url !== '/command') { res.writeHead(404).end(); return }
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of req) {
                const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
                if (size > MAX_MESSAGE) { res.writeHead(413).end(); return }
                chunks.push(bytes);
            }
            const command: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            res.end(JSON.stringify(await request(command)));
        } catch (error) {
            if (!res.headersSent) res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Native request failed' }));
        }
    });
    listener.on('upgrade', (req, socket, head) => {
        if (req.url !== '/native' || !authorized(req)) { socket.destroy(); return }
        sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
    });
    sockets.on('connection', socket => {
        if (peer) { socket.close(1013, 'Another browser is connected'); return }
        let ready = false;
        const timeout = setTimeout(() => socket.close(1008, 'Native hello required'), 5000);
        socket.on('error', () => undefined);
        socket.on('message', raw => {
            try {
                const value: unknown = JSON.parse(raw.toString());
                if (!object(value)) throw new Error('Invalid native message');
                if (!ready) {
                    if (value.type !== 'hello' || value.protocol !== PROTOCOL || typeof value.write !== 'boolean' || Object.keys(value).length !== 3 || peer) {
                        throw new Error('Invalid native hello');
                    }
                    ready = true; clearTimeout(timeout); peer = socket; write = value.write;
                    socket.send(JSON.stringify({ type: 'ready', protocol: PROTOCOL })); return;
                }
                if (value.type !== 'response' || typeof value.id !== 'string' || !object(value.response) || Object.keys(value).length !== 3) {
                    throw new Error('Invalid native response');
                }
                const item = pending.get(value.id);
                if (item && item.socket === socket) {
                    clearTimeout(item.timer); pending.delete(value.id); item.resolve(value.response);
                }
            } catch { socket.close(1008, 'Invalid native message') }
        });
        socket.on('close', () => {
            clearTimeout(timeout);
            if (peer === socket) { peer = null; write = false }
            for (const [id, item] of pending) if (item.socket === socket) {
                clearTimeout(item.timer); pending.delete(id);
                item.reject(new Error('Browser disconnected; the request was not retried and its outcome may be unknown'));
            }
        });
    });
    await new Promise<void>((resolve, reject) => {
        listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Native broker address unavailable');
    port = address.port;
    await writeFile(join(directory, 'address.json'), JSON.stringify({ port }), { mode: 0o600 });
    return {
        port, token: saved.token, cert: saved.cert,
        close: async () => {
            for (const socket of sockets.clients) socket.terminate();
            await new Promise<void>(resolve => sockets.close(() => resolve()));
            listener.closeAllConnections();
            await new Promise<void>(resolve => listener.close(() => resolve()));
        },
    };
}
