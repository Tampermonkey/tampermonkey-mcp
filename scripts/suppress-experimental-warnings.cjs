// Suppress Node.js warning about experimental API
// Ref: https://github.com/nodejs/node/issues/30810#issuecomment-1383184769

/* global process */

(() => {
    // Warn again on every new node version!
    const NODE_VERSIONS = ['18.13.0', '16.19.0', '22.22.2' ];

    if (!NODE_VERSIONS.includes(process.versions.node)) return;

    const originalEmit = process.emit;
    process.emit = function (event, error) {
        if (
            event === 'warning' &&
            error.name === 'ExperimentalWarning'
        ) {
            return false;
        }

        return originalEmit.apply(process, arguments);
    };
})();