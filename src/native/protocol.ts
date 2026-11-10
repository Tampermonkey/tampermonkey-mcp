import { endianness } from 'node:os';

export const HOST_NAME = 'net.tampermonkey.editors_mcp';
export const PROTOCOL = 1;
export const MAX_MESSAGE = 1024 * 1024;
export const MAX_SOURCE = 512 * 1024;
export type Command = { action: 'list' } | { action: 'get'; path: string } |
    { action: 'patch'; path: string; value: string; lastModified: number };
export type Result = Record<string, unknown>;

export function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateCommand(value: unknown, write: boolean): Command {
    if (!object(value)) throw new Error('Invalid native command');
    const keys = Object.keys(value);
    if (value.action === 'list' && keys.length === 1) return { action: 'list' };
    if (typeof value.path !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/source$/i.test(value.path)) {
        throw new Error('Native access is limited to existing userscript source');
    }
    if (value.action === 'get' && keys.length === 2) return { action: 'get', path: value.path };
    if (value.action === 'patch' && keys.length === 4 && write && typeof value.value === 'string' &&
        Buffer.byteLength(value.value, 'utf8') <= MAX_SOURCE && typeof value.lastModified === 'number' &&
        Number.isFinite(value.lastModified) && value.lastModified >= 0) {
        return { action: 'patch', path: value.path, value: value.value, lastModified: value.lastModified };
    }
    throw new Error('Native command is unsupported or source updates have not been approved');
}

export function encode(value: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    if (!body.length || body.length > MAX_MESSAGE) throw new Error('Native message exceeds the size limit');
    const header = Buffer.alloc(4);
    if (endianness() === 'LE') header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
    return Buffer.concat([header, body]);
}

// Reject the advertised size before buffering an unbounded frame. Support
// fragmented headers/bodies and several messages in one pipe read.
export class Decoder {
    private buffered = Buffer.alloc(0);
    private size: number | null = null;
    push(chunk: Buffer): unknown[] {
        const values: unknown[] = [];
        let offset = 0;
        while (offset < chunk.length) {
            const needed = (this.size ?? 4) - this.buffered.length;
            const count = Math.min(needed, chunk.length - offset);
            this.buffered = Buffer.concat([this.buffered, chunk.subarray(offset, offset + count)]);
            offset += count;
            if (this.buffered.length !== (this.size ?? 4)) continue;
            if (this.size === null) {
                this.size = endianness() === 'LE' ? this.buffered.readUInt32LE() : this.buffered.readUInt32BE();
                this.buffered = Buffer.alloc(0);
                if (!this.size || this.size > MAX_MESSAGE) throw new Error('Invalid native frame size');
            } else {
                values.push(JSON.parse(this.buffered.toString('utf8')) as unknown);
                this.buffered = Buffer.alloc(0);
                this.size = null;
            }
        }
        return values;
    }
    end(): void {
        if (this.size !== null || this.buffered.length) throw new Error('Truncated native frame');
    }
}
