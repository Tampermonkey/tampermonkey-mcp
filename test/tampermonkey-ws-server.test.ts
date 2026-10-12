/**
 * Tampermonkey WebSocket Server Integration Tests
 * Tests for the actual WebSocket server implementation
 */

import { createServer } from 'net';
import { WebSocket } from 'ws';
import { TampermonkeyWebSocketServer } from '../src/mcp/server/tampermonkey-ws-client';

/** Whether this machine can bind the IPv6 loopback address at all. */
function canBindIpv6Loopback(): Promise<boolean> {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.once('error', () => resolve(false));
        probe.listen(0, '::1', () => probe.close(() => resolve(true)));
    });
}

/** Open a WebSocket and resolve once the handshake succeeded. */
function connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const client = new WebSocket(url);
        client.on('open', () => {
            client.close();
            resolve();
        });
        client.on('error', reject);
    });
}

describe('TampermonkeyWebSocketServer', () => {
    let wsServer: TampermonkeyWebSocketServer;

    afterEach(async () => {
        if (wsServer) {
            await wsServer.dispose();
        }
    });

    describe('Server Initialization', () => {
        it('should create server instance', () => {
            wsServer = new TampermonkeyWebSocketServer();
            expect(wsServer).toBeInstanceOf(TampermonkeyWebSocketServer);
        });

        it('should generate connection code', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();
            expect(code).toBeDefined();
            expect(typeof code).toBe('string');
            expect(code.length).toBeGreaterThan(0);
        });

        it('should have port after initialization', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();
            expect(wsServer.port).toBeGreaterThan(0);
        });
    });

    describe('Connection Code Format', () => {
        it('should have valid code format', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();

            // Code format: <base32(port - 1024)><auth_token><echo_token>
            expect(code).toMatch(/^[0-9a-z]+$/);
            expect(code.length).toBeGreaterThanOrEqual(3);
        });

        it('should decode port from code', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();

            const encodedPort = code.substring(0, code.length - 2);
            const decodedPort = parseInt(encodedPort, 32) + 1024;

            expect(decodedPort).toBe(wsServer.port);
        });
    });

    describe('Server Cleanup', () => {
        it('should close gracefully', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            expect(wsServer.port).toBeGreaterThan(0);

            await wsServer.dispose();
        });
    });

    describe('Edge Cases', () => {
        it('should handle malformed JSON', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const client = new WebSocket(`ws://localhost:${wsServer.port}`);

            return new Promise((resolve) => {
                client.on('open', () => {
                    // Send malformed JSON
                    client.send('{ invalid json }');
                    setTimeout(() => {
                        client.close();
                        resolve(undefined);
                    }, 500);
                });

                client.on('close', () => {
                    resolve(undefined);
                });

                setTimeout(() => {
                    client.close();
                    resolve(undefined);
                }, 3000);
            });
        });

        it('should handle empty message', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const client = new WebSocket(`ws://localhost:${wsServer.port}`);

            return new Promise((resolve) => {
                client.on('open', () => {
                    client.send('');
                    setTimeout(() => {
                        client.close();
                        resolve(undefined);
                    }, 500);
                });

                setTimeout(() => {
                    client.close();
                    resolve(undefined);
                }, 3000);
            });
        });

        it('should handle non-JSON string message', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const client = new WebSocket(`ws://localhost:${wsServer.port}`);

            return new Promise((resolve) => {
                client.on('open', () => {
                    client.send('not json at all');
                    setTimeout(() => {
                        client.close();
                        resolve(undefined);
                    }, 500);
                });

                setTimeout(() => {
                    client.close();
                    resolve(undefined);
                }, 3000);
            });
        });

        it('should handle binary data message', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const client = new WebSocket(`ws://localhost:${wsServer.port}`);

            return new Promise((resolve) => {
                client.on('open', () => {
                    // Send binary data
                    client.send(Buffer.from([0x00, 0x01, 0x02, 0xff]));
                    setTimeout(() => {
                        client.close();
                        resolve(undefined);
                    }, 500);
                });

                setTimeout(() => {
                    client.close();
                    resolve(undefined);
                }, 3000);
            });
        });

        it('should handle null byte in message', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const client = new WebSocket(`ws://localhost:${wsServer.port}`);

            return new Promise((resolve) => {
                client.on('open', () => {
                    client.send('\x00\x00\x00');
                    setTimeout(() => {
                        client.close();
                        resolve(undefined);
                    }, 500);
                });

                setTimeout(() => {
                    client.close();
                    resolve(undefined);
                }, 3000);
            });
        });
    });

    describe('Multiple Connections', () => {
        it('should handle multiple sequential connections', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            // First connection
            const client1 = new WebSocket(`ws://localhost:${wsServer.port}`);
            await new Promise<void>((resolve) => {
                client1.on('open', () => resolve());
            });
            client1.close();

            // Second connection
            const client2 = new WebSocket(`ws://localhost:${wsServer.port}`);
            await new Promise<void>((resolve) => {
                client2.on('open', () => resolve());
            });
            client2.close();
        });
    });

    describe('Server State', () => {
        it('should have connected promise after initialization', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            // The connected promise should exist and be a promise
            expect(wsServer.connected).toBeDefined();
            expect(wsServer.connected instanceof Promise).toBe(true);
        });

        it('should update port after listening', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const initialPort = wsServer.port;
            expect(initialPort).toBeGreaterThan(0);
        });
    });

    describe('Loopback Address Families', () => {
        // The extension dials `ws://localhost:<port>`. `localhost` resolves to both
        // 127.0.0.1 and ::1 on many systems, so the server must answer on either one.
        it('should accept connections on 127.0.0.1 and ::1', async () => {
            const hasIpv6Loopback = await canBindIpv6Loopback();
            if (!hasIpv6Loopback) {
                console.warn('Skipping the ::1 assertion: IPv6 loopback is unavailable here');
            }

            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            const urls = [`ws://127.0.0.1:${wsServer.port}`];
            if (hasIpv6Loopback) urls.push(`ws://[::1]:${wsServer.port}`);

            for (const url of urls) {
                await expect(connect(url)).resolves.toBeUndefined();
            }
        });

        it('should use the same port for every listener', async () => {
            const hasIpv6Loopback = await canBindIpv6Loopback();
            if (!hasIpv6Loopback) {
                console.warn('Skipping the ::1 assertion: IPv6 loopback is unavailable here');
                return;
            }

            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            // Both families must serve the port encoded in the single connection code.
            const encodedPort = wsServer.code.substring(0, wsServer.code.length - 2);
            const decodedPort = parseInt(encodedPort, 32) + 1024;
            expect(decodedPort).toBe(wsServer.port);

            await expect(connect(`ws://[::1]:${decodedPort}`)).resolves.toBeUndefined();
        });
    });
});
