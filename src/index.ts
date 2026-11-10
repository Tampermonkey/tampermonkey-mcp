#!/usr/bin/env node
import { http, stdio } from './mcp/server/server';
import { getCommandLineArgs } from './shared/get_cmdline_args';
import { logger as console, VERBOSE } from './shared/logger';

async function main() {
    const argv = getCommandLineArgs();
    if (argv['install-native-host'] || argv['uninstall-native-host']) {
        if (argv['install-native-host'] && argv['uninstall-native-host']) throw new Error('Choose install or uninstall, not both');
        const { installNativeHost } = await import('./native/install');
        await installNativeHost((argv['install-native-host'] ?? argv['uninstall-native-host'])!, !!argv['uninstall-native-host']);
        return;
    }

    const transport: string = argv.transport || 'stdio';
    const port: number = argv.port || 4001;
    const host = 'localhost';

    if (transport === 'native') {
        const { nativeStdio } = await import('./native/tools');
        await nativeStdio();
    } else if (transport === 'http') {
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
.catch((err) => { console.error(err); process.exitCode = 1 });
