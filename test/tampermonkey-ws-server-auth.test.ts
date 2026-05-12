/**
 * Tests for TampermonkeyWebSocketServer auth handshake and command flow
 * Tests the actual WebSocket protocol between server and extension
 */

import { WebSocket } from 'ws';
import { TampermonkeyWebSocketServer } from '../src/mcp/server/tampermonkey-ws-client';

/**
 * Helper: discover auth token by brute-forcing single-char tokens.
 * The server generates random 1-char tokens from [0-9a-z], so we try all 36.
 */
async function performFullAuth(wsServer: TampermonkeyWebSocketServer): Promise<{
    ws: WebSocket;
    auth: string;
    authEcho: string;
}> {
    const port = wsServer.port;
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';

    for (const a of chars) {
        try {
            const result = await tryAuth(port, a);
            if (result) {
                return { ws: result.ws, auth: a, authEcho: result.authEcho };
            }
        } catch {
            // wrong auth token, try next
        }
    }

    throw new Error('Could not authenticate with any token');
}

function tryAuth(port: number, authCandidate: string): Promise<{ ws: WebSocket; authEcho: string } | null> {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        let settled = false;

        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                ws.close();
                resolve(null);
            }
        }, 300);

        ws.on('open', () => {
            ws.send(JSON.stringify({ method: 'auth', token: authCandidate }));
        });

        ws.on('message', (data: Buffer | string) => {
            if (settled) return;
            const msg = JSON.parse(typeof data === 'string' ? data : data.toString());

            if (msg.method === 'auth') {
                // Got echo token — auth was correct!
                settled = true;
                clearTimeout(timeout);
                const authEcho = msg.token;
                ws.send(JSON.stringify({ method: 'authOK' }));

                // Wait a tick for connection to be fully established
                setTimeout(() => {
                    resolve({ ws, authEcho });
                }, 50);
            }
        });

        ws.on('close', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(null);
            }
        });

        ws.on('error', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(null);
            }
        });
    });
}

describe('TampermonkeyWebSocketServer Auth & Command Flow', () => {
    let wsServer: TampermonkeyWebSocketServer;

    afterEach(async () => {
        if (wsServer) {
            await wsServer.dispose();
        }
    });

    describe('Auth Handshake', () => {
        it('should complete full auth handshake', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            expect(result.ws).toBeDefined();
            expect(result.auth).toBeDefined();
            expect(result.authEcho).toBeDefined();

            result.ws.close();
        });

        it('should reject connection with wrong auth token', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);

            // Now try connecting with wrong token
            const closePromise = new Promise<number>((resolve) => {
                const badClient = new WebSocket(`ws://localhost:${wsServer.port}`);
                badClient.on('open', () => {
                    // Send wrong auth token (different from the valid one)
                    const wrongToken = result.auth === 'a' ? 'b' : 'a';
                    badClient.send(JSON.stringify({ method: 'auth', token: wrongToken }));
                });
                badClient.on('close', (code) => {
                    resolve(code);
                });
            });

            const closeCode = await closePromise;
            expect(closeCode).toBe(3003);

            result.ws.close();
        });

        it('should reject connection without auth token', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const closePromise = new Promise<number>((resolve) => {
                const client = new WebSocket(`ws://localhost:${wsServer.port}`);
                client.on('open', () => {
                    client.send(JSON.stringify({ method: 'auth' }));
                });
                client.on('close', (code) => {
                    resolve(code);
                });
            });

            const closeCode = await closePromise;
            expect(closeCode).toBe(3003);
        });

        it('should reject connection with empty auth token', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const closePromise = new Promise<number>((resolve) => {
                const client = new WebSocket(`ws://localhost:${wsServer.port}`);
                client.on('open', () => {
                    client.send(JSON.stringify({ method: 'auth', token: '' }));
                });
                client.on('close', (code) => {
                    resolve(code);
                });
            });

            const closeCode = await closePromise;
            expect(closeCode).toBe(3003);
        });

        it('should reject connection that sends authOK without authEcho first', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const closePromise = new Promise<number>((resolve) => {
                const client = new WebSocket(`ws://localhost:${wsServer.port}`);
                client.on('open', () => {
                    // Send authOK directly without doing auth first
                    client.send(JSON.stringify({ method: 'authOK' }));
                });
                client.on('close', (code) => {
                    resolve(code);
                });

                // Safety timeout
                setTimeout(() => {
                    client.close();
                    resolve(0);
                }, 3000);
            });

            const closeCode = await closePromise;
            // The server should close the connection because the first message
            // should be auth, not authOK
            expect(closeCode).toBe(3003);
        });
    });

    describe('Connection State', () => {
        it('should resolve connected promise after successful auth', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            // Before auth, connected should be pending
            let connectedResolved = false;
            wsServer.connected.then(() => { connectedResolved = true; });

            // Give it a tick to potentially resolve
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(connectedResolved).toBe(false);

            const result = await performFullAuth(wsServer);

            // Now connected should resolve
            await wsServer.connected;
            expect(connectedResolved).toBe(true);

            result.ws.close();
        });

        it('should handle pong messages without breaking connection', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            // Sending pong should not break the connection
            ws.send(JSON.stringify({ method: 'pong' }));

            // Connection should still be open after sending pong
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(ws.readyState).toBe(WebSocket.OPEN);

            ws.close();
        });
    });

    describe('Command Flow', () => {
        it('should send list command and receive response', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            // Set up a mock extension that responds to list commands
            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                // Respond to the list command
                if (msg.action === 'list') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId,
                            list: [
                                { namespace: 'ns', name: 'Test Script', path: 'script-123/source', requires: [] }
                            ]
                        }
                    }));
                }
            });

            // Give time for message handler to be set up
            await new Promise(resolve => setTimeout(resolve, 50));

            const listResult = await wsServer.list();
            expect(listResult.messageId).toBeDefined();
            expect(listResult.list).toHaveLength(1);
            expect(listResult.list[0].name).toBe('Test Script');

            ws.close();
        });

        it('should send get command and receive response', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                if (msg.action === 'get') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId,
                            value: '// script content',
                            lastModified: 1234567890
                        }
                    }));
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            const getResult = await wsServer.get('script-123/source');
            expect(getResult.value).toBe('// script content');
            expect(getResult.lastModified).toBe(1234567890);

            ws.close();
        });

        it('should send patch command and receive response', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                if (msg.action === 'patch') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId
                        }
                    }));
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            const patchResult = await wsServer.patch('script-123/source', '// updated content');
            expect(patchResult.messageId).toBeDefined();
            expect(patchResult.error).toBeUndefined();

            ws.close();
        });

        it('should send put command and receive response', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                if (msg.action === 'put') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId
                        }
                    }));
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            const putResult = await wsServer.put('// new script');
            expect(putResult.messageId).toBeDefined();
            expect(putResult.error).toBeUndefined();

            ws.close();
        });

        it('should send delete command and receive response', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                if (msg.action === 'delete') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId
                        }
                    }));
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            const deleteResult = await wsServer.delete('script-123/source');
            expect(deleteResult.messageId).toBeDefined();
            expect(deleteResult.error).toBeUndefined();

            ws.close();
        });

        it('should handle error responses from extension', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                if (msg.action === 'get') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId,
                            error: { number: 404, message: 'Script not found' }
                        }
                    }));
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            const getResult = await wsServer.get('nonexistent/source');
            expect(getResult.error).toBeDefined();
            expect(getResult.error?.number).toBe(404);

            ws.close();
        });
    });

    describe('Connection Superseding', () => {
        it('should supersede previous connection when new client authenticates', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            // First client authenticates
            const result1 = await performFullAuth(wsServer);
            expect(result1.ws.readyState).toBe(WebSocket.OPEN);

            // Second client authenticates — should supersede first
            const result2 = await performFullAuth(wsServer);
            expect(result2.ws.readyState).toBe(WebSocket.OPEN);

            // Give time for first connection to be closed
            await new Promise(resolve => setTimeout(resolve, 100));

            // First connection should have been closed by the server
            expect(result1.ws.readyState).not.toBe(WebSocket.OPEN);

            result2.ws.close();
        });
    });

    describe('Malformed responses', () => {
        it('should ignore messages with no matching messageId', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const result = await performFullAuth(wsServer);
            const ws = result.ws;

            // Send a response with an unknown messageId
            ws.send(JSON.stringify({
                id: 'unknown-id',
                response: { messageId: 'unknown-id', list: [] }
            }));

            // Send a response with a valid list command
            const listPromise = wsServer.list();

            ws.on('message', (data: Buffer | string) => {
                const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
                if (msg.method === 'ping') {
                    ws.send(JSON.stringify({ method: 'pong' }));
                    return;
                }

                if (msg.action === 'list') {
                    ws.send(JSON.stringify({
                        id: msg.messageId,
                        response: {
                            messageId: msg.messageId,
                            list: [{ namespace: 'ns', name: 'Script', path: 's/source', requires: [] }]
                        }
                    }));
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            const listResult = await listPromise;
            expect(listResult.list).toHaveLength(1);

            ws.close();
        });
    });
});