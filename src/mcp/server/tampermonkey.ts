import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { TampermonkeyWebSocketServer } from './tampermonkey-ws-client';
import { logger as console } from '../../shared/logger';

let serverPromise: Promise<TampermonkeyWebSocketServer> | null = null;

/**
 * Get or create the WebSocket server instance
 */
async function getServer(): Promise<TampermonkeyWebSocketServer> {
    if (!serverPromise) {
        serverPromise = (async () => {
            const wsServer = new TampermonkeyWebSocketServer();
            // Wait for the server to be ready and display the connection code
            const code = await wsServer.onCode();
            console.log(`\n[TampermonkeyWS] Connection code: ${code}`);
            console.log('[TampermonkeyWS] Open the Tampermonkey Editors extension and enter this code to connect.\n');
            return wsServer;
        })();
    }
    return serverPromise;
}

/**
 * Check if the server is connected, throw if not
 */
function ensureConnected(wsServer: TampermonkeyWebSocketServer): void {
    if (!wsServer.isConnected) {
        throw new Error('Not connected to Tampermonkey Editors. Call tampermonkey_get_connection_code first to get the connection code, then enter it in the Tampermonkey Editors extension to connect.');
    }
}

// eslint-disable-next-line @typescript-eslint/require-await
export const init = async (mcpServer: McpServer) => {

    // Tool: tampermonkey_get_connection_code
    mcpServer.tool(
        'tampermonkey_get_connection_code',
        `
        REQUIRED FIRST STEP: Get the connection code to connect Tampermonkey Editors to the MCP server.

        **How it works:**
        The MCP server creates a WebSocket server that waits for Tampermonkey Editors to connect.
        You must call this tool FIRST to start the WebSocket server and get a connection code.
        Then enter the code in the Tampermonkey Editors extension - it will connect TO the MCP server.

        **Steps:**
        1. Call this tool to get the connection code
        2. Open Tampermonkey Editors extension in your browser
        3. Enter the code in the extension popup
        4. The extension connects to the MCP server's WebSocket
        5. After connection, you can use tampermonkey_list, tampermonkey_get, tampermonkey_patch, tampermonkey_put, tampermonkey_delete

        **Output:**
            - \`code\`: The connection code to enter in Tampermonkey Editors
        `,
        {},
        async () => {
            const wsServer = await getServer();
            const code = wsServer.code;
            return {
                content: [
                    {
                        type: 'text',
                        text: `Connection code: ${code}\n\nIMPORTANT: The MCP server opens a WebSocket server and waits for Tampermonkey Editors to connect. Ask the user to: \n\n1. Open the Tampermonkey Editors extension\n2. Enter this code in the extension\n3. The extension will connect to the MCP server\n\nAfter the extension connects, you can use the other tampermonkey_* tools.`,
                    },
                ],
            };
        }
    );

    // Tool: tampermonkey_list
    mcpServer.tool(
        'tampermonkey_list',
        `
        List all userscripts available in Tampermonkey.

        **Input:**
            - \`pattern\` (optional): Filter scripts by name pattern
            - \`includePattern\` (optional): Filter scripts by include URL pattern

        **Output:**
            Array of userscript metadata including:
            - \`name\`: Script name
            - \`namespace\`: Script namespace
            - \`path\`: Script path (used for get/patch operations)
            - \`requires\`: List of @require dependencies
            - \`storage\`: Storage path (if any)
        `,
        {
            pattern: z.string().optional().describe('Filter scripts by name pattern'),
            includePattern: z.array(z.string()).optional().describe('Filter scripts by include URL pattern'),
        },
        async (args) => {
            const wsServer = await getServer();
            ensureConnected(wsServer);

            const filter = args.pattern || args.includePattern
                ? {
                    content: args.pattern
                        ? { pattern: args.pattern }
                        : undefined,
                    location: args.includePattern
                        ? { includePattern: args.includePattern }
                        : undefined,
                }
                : undefined;

            try {
                const resp = await wsServer.list(filter);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(resp, null, 2),
                        },
                    ],
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error listing scripts: ${String(e)}`,
                        },
                    ],
                };
            }
        }
    );

    // Tool: tampermonkey_get
    mcpServer.tool(
        'tampermonkey_get',
        `
        Get the content of a specific userscript.

        **Input:**
            - \`path\`: The script path (from list operation)
            - \`ifNotModifiedSince\` (optional): Unix timestamp - only return if script was modified after this time

        **Output:**
            - \`value\`: The script source code
            - \`lastModified\`: Unix timestamp of last modification
            - \`error\`: Error object if script not found or concurrent edit detected
        `,
        {
            path: z.string().describe('The script or resource path (<script-uuid>/source, <script-uuid>/storage or <script-uuid>/<external-resource-url>'),
            ifNotModifiedSince: z.number().optional().describe('Unix timestamp - only return if script was modified after this time'),
        },
        async (args) => {
            const wsServer = await getServer();
            ensureConnected(wsServer);

            try {
                const resp = await wsServer.get(args.path, args.ifNotModifiedSince);
                return {
                    content: [
                        {
                            type: 'text',
                            text: resp.error
                                ? JSON.stringify(resp.error)
                                : `${resp.value || ''}\n\n---\nLast modified: ${new Date(resp.lastModified || 0).toISOString()}`,
                        },
                    ],
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error getting script: ${String(e)}`,
                        },
                    ],
                };
            }
        }
    );

    // Tool: tampermonkey_patch
    mcpServer.tool(
        'tampermonkey_patch',
        `
        Update the content of a userscript.

        **Input:**
            - \`path\`: The script or resource path (from list operation)
            - \`value\`: The new script content
            - \`lastModified\` (optional): Unix timestamp for optimistic locking

        **Output:**
            - \`success\`: true if patch was applied successfully
            - \`error\`: Error object if patch failed (e.g., concurrent edit conflict)
        `,
        {
            path: z.string().describe('The script path (e.g., "<script-uuid>/source")'),
            value: z.string().describe('The new script content'),
            lastModified: z.number().optional().describe('Unix timestamp for optimistic locking'),
        },
        async (args) => {
            const wsServer = await getServer();
            ensureConnected(wsServer);

            try {
                const resp = await wsServer.patch(args.path, args.value, args.lastModified);
                return {
                    content: [
                        {
                            type: 'text',
                            text: resp.error
                                ? JSON.stringify(resp.error)
                                : 'Script updated successfully',
                        },
                    ],
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error patching script: ${String(e)}`,
                        },
                    ],
                };
            }
        }
    );

    // Tool: tampermonkey_put
    mcpServer.tool(
        'tampermonkey_put',
        `
        Create a new userscript.

        **Input:**
            - \`value\`: The script source code content
            - \`lastModified\` (optional): Unix timestamp for optimistic locking

        **Output:**
            - \`success\`: true if script was created successfully
            - \`path/name\`: The path and name of the new script
            - \`error\`: Error object if creation failed (e.g., script already exists, concurrent edit conflict)
        `,
        {
            value: z.string().describe('The script source code content'),
            lastModified: z.number().optional().describe('Unix timestamp for optimistic locking'),
        },
        async (args) => {
            const wsServer = await getServer();
            ensureConnected(wsServer);

            try {
                const resp = await wsServer.put(args.value, args.lastModified);
                return {
                    content: [
                        {
                            type: 'text',
                            text: resp.error
                                ? JSON.stringify(resp.error)
                                : 'Script created successfully',
                        },
                    ],
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error creating script: ${String(e)}`,
                        },
                    ],
                };
            }
        }
    );

    // Tool: tampermonkey_delete
    mcpServer.tool(
        'tampermonkey_delete',
        `
        Delete a userscript by path.

        **Input:**
            - \`path\`: The script or resource path (<script-uuid>/source, <script-uuid>/storage or <script-uuid>/<external-resource-url>)

        **Output:**
            - \`success\`: true if script was deleted successfully
            - \`error\`: Error object if deletion failed (e.g., script not found)
        `,
        {
            path: z.string().describe('The script or resource path (<script-uuid>/source, <script-uuid>/storage or <script-uuid>/<external-resource-url>)'),
        },
        async (args) => {
            const wsServer = await getServer();
            ensureConnected(wsServer);

            try {
                const resp = await wsServer.delete(args.path);
                return {
                    content: [
                        {
                            type: 'text',
                            text: resp.error
                                ? JSON.stringify(resp.error)
                                : 'Script deleted successfully',
                        },
                    ],
                };
            } catch (e) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error deleting script: ${String(e)}`,
                        },
                    ],
                };
            }
        }
    );

    console.log('[TampermonkeyWS] MCP tools initialized');
};
