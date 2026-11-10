import { startBroker } from './broker';
import { runtimeDirectory } from './runtime';

const broker = await startBroker(runtimeDirectory());
let stopping = false;
const stop = () => {
    if (stopping) return;
    stopping = true;
    void broker.close().finally(() => { process.exitCode = 0 });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
