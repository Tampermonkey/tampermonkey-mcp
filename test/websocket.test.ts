/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WebSocket Communication Tests
 * Tests for Tampermonkey WebSocket server message handling based on TypeScript types
 */

import { WebSocket, WebSocketServer } from 'ws';

// ============================================================================
// Types based on the project's TypeScript definitions
// ============================================================================

// WebSocket Method Messages
interface WebSocketMethodMessage {
    method: 'authOK' | 'ping' | 'pong';
}

interface WebSocketAuthMessage {
    method: 'auth';
    token: string;
}

/*
interface WebSocketClosedMessage {
    method: 'closed';
    reason: string;
}
*/

// Userscript Request Types
interface UserscriptRequestBase {
    action: string;
    messageId: string;
}

interface ListExternalRequest extends UserscriptRequestBase {
    action: 'list';
    filter?: {
        content?: {
            pattern: string;
            isRegExp?: boolean;
            isCaseSensitive?: boolean;
            isWordMatch?: boolean;
            wordSeparators?: string;
        };
        location?: {
            includePattern: string[];
        };
    };
}

interface GetExternalRequest extends UserscriptRequestBase {
    action: 'get';
    path: string;
    ifNotModifiedSince?: number;
}

interface PatchExternalRequest extends UserscriptRequestBase {
    action: 'patch';
    path: string;
    value: string;
    lastModified?: number;
}

interface PutExternalRequest extends UserscriptRequestBase {
    action: 'put';
    value: string;
    lastModified?: number;
}

interface DeleteExternalRequest extends UserscriptRequestBase {
    action: 'delete';
    path: string;
}

interface OptionsExternalRequest extends UserscriptRequestBase {
    action: 'options';
    activeUrls: string[];
}

type UserscriptRequest =
    | ListExternalRequest
    | GetExternalRequest
    | PatchExternalRequest
    | PutExternalRequest
    | DeleteExternalRequest
    | OptionsExternalRequest;

// Response Types
interface ListExternalResponse {
    messageId: string;
    list: Array<{
        namespace: string;
        name: string;
        path: string;
        requires: string[];
        storage?: string;
    }>;
}

interface GetExternalResponse {
    messageId: string;
    lastModified?: number;
    value?: string;
    error?: { number: number; message: string };
}

interface UpdateExternalResponse {
    messageId: string;
    error?: { number: number; message: string };
}

interface PutExternalResponse {
    messageId: string;
    error?: { number: number; message: string };
}

interface DeleteExternalResponse {
    messageId: string;
    error?: { number: number; message: string };
}

type ExternalResponse =
    | ListExternalResponse
    | GetExternalResponse
    | UpdateExternalResponse
    | PutExternalResponse
    | DeleteExternalResponse;

interface WebSocketResponse {
    id: string | number;
    response: ExternalResponse;
}

// ============================================================================
// Type Guard Functions for Runtime Validation
// ============================================================================

function parseMessage(msg: string): any {
    try {
        return JSON.parse(msg);
    } catch {
        return null;
    }
}

function isValidMethodMessage(msg: any): msg is WebSocketMethodMessage {
    return !!(msg && typeof msg.method === 'string' && ['authOK', 'ping', 'pong'].includes(msg.method));
}

function isValidAuthMessage(msg: any): msg is WebSocketAuthMessage {
    return !!(msg && msg.method === 'auth' && typeof msg.token === 'string' && msg.token.length > 0);
}

function isValidUserscriptRequest(msg: any): msg is UserscriptRequest {
    if (!msg || typeof msg.action !== 'string' || typeof msg.messageId !== 'string') {
        return false;
    }

    const action = msg.action;

    switch (action) {
        case 'list':
            return true;

        case 'get':
            return typeof msg.path === 'string' && msg.path.length > 0;

        case 'patch':
            return (
                typeof msg.path === 'string' &&
                msg.path.length > 0 &&
                typeof msg.value === 'string'
            );

        case 'put':
            return typeof msg.value === 'string';

        case 'delete':
            return typeof msg.path === 'string' && msg.path.length > 0;

        case 'options':
            return Array.isArray(msg.activeUrls);

        default:
            return false;
    }
}

function isValidWebSocketResponse(msg: any): msg is WebSocketResponse {
    return !!(
        msg &&
        (typeof msg.id === 'string' || typeof msg.id === 'number') &&
        msg.response !== undefined
    );
}

// ============================================================================
// Tests
// ============================================================================

describe('WebSocket Authentication Flow', () => {
    let server: WebSocketServer;
    let client: WebSocket;
    let serverToken: string;

    beforeEach((done) => {
        serverToken = 'test_auth_token_' + Math.random().toString(36).substring(7);

        server = new WebSocketServer({ port: 0, host: 'localhost' });

        server.on('connection', (ws) => {
            ws.on('message', (data) => {
                const msg = parseMessage(data.toString());
                if (msg?.method === 'auth') {
                    if (msg.token === serverToken) {
                        ws.send(JSON.stringify({ method: 'authOK' }));
                    } else {
                        ws.close(3003, 'Auth failed');
                    }
                }
            });
        });

        server.on('listening', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            client = new WebSocket(`ws://localhost:${port}`);
            client.on('open', () => done());
        });
    });

    afterEach((done) => {
        client.close();
        server.close(() => done());
    });

    describe('Valid Auth Message', () => {
        it('should accept valid auth with correct token', (done) => {
            client.on('message', (data) => {
                const msg = parseMessage(data.toString());
                expect(msg).toEqual({ method: 'authOK' });
                expect(isValidMethodMessage(msg)).toBe(true);
                done();
            });
            client.send(JSON.stringify({ method: 'auth', token: serverToken }));
        });
    });

    describe('Invalid Auth Message', () => {
        it('should reject auth with wrong token', (done) => {
            client.on('close', (code) => {
                expect(code).toBe(3003);
                done();
            });
            client.send(JSON.stringify({ method: 'auth', token: 'wrong_token' }));
        });

        it('should reject auth without token', (done) => {
            client.on('close', (code) => {
                expect(code).toBe(3003);
                done();
            });
            client.send(JSON.stringify({ method: 'auth' }));
        });

        it('should reject auth with empty token', (done) => {
            client.on('close', (code) => {
                expect(code).toBe(3003);
                done();
            });
            client.send(JSON.stringify({ method: 'auth', token: '' }));
        });
    });
});

describe('WebSocket Method Messages', () => {
    describe('Valid Messages', () => {
        it('should accept valid ping message', () => {
            const msg: WebSocketMethodMessage = { method: 'ping' };
            expect(isValidMethodMessage(msg)).toBe(true);
        });

        it('should accept valid pong message', () => {
            const msg: WebSocketMethodMessage = { method: 'pong' };
            expect(isValidMethodMessage(msg)).toBe(true);
        });

        it('should accept valid authOK message', () => {
            const msg: WebSocketMethodMessage = { method: 'authOK' };
            expect(isValidMethodMessage(msg)).toBe(true);
        });
    });

    describe('Invalid Messages', () => {
        it('should reject invalid method', () => {
            const msg = { method: 'invalid_method' };
            expect(isValidMethodMessage(msg)).toBe(false);
        });

        it('should reject message without method', () => {
            const msg = { method: undefined };
            expect(isValidMethodMessage(msg)).toBe(false);
        });

        it('should reject message with non-string method', () => {
            const msg = { method: 123 };
            expect(isValidMethodMessage(msg)).toBe(false);
        });

        it('should reject null message', () => {
            expect(isValidMethodMessage(null)).toBe(false);
        });

        it('should reject undefined message', () => {
            expect(isValidMethodMessage(undefined)).toBe(false);
        });
    });
});

describe('WebSocket Auth Messages', () => {
    describe('Valid Auth Messages', () => {
        it('should accept valid auth message', () => {
            const msg: WebSocketAuthMessage = { method: 'auth', token: 'test123' };
            expect(isValidAuthMessage(msg)).toBe(true);
        });

        it('should accept auth with long token', () => {
            const msg: WebSocketAuthMessage = { method: 'auth', token: 'a'.repeat(100) };
            expect(isValidAuthMessage(msg)).toBe(true);
        });
    });

    describe('Invalid Auth Messages', () => {
        it('should reject auth without token', () => {
            const msg = { method: 'auth' };
            expect(isValidAuthMessage(msg)).toBe(false);
        });

        it('should reject auth with empty token', () => {
            const msg = { method: 'auth', token: '' };
            expect(isValidAuthMessage(msg)).toBe(false);
        });

        it('should reject auth with non-string token', () => {
            const msg = { method: 'auth', token: 123 };
            expect(isValidAuthMessage(msg)).toBe(false);
        });
    });
});

describe('Userscript Request Messages', () => {
    describe('List Request', () => {
        it('should accept valid list request with minimal args', () => {
            const req: ListExternalRequest = {
                action: 'list',
                messageId: '1'
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept valid list request with content filter', () => {
            const req: ListExternalRequest = {
                action: 'list',
                messageId: '2',
                filter: {
                    content: { pattern: '*.example.com' }
                }
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept valid list request with location filter', () => {
            const req: ListExternalRequest = {
                action: 'list',
                messageId: '3',
                filter: {
                    location: { includePattern: ['*://*.example.com/*'] }
                }
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept valid list request with full filter', () => {
            const req: ListExternalRequest = {
                action: 'list',
                messageId: '4',
                filter: {
                    content: {
                        pattern: '*.example.com',
                        isRegExp: true,
                        isCaseSensitive: false
                    },
                    location: {
                        includePattern: ['*://*.example.com/*']
                    }
                }
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should reject list request without messageId', () => {
            const req = { action: 'list' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject list request with missing action', () => {
            const req = { messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });
    });

    describe('Get Request', () => {
        it('should accept valid get request with minimal args', () => {
            const req: GetExternalRequest = {
                action: 'get',
                messageId: '1',
                path: 'script-123/source'
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept valid get request with ifNotModifiedSince', () => {
            const req: GetExternalRequest = {
                action: 'get',
                messageId: '2',
                path: 'script-123/source',
                ifNotModifiedSince: 1234567890
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should reject get request without path', () => {
            const req = { action: 'get', messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject get request with empty path', () => {
            const req = { action: 'get', messageId: '1', path: '' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });
    });

    describe('Patch Request', () => {
        it('should accept valid patch request with minimal args', () => {
            const req: PatchExternalRequest = {
                action: 'patch',
                messageId: '1',
                path: 'script-123/source',
                value: '// updated script'
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept valid patch request with lastModified', () => {
            const req: PatchExternalRequest = {
                action: 'patch',
                messageId: '2',
                path: 'script-123/source',
                value: '// updated script',
                lastModified: 1234567890
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should reject patch request without value', () => {
            const req = { action: 'patch', messageId: '1', path: 'script-123/source' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject patch request without path', () => {
            const req = { action: 'patch', messageId: '1', value: '// script' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject patch request with empty path', () => {
            const req = { action: 'patch', messageId: '1', path: '', value: '// script' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });
    });

    describe('Put Request', () => {
        it('should accept valid put request with minimal args', () => {
            const req: PutExternalRequest = {
                action: 'put',
                messageId: '1',
                value: '// new script content'
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept valid put request with lastModified', () => {
            const req: PutExternalRequest = {
                action: 'put',
                messageId: '2',
                value: '// new script content',
                lastModified: 1234567890
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should reject put request without value', () => {
            const req = { action: 'put', messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject put request with empty value', () => {
            const req = { action: 'put', messageId: '1', value: '' };
            expect(isValidUserscriptRequest(req)).toBe(true); // empty string is valid type
        });
    });

    describe('Delete Request', () => {
        it('should accept valid delete request', () => {
            const req: DeleteExternalRequest = {
                action: 'delete',
                messageId: '1',
                path: 'script-123/source'
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should reject delete request without path', () => {
            const req = { action: 'delete', messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject delete request with empty path', () => {
            const req = { action: 'delete', messageId: '1', path: '' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });
    });

    describe('Options Request', () => {
        it('should accept valid options request', () => {
            const req: OptionsExternalRequest = {
                action: 'options',
                messageId: '1',
                activeUrls: ['*://*.example.com/*']
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should accept options request with multiple urls', () => {
            const req: OptionsExternalRequest = {
                action: 'options',
                messageId: '1',
                activeUrls: ['*://*.example.com/*', '*://*.test.com/*']
            };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });

        it('should reject options request without activeUrls', () => {
            const req = { action: 'options', messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should accept options request with empty activeUrls array', () => {
            const req = { action: 'options', messageId: '1', activeUrls: [] };
            expect(isValidUserscriptRequest(req)).toBe(true);
        });
    });

    describe('Invalid Action', () => {
        it('should reject unknown action', () => {
            const req = { action: 'invalid', messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject empty action', () => {
            const req = { action: '', messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });

        it('should reject action with non-string', () => {
            const req = { action: 123, messageId: '1' };
            expect(isValidUserscriptRequest(req)).toBe(false);
        });
    });
});

describe('WebSocket Response Messages', () => {
    describe('Valid Responses', () => {
        it('should accept valid list response', () => {
            const resp: ListExternalResponse = {
                messageId: '1',
                list: [{
                    namespace: 'namespace',
                    name: 'Test Script',
                    path: 'script-123/source',
                    requires: []
                }]
            };
            expect(isValidWebSocketResponse({ id: '1', response: resp })).toBe(true);
        });

        it('should accept valid get response with value', () => {
            const resp: GetExternalResponse = {
                messageId: '2',
                lastModified: 1234567890,
                value: '// script content'
            };
            expect(isValidWebSocketResponse({ id: '2', response: resp })).toBe(true);
        });

        it('should accept valid get response with error', () => {
            const resp: GetExternalResponse = {
                messageId: '3',
                error: { number: 404, message: 'Not found' }
            };
            expect(isValidWebSocketResponse({ id: '3', response: resp })).toBe(true);
        });

        it('should accept valid patch response with success', () => {
            const resp: UpdateExternalResponse = {
                messageId: '4'
            };
            expect(isValidWebSocketResponse({ id: '4', response: resp })).toBe(true);
        });

        it('should accept valid delete response with error', () => {
            const resp: DeleteExternalResponse = {
                messageId: '5',
                error: { number: 403, message: 'Forbidden' }
            };
            expect(isValidWebSocketResponse({ id: '5', response: resp })).toBe(true);
        });

        it('should accept response with numeric id', () => {
            const resp = { messageId: '1', list: [] };
            expect(isValidWebSocketResponse({ id: 1, response: resp })).toBe(true);
        });
    });

    describe('Invalid Responses', () => {
        it('should reject response without id', () => {
            const resp = { response: { messageId: '1', list: [] } };
            expect(isValidWebSocketResponse(resp)).toBe(false);
        });

        it('should reject response without response field', () => {
            const resp = { id: '1' };
            expect(isValidWebSocketResponse(resp)).toBe(false);
        });

        it('should reject response with null id', () => {
            const resp = { id: null, response: { messageId: '1', list: [] } };
            expect(isValidWebSocketResponse(resp)).toBe(false);
        });

        it('should reject response with undefined id', () => {
            const resp = { id: undefined, response: { messageId: '1', list: [] } };
            expect(isValidWebSocketResponse(resp)).toBe(false);
        });

        it('should reject response with undefined response', () => {
            const resp = { id: '1', response: undefined };
            expect(isValidWebSocketResponse(resp)).toBe(false);
        });
    });
});

describe('WebSocket Message Type Guards', () => {
    it('should identify auth message correctly', () => {
        const validAuth: WebSocketAuthMessage = { method: 'auth', token: 'test123' };
        const invalidAuth = { method: 'auth' };
        const notAuth = { method: 'ping' };

        expect(isValidAuthMessage(validAuth)).toBe(true);
        expect(isValidAuthMessage(invalidAuth)).toBe(false);
        expect(isValidAuthMessage(notAuth)).toBe(false);
    });

    it('should parse JSON messages correctly', () => {
        const validJson = JSON.stringify({ method: 'auth', token: 'test' });
        const invalidJson = '{ invalid json }';

        expect(parseMessage(validJson)).toEqual({ method: 'auth', token: 'test' });
        expect(parseMessage(invalidJson)).toBe(null);
    });

    it('should handle malformed JSON gracefully', () => {
        const malformedMessages = ['', '{', 'not json', null, undefined];

        malformedMessages.forEach(msg => {
            expect(() => parseMessage(msg as string)).not.toThrow();
            expect(parseMessage(msg as string)).toBe(null);
        });
    });
});

describe('Edge Cases', () => {
    it('should handle very large messageId', () => {
        const req: ListExternalRequest = {
            action: 'list',
            messageId: '999999999999999999999999'
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle unicode in values', () => {
        const req: PatchExternalRequest = {
            action: 'patch',
            messageId: '1',
            path: 'script/source',
            value: '// 中文 日本語'
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle special characters in path', () => {
        const req: GetExternalRequest = {
            action: 'get',
            messageId: '1',
            path: 'script-123/path/with/slashes/and-dashes'
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle extremely large numbers in timestamps', () => {
        const req: GetExternalRequest = {
            action: 'get',
            messageId: '1',
            path: 'script/source',
            ifNotModifiedSince: Number.MAX_SAFE_INTEGER
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle zero timestamp', () => {
        const req: GetExternalRequest = {
            action: 'get',
            messageId: '1',
            path: 'script/source',
            ifNotModifiedSince: 0
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle negative numbers in timestamp', () => {
        const req: GetExternalRequest = {
            action: 'get',
            messageId: '1',
            path: 'script/source',
            ifNotModifiedSince: -1
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle very long script content', () => {
        const req: PutExternalRequest = {
            action: 'put',
            messageId: '1',
            value: 'a'.repeat(100000)
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });

    it('should handle special characters in filter patterns', () => {
        const req: ListExternalRequest = {
            action: 'list',
            messageId: '1',
            filter: {
                content: {
                    pattern: '*://*/*.js',
                    isRegExp: true,
                    isCaseSensitive: true,
                    isWordMatch: false,
                    wordSeparators: ' \t'
                }
            }
        };
        expect(isValidUserscriptRequest(req)).toBe(true);
    });
});
