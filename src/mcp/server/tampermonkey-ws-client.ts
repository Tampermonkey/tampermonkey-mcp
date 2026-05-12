/**
 * WebSocket server for Tampermonkey Editors extension to connect to.
 *
 * The MCP server creates a WebSocket server that the Tampermonkey Editors
 * extension connects to. The extension sends auth messages, the server
 * responds with echo tokens, and then the extension sends commands.
 *
 * Connection code format: <base32(port - MIN_PORT_OFFSET)><auth_token><echo_token>
 * where MIN_PORT_OFFSET = 1024
 */

import { WebSocketServer, WebSocket } from 'ws';
import { logger as console } from '../../shared/logger';

const MIN_PORT_OFFSET = 1024;

export interface ListExternalResponse {
    messageId: string;
    list: Array<{
        namespace: string;
        name: string;
        path: string;
        requires: string[];
        storage?: string;
    }>;
}

export interface GetExternalResponse {
    messageId: string;
    lastModified?: number;
    value?: string;
    error?: { number: number; message: string };
}

export interface UpdateExternalResponse {
    messageId: string;
    error?: { number: number; message: string };
}

export interface PutExternalResponse {
    messageId: string;
    error?: { number: number; message: string };
}

export interface DeleteExternalResponse {
    messageId: string;
    error?: { number: number; message: string };
}

export type ExternalResponse = ListExternalResponse | GetExternalResponse | UpdateExternalResponse | PutExternalResponse | DeleteExternalResponse;

export interface UserscriptRequest {
    action: 'list' | 'get' | 'patch' | 'put' | 'delete' | 'options';
    messageId?: string;
    path?: string;
    value?: string;
    lastModified?: number;
    ifNotModifiedSince?: number;
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

export class TampermonkeyWebSocketServer {
    private wss!: WebSocketServer;
    private _ws: WebSocket | null = null;
    private _pending = new Map<string, (data: ExternalResponse) => void>();
    private _msgId = 1;
    private _pingInterval: NodeJS.Timeout | null = null;
    private _connected: Promise<TampermonkeyWebSocketServer> = Promise.resolve(this);
    private _connected_cb: () => void = () => undefined;
    private _connectedFail_cb: () => void = () => undefined;
    private _code = '';
    public host = 'localhost';

    // Auth tokens
    private auth = '';
    private authEcho = '';
    public port = 0;

    constructor() {
        this._prepareConnection();
        this._generateAuthTokens();
        this._startServer();
    }

    private _generateAuthTokens() {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
        this.auth = chars[Math.floor(Math.random() * chars.length)];
        this.authEcho = chars[Math.floor(Math.random() * chars.length)];
    }

    private _startServer() {
        this.wss = new WebSocketServer({ port: 0, host: this.host });

        this.wss.on('listening', () => {
            const address = this.wss.address();
            this.port = address && typeof address === 'object' && 'port' in address ? address.port : 0;
            this._code = '' + ((this.port - MIN_PORT_OFFSET).toString(32)) + this.auth + this.authEcho;
            console.log(`[TampermonkeyWS] WebSocket server started on port ${this.port}`);
            console.log(`[TampermonkeyWS] Connection code: ${this._code}`);
        });

        this.wss.on('connection', (ws) => {
            console.log('[TampermonkeyWS] New connection');
            this._handleConnection(ws);
        });
    }

    private _prepareConnection(error?: Error) {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        this._connectedFail_cb?.();
        this._connected = new Promise((resolve, reject) => {
            this._connected_cb = () => resolve(this);
            this._connectedFail_cb = () => reject(error || new Error('Connection closed'));
        });
    }

    get connected(): Promise<TampermonkeyWebSocketServer> {
        return this._connected;
    }

    get isConnected(): boolean {
        return this._ws?.readyState === WebSocket.OPEN;
    }

    get code(): string {
        return this._code;
    }

    /**
     * Wait for the connection code to be available
     */
    async onCode(): Promise<string> {
        while (!this._code) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this._code;
    }

    /**
     * Send a command to the extension and wait for response
     */
    private _command(cmd: UserscriptRequest): Promise<ExternalResponse> {
        return new Promise((resolve, reject) => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                this._prepareConnection();
                return reject(new Error('No active connection'));
            }
            const id = String(this._msgId++);
            cmd.messageId = id;
            this._pending.set(id, resolve);
            setTimeout(() => {
                if (this._pending.delete(id)) {
                    console.error('[TampermonkeyWS] Command timeout:', cmd);
                    reject(new Error('Timeout'));
                }
            }, 30000);
            this._ws.send(JSON.stringify(cmd));
        });
    }

    private _handleConnection(ws: WebSocket) {
        ws.on('close', (_code, reason) => {
            if (this._ws !== ws) return;
            this._ws = null;
            const reasonStr = reason instanceof Buffer ? reason.toString() : String(reason ?? '');
            this._prepareConnection(new Error(`Connection closed: ${reasonStr}`));
        });

        const recv = (send?: object): Promise<string> => {
            return new Promise((resolve, reject) => {
                ws.once('message', (msg: Buffer | string) => {
                    const str = typeof msg === 'string' ? msg : msg.toString();
                    resolve(str);
                });
                ws.once('close', () => reject(new Error('Socket closed')));
                if (send) ws.send(JSON.stringify(send));
            });
        };

        (async () => {
            try {
                // Step 1: Wait for auth from extension
                const authMsg = await recv();
                console.log('[TampermonkeyWS] Received auth message');
                const authData = JSON.parse(authMsg) as { method?: string; token?: string };

                if (authData.method !== 'auth' || authData.token !== this.auth) {
                    console.warn('[TampermonkeyWS] Auth failed:', authData);
                    ws.close(3003, 'Auth failed');
                    return;
                }

                // Step 2: Send echo token and wait for authOK
                const okData = JSON.parse(await recv({ method: 'auth', token: this.authEcho })) as { method?: string };
                if (okData?.method !== 'authOK') {
                    console.warn('[TampermonkeyWS] Missing authOK:', okData);
                    ws.close(3003, 'Missing authOK');
                    return;
                }

                // Step 3: Close previous connection if any
                if (this._ws && this._ws !== ws) {
                    console.log('[TampermonkeyWS] Closing previous connection');
                    this._ws.close(4009, 'Connection superseded');
                }

                this._ws = ws;

                // Start ping interval to keep connection alive
                this._pingInterval = setInterval(() => {
                    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                        this._ws.send(JSON.stringify({ method: 'ping' }));
                    }
                }, 15000);

                // Handle incoming messages
                ws.on('message', (msg: Buffer | string) => {
                    try {
                        const str = typeof msg === 'string' ? msg : msg.toString();
                        const data = JSON.parse(str) as { method?: string; id?: string | number; messageId?: string | number; response?: ExternalResponse };
                        if (data?.method === 'pong') return;
                        // Responses from extension: { id: messageId, response: ... }
                        const response = data.response;
                        const messageId = String(data.id ?? data.messageId);
                        const resolver = this._pending.get(messageId);
                        if (resolver && response) {
                            resolver(response);
                            this._pending.delete(messageId);
                        }
                    } catch (e) {
                        console.error('[TampermonkeyWS] Failed to process message:', e);
                    }
                });

                console.log('[TampermonkeyWS] Connection ready');
                this._connected_cb();
            } catch (e) {
                console.error('[TampermonkeyWS] Auth error:', e);
                ws.close(3003, 'Auth error');
            }
        })()
        .catch(e => console.error('[TampermonkeyWS] Auth error:', e));
    }

    /**
     * List all userscripts
     */
    async list(filter?: object): Promise<ListExternalResponse> {
        const resp = await this._command({ action: 'list', filter });
        return resp as ListExternalResponse;
    }

    /**
     * Get a userscript by path
     */
    async get(path: string, ifNotModifiedSince?: number): Promise<GetExternalResponse> {
        const resp = await this._command({ action: 'get', path, ifNotModifiedSince });
        return resp;
    }

    /**
     * Patch a userscript by path
     */
    async patch(path: string, value: string, lastModified?: number): Promise<UpdateExternalResponse> {
        const resp = await this._command({ action: 'patch', path, value, lastModified });
        return resp;
    }

    /**
     * Create a new userscript
     */
    async put(value: string, lastModified?: number): Promise<PutExternalResponse> {
        const resp = await this._command({ action: 'put', value, lastModified });
        return resp;
    }

    /**
     * Delete a userscript by path
     */
    async delete(path: string): Promise<DeleteExternalResponse> {
        const resp = await this._command({ action: 'delete', path });
        return resp;
    }

    /**
     * Dispose of the WebSocket server
     */
    async dispose() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        if (this._ws) {
            this._ws.terminate();
            this._ws = null;
        }
        for (const client of this.wss.clients) {
            client.terminate();
        }
        // Access the internal HTTP server to close and unref it
        // This ensures Jest doesn't detect an open handle
        const internalServer = (this.wss as unknown as { _server: import('http').Server | null })._server;
        this.wss.close();
        if (internalServer) {
            internalServer.close();
            internalServer.unref();
        }
    }
}
