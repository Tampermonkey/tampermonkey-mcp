import { hideBin, quickArgs } from './args';

export const getCommandLineArgs = () => {
    const argv = {
        ...quickArgs(hideBin(process.argv))
        .option('transport', {
            alias: 't',
            type: 'string',
            choices: ['stdio', 'http'],
            description: 'Transport type to use (stdio or http)',
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
        .help()
        .parseSync()
    };
    return argv as {
        transport?: string
        port?: number
        mode?: string
    };
};