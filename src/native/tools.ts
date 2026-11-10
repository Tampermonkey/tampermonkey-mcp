import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { z } from 'zod';
import { ensureBroker, brokerRequest } from './runtime';
import { validateCommand, object, MAX_SOURCE, type Command } from './protocol';

export async function nativeStdio(): Promise<void> {
    let connection = await ensureBroker();
    const current = async () => {
        try { await brokerRequest(connection, '/health', undefined, 1000) }
        catch { connection = await ensureBroker() }
        return connection;
    };
    const server = new McpServer({ name: 'tampermonkey-mcp', version: '1.0.0' });
    const call = async (command: Command) => {
        try {
            validateCommand(command, true);
            const response = await brokerRequest(await current(), '/command', command);
            const result = response.body;
            return { isError: response.status !== 200 || (object(result) && !!result.error), content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch {
            // Never reconnect and replay a failed call: a source patch may
            // already have reached Tampermonkey before its response was lost.
            return { isError: true, content: [{ type: 'text' as const, text: 'Native connection unavailable. This call was not retried; its outcome may be unknown.' }] };
        }
    };
    server.registerTool('tampermonkey_list', { description: 'List installed userscript metadata through the approved native connection.', inputSchema: {}, annotations: { readOnlyHint: true } }, () => call({ action: 'list' }));
    server.registerTool('tampermonkey_get', { description: 'Read existing userscript source and its lastModified revision. Storage and external resources are unavailable.', inputSchema: { path: z.string() }, annotations: { readOnlyHint: true } }, args => call({ action: 'get', path: args.path }));
    server.registerTool('tampermonkey_patch', { description: 'Update existing userscript source using the revision from a prior read. Requires source updates enabled in Editors.', inputSchema: {
        path: z.string(), value: z.string().max(MAX_SOURCE), lastModified: z.number().finite().nonnegative(),
    }, annotations: { destructiveHint: false } }, args => call({ action: 'patch', ...args }));
    server.registerTool('tampermonkey_connection_status', { description: 'Check the native connection. No pairing code is needed. Enable the native connection in Editors after installing the native host.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
        try {
            const response = await brokerRequest(await current(), '/health', undefined, 1500);
            return { content: [{ type: 'text', text: JSON.stringify(response.body) }] };
        } catch { return { isError: true, content: [{ type: 'text', text: 'Native broker unavailable. Check the native host setup.' }] } }
    });
    await server.connect(new StdioServerTransport());
    process.stdin.on('end', () => { void server.close() });
}
