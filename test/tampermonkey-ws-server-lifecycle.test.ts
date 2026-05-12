/**
 * Tests for TampermonkeyWebSocketServer lifecycle details
 * Focuses on onCode, dispose, port range, code property, and auth token format
 */

import { WebSocket } from 'ws';
import { TampermonkeyWebSocketServer } from '../src/mcp/server/tampermonkey-ws-client';

describe('TampermonkeyWebSocketServer Lifecycle', () => {
    let wsServer: TampermonkeyWebSocketServer;

    afterEach(async () => {
        if (wsServer) {
            await wsServer.dispose();
        }
    });

    describe('onCode()', () => {
        it('should return code immediately when server is already listening', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            // Wait for server to start listening
            const code1 = await wsServer.onCode();

            // Second call should return immediately (code already available)
            const startTime = Date.now();
            const code2 = await wsServer.onCode();
            const elapsed = Date.now() - startTime;

            expect(code2).toBe(code1);
            // Should return within 200ms (not polling)
            expect(elapsed).toBeLessThan(200);
        });

        it('should return a non-empty string', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();
            expect(typeof code).toBe('string');
            expect(code.length).toBeGreaterThan(0);
        });

        it('should return same code for multiple onCode calls', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code1 = await wsServer.onCode();
            const code2 = await wsServer.onCode();
            const code3 = await wsServer.onCode();

            expect(code1).toBe(code2);
            expect(code2).toBe(code3);
        });
    });

    describe('Code format and properties', () => {
        it('code property should match onCode result', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const codeFromMethod = await wsServer.onCode();
            const codeFromProperty = wsServer.code;

            expect(codeFromProperty).toBe(codeFromMethod);
        });

        it('should have valid code format (base32 port + 2 chars)', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();

            // Code format: <base32(port - 1024)><auth><authEcho>
            // All characters should be from base32 charset + auth token chars
            expect(code).toMatch(/^[0-9a-z]+$/);
            expect(code.length).toBeGreaterThanOrEqual(3); // at least 1 port char + 2 auth chars
        });

        it('should encode port correctly in code', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();

            // Decode port from code: base32 portion is all but last 2 chars
            const encodedPort = code.substring(0, code.length - 2);
            const decodedPort = parseInt(encodedPort, 32) + 1024;

            expect(decodedPort).toBe(wsServer.port);
        });

        it('auth tokens should be single chars from [0-9a-z]', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            const code = await wsServer.onCode();

            // Last two chars are auth and authEcho tokens
            const authToken = code[code.length - 2];
            const authEchoToken = code[code.length - 1];

            expect(authToken).toMatch(/^[0-9a-z]$/);
            expect(authEchoToken).toMatch(/^[0-9a-z]$/);
        });
    });

    describe('Port', () => {
        it('should have port greater than 0 after initialization', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();
            expect(wsServer.port).toBeGreaterThan(0);
        });

        it('should have port greater than 1024 (offset for encoding)', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();
            // The port is assigned by the OS (port: 0), typically in the ephemeral range
            // It should always be > 1024 to allow base32 encoding with MIN_PORT_OFFSET
            expect(wsServer.port).toBeGreaterThan(1024);
        });
    });

    describe('Dispose', () => {
        it('should dispose server gracefully', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            expect(wsServer.port).toBeGreaterThan(0);

            await wsServer.dispose();

            // Port should still be set (not reset)
            expect(wsServer.port).toBeGreaterThan(0);
        });

        it('should handle double dispose without error', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            await wsServer.dispose();
            // Second dispose should not throw
            await wsServer.dispose();
        });

        it('should not accept new connections after dispose', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();
            const port = wsServer.port;

            await wsServer.dispose();

            // Attempting to connect should fail
            const result = await new Promise<boolean>((resolve) => {
                const ws = new WebSocket(`ws://localhost:${port}`);
                ws.addEventListener('open', () => {
                    ws.close();
                    resolve(true);
                });
                ws.addEventListener('error', () => {
                    resolve(false);
                });
            });

            expect(result).toBe(false);
        });
    });

    describe('Connected promise', () => {
        it('should have connected promise before any connection', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            expect(wsServer.connected).toBeDefined();
            expect(wsServer.connected instanceof Promise).toBe(true);
        });

        it('connected promise should be pending before auth', async () => {
            wsServer = new TampermonkeyWebSocketServer();
            await wsServer.onCode();

            let resolved = false;
            wsServer.connected.then(() => { resolved = true; });

            await new Promise(resolve => setTimeout(resolve, 100));
            expect(resolved).toBe(false);
        });
    });
});