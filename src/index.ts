#!/usr/bin/env node
import { http, stdio } from './mcp/server/server';
import { getCommandLineArgs } from './shared/get_cmdline_args';
import { logger as console, VERBOSE } from './shared/logger';

async function main() {
    const argv = getCommandLineArgs();

    const transport: string = argv.transport || 'stdio';
    const port: number = argv.port || 4001;
    const host = 'localhost';

    if (transport === 'http') {
        console.set(VERBOSE);
        await http(host, port);
    } else if (transport === 'stdio') {
        console.set(VERBOSE, true);
        await stdio();
    } else {
        throw new Error(`Unknown transport type: ${transport}`);
    }
}

main()
.catch((err) => console.error(err));