import { hideBin, quickArgs } from './args';

export const getCommandLineArgs = () => {
    const argv = {
        ...quickArgs(hideBin(process.argv))
        .option('transport', {
            alias: 't',
            type: 'string',
            choices: ['stdio', 'http', 'native'],
            description: 'Transport type to use (stdio, http or native messaging)',
        })
        .option('port', {
            alias: 'p',
            type: 'number',
            description: 'HTTP port for HTTP transport',
        })
        .option('mode', {
            alias: 'o',
            choices: [ 'dynamic', 'static' ],
        })
        .option('install-native-host', { type: 'string', choices: ['firefox', 'chrome'] })
        .option('uninstall-native-host', { type: 'string', choices: ['firefox', 'chrome'] })
        .help()
        .parseSync()
    };
    return argv as {
        transport?: string
        port?: number
        mode?: string
        'install-native-host'?: 'firefox' | 'chrome'
        'uninstall-native-host'?: 'firefox' | 'chrome'
    };
};
