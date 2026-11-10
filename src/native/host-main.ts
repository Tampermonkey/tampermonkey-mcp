import { WebSocket } from 'ws';
import { once } from 'node:events';
import { Decoder, encode, MAX_MESSAGE, object } from './protocol';
import { ensureBroker } from './runtime';

// Firefox passes its manifest path and extension ID; Chrome passes its origin.
// The browser enforces the installed manifest allowlist. These arguments are
// an additional sanity check, not proof against programs running as this user.
const allowed = ['editor-firefox@tampermonkey.net', 'chrome-extension://lieodnapokbjkkdkhdljlllmgkmdokcm/'];
if (!process.argv.slice(2).some(value => allowed.includes(value))) {
    process.stderr.write('Native host must be launched by Tampermonkey Editors.\n'); process.exit(1);
}

let socket: WebSocket | undefined;
let ending = false;
function stop(failed = false) {
    if (ending) return;
    ending = true;
    process.stdin.pause(); socket?.terminate();
    process.exitCode = failed ? 1 : 0;
    process.stdin.destroy();
}
try {
    const connection = await ensureBroker();
    socket = new WebSocket(`wss://127.0.0.1:${connection.port}/native`, {
        headers: { authorization: `Bearer ${connection.token}` }, ca: connection.cert, rejectUnauthorized: true, maxPayload: MAX_MESSAGE,
    });
    socket.on('error', () => stop(true));
    await once(socket, 'open');
    const decoder = new Decoder();
    socket.on('message', raw => {
        try {
            const value: unknown = JSON.parse(raw.toString());
            if (!object(value)) throw new Error('Invalid native message');
            if (!process.stdout.write(encode(value))) socket?.pause();
        } catch { stop(true) }
    });
    process.stdout.on('drain', () => socket?.resume());
    process.stdout.on('error', () => stop(true));
    socket.on('close', () => stop());
    process.stdin.on('data', (chunk: Buffer) => {
        try {
            for (const value of decoder.push(chunk)) {
                if (!object(value) || !socket || socket.readyState !== WebSocket.OPEN) throw new Error('Invalid native input');
                socket.send(JSON.stringify(value));
                if (socket.bufferedAmount > 2 * MAX_MESSAGE) throw new Error('Native input queue exceeded');
            }
        } catch { stop(true) }
    });
    process.stdin.on('end', () => { try { decoder.end(); stop() } catch { stop(true) } });
    process.stdin.on('error', () => stop(true));
} catch {
    process.stderr.write('Unable to start the native Editors connection.\n'); stop(true);
}
