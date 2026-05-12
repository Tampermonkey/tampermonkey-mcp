import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types';
import { init as initTampermonkey } from './tampermonkey';
import express, { NextFunction, Request, Response, Router } from 'express';
import { D } from '../../shared/constants';
import { randomUUID } from 'crypto';
import { logger as console } from '../../shared/logger';

const transports: {[sessionId: string]: StreamableHTTPServerTransport} = {};
const MCP_ENDPOINT = '/mcp';

export type ServerMode = 'all' | 'dynamic' | 'explicit';

function toAscii(chunk?: unknown): string {
    if (!chunk) return '';

    if (typeof chunk === 'string') return chunk;

    if (chunk instanceof Uint8Array) {
        return Buffer.from(chunk).toString('ascii');
    }

    if (typeof chunk === 'object' && chunk !== null) {
        return JSON.stringify(chunk);
    }

    if (typeof chunk === 'number' || typeof chunk === 'boolean') {
        return String(chunk);
    }

    return '';
}

function createResponseProxy(res: Response) {
    const chunks: string[] = [];

    const proxy = new Proxy(res, {
        get(target, prop, receiver) {
            if (prop === 'write') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return function (chunk: unknown, ...args: any[]) {
                    chunks.push(toAscii(chunk));
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    return target.write(chunk, ...args);
                };
            }

            if (prop === 'end') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return function (chunk?: unknown, ...args: any[]) {
                    if (chunk) chunks.push(toAscii(chunk));

                    const fullBody = chunks.join('');
                    console.log('[response]', fullBody);

                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    return target.end(chunk, ...args);
                };
            }

            if (prop === 'send') {
                return function (body: unknown) {
                    const text = toAscii(body);
                    console.log('[response.send]', text);
                    return target.send(body);
                };
            }

            if (prop === 'json') {
                return function (body: unknown) {
                    console.log('[response.json]', JSON.stringify(body));
                    return target.json(body);
                };
            }

            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return Reflect.get(target, prop, receiver);
        }
    });

    return proxy;
}

export async function http(host: string, port = 6000): Promise<void> {
    const app = express();
    app.use(express.json());
    const middleware = await createMcpMiddleware(MCP_ENDPOINT);
    app.use(middleware);

    app.listen(port, host, () => {
        if (D) console.log(`MCP Streamable HTTP Server listening on port ${port}`);
    });
    await new Promise(() => undefined);
}

export async function createMcpMiddleware(endpoint: string): Promise<(req: Request, res: Response, next: NextFunction) => void> {
    const router = Router();

    // https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#streamable-http
    router.post(endpoint, async (req: Request, res: Response) => {
        if (D) console.log('message request received: ', req.body);
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'];
        let transport: StreamableHTTPServerTransport;

        if (typeof sessionId === 'string' && transports[sessionId]) {
            // Reuse existing transport
            transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
            // New initialization request
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sessionId) => {
                    // Store the transport by session ID
                    transports[sessionId] = transport;
                },
                // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
                // locally, make sure to set:
                // enableDnsRebindingProtection: true,
                // allowedHosts: ['127.0.0.1'],
            });

            // Clean up transport when closed
            transport.onclose = () => {
                if (transport.sessionId) {
                    delete transports[transport.sessionId];
                }
            };

            await server.connect(transport);
        } else {
            // Invalid request
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided',
                },
                id: null,
            });
            return;
        }

        const resProxy = D ? createResponseProxy(res) : res;

        // Handle the request
        await transport.handleRequest(req, resProxy, req.body);
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
        const sessionId = req.headers['mcp-session-id'];
        if (typeof sessionId !== 'string' || !transports[sessionId]) {
            res.status(400).send('Invalid or missing session ID');
            return;
        }

        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    };

    // initialization: create a new transport to connect and send an endpoint event containing a URI for the client to use for sending messages
    router.get(endpoint, async (req: Request, res: Response) => {
        if (D) console.log('connection request received');

        return await handleSessionRequest(req, res);
    });

    router.delete(endpoint, async (req: Request, res: Response) => {
        if (D) console.log('delete request received');

        return await handleSessionRequest(req, res);
    });

    await init();

    return function(req: Request, res: Response, next: NextFunction) {
        if (!req.path.startsWith(endpoint)) {
            return next();
        }
        router(req, res, next);
    };
}

export async function stdio(): Promise<void> {
    const transport = new StdioServerTransport();

    await init();
    await server.connect(transport)
    .catch((error) => {
        console.error('Fatal error in stdio():', error);
        process.exit(1);
    });
}

// Create server instance
let server: McpServer;

async function init(): Promise<string | undefined> {
    let system: string | undefined;

    if (!server) {
        server = new McpServer({
            name: 'tampermonkey-mcp',
            version: '1.0.0',
        });
    }

    try {
        await initTampermonkey(server);
    } catch(error) {
        console.error('Fatal error in init():', error);
        process.exit(1);
    }

    return system;
}

export async function proxy(transport: Transport): Promise<string | undefined> {
    const s = await init();
    await server.connect(transport);
    return s;
}