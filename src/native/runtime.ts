import { mkdir, lstat, readFile, open, unlink, chmod, readdir } from 'node:fs/promises';
import { join, isAbsolute, resolve, parse } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { generate } from 'selfsigned';

export type Credentials = { token: string; cert: string; key: string };
export type Connection = Credentials & { port: number; directory: string };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function runtimeDirectory(): string {
    const directory = process.env.TAMPERMONKEY_NATIVE_DIRECTORY ?? (process.platform === 'win32'
        ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'TampermonkeyMCP', 'native')
        : join(homedir(), '.local', 'share', 'tampermonkey-mcp', 'native'));
    if (!isAbsolute(directory)) throw new Error('Native runtime directory must be absolute');
    return directory;
}

export async function secureDirectory(directory: string): Promise<void> {
    const absolute = resolve(directory);
    if (absolute === parse(absolute).root || absolute === resolve(homedir()) || absolute === resolve(process.cwd())) {
        throw new Error('Use a dedicated native runtime directory');
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
        throw new Error('Native runtime must be an owned directory, not a symlink');
    }
    const known = new Set(['credentials.json', 'address.json', 'start.lock', 'native-host.cmd', 'native-host', 'firefox-manifest.json', 'chrome-manifest.json']);
    if ((await readdir(directory)).some(name => !known.has(name))) throw new Error('Native runtime contains unrelated files; refusing to change its permissions');
    if (process.platform === 'win32') {
        // Build a fresh protected DACL, rather than retaining explicit grants
        // from an existing directory. The path is data, never shell source.
        const script = `$ErrorActionPreference='Stop';$identity=[Security.Principal.WindowsIdentity]::GetCurrent();
$acl=New-Object Security.AccessControl.DirectorySecurity;
$acl.SetOwner($identity.User);$acl.SetAccessRuleProtection($true,$false);
foreach($sid in @($identity.User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)};
[IO.Directory]::SetAccessControl($env:TAMPERMONKEY_NATIVE_SECURE_PATH,$acl);
foreach($name in @('credentials.json','address.json','start.lock','native-host.cmd','native-host','firefox-manifest.json','chrome-manifest.json')){
$file=[IO.Path]::Combine($env:TAMPERMONKEY_NATIVE_SECURE_PATH,$name);
if([IO.File]::Exists($file)){
if(([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unsafe native runtime file'};
$fileAcl=New-Object Security.AccessControl.FileSecurity;$fileAcl.SetOwner($identity.User);$fileAcl.SetAccessRuleProtection($true,$false);
foreach($sid in @($identity.User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow');$fileAcl.AddAccessRule($rule)};
[IO.File]::SetAccessControl($file,$fileAcl)}};`;
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
            windowsHide: true, encoding: 'utf8', env: { ...process.env, TAMPERMONKEY_NATIVE_SECURE_PATH: directory },
        });
        if (result.status !== 0) throw new Error('Unable to protect the native runtime directory');
    } else await chmod(directory, 0o700);
}

async function privateFile(path: string): Promise<string> {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) {
        throw new Error('Unsafe native runtime file');
    }
    return readFile(path, 'utf8');
}

export async function credentials(directory: string): Promise<Credentials> {
    await secureDirectory(directory);
    const path = join(directory, 'credentials.json');
    const token = randomBytes(32).toString('base64url');
    try {
        const file = await open(path, 'wx', 0o600);
        try {
            const expires = new Date(); expires.setFullYear(expires.getFullYear() + 10);
            const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
                keySize: 2048, algorithm: 'sha256', notAfterDate: expires,
                extensions: [{ name: 'basicConstraints', cA: false },
                    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                    { name: 'extKeyUsage', serverAuth: true },
                    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
            });
            await file.writeFile(JSON.stringify({ token, cert: pems.cert, key: pems.private })); await file.sync();
        } finally { await file.close() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    // An overlapping initial creator may still be writing its exclusive file.
    for (let n = 0; n < 100; n++) {
        const raw = await privateFile(path);
        if (!raw && n < 99) { await delay(50); continue }
        let saved: unknown;
        try { saved = JSON.parse(raw) as unknown }
        catch { throw new Error('Invalid native credentials; refusing to replace them') }
        if (!saved || typeof saved !== 'object' || !('token' in saved) || typeof saved.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.token) ||
            !('cert' in saved) || typeof saved.cert !== 'string' || !saved.cert.startsWith('-----BEGIN CERTIFICATE-----') ||
            !('key' in saved) || typeof saved.key !== 'string' || !saved.key.startsWith('-----BEGIN PRIVATE KEY-----')) {
            throw new Error('Invalid native credentials; refusing to replace them');
        }
        return { token: saved.token, cert: saved.cert, key: saved.key };
    }
    throw new Error('Native credentials unavailable');
}

export function brokerRequest(connection: Pick<Connection, 'port' | 'token' | 'cert'>, path: '/health' | '/command', command?: unknown, timeout = 35000): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const request = https.request({ hostname: '127.0.0.1', port: connection.port, path, method: command === undefined ? 'GET' : 'POST',
            ca: connection.cert, rejectUnauthorized: true, agent: false,
            headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' } }, response => {
            const chunks: Buffer[] = []; let bytes = 0;
            response.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 1024 * 1024) { request.destroy(new Error('Native broker response exceeds the size limit')); return }
                chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
                try { resolve({ status: response.statusCode ?? 500, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }) }
                catch { reject(new Error('Invalid native broker response')) }
            });
        });
        request.setTimeout(timeout, () => request.destroy(new Error('Native broker request timed out')));
        request.on('error', reject);
        request.end(command === undefined ? undefined : JSON.stringify(command));
    });
}

export async function health(directory: string, saved: Credentials): Promise<Connection | null> {
    try {
        const address: unknown = JSON.parse(await privateFile(join(directory, 'address.json')));
        if (!address || typeof address !== 'object' || !('port' in address) || typeof address.port !== 'number' ||
            !Number.isInteger(address.port) || address.port < 1024 || address.port > 65535) return null;
        const response = await brokerRequest({ ...saved, port: address.port }, '/health', undefined, 800);
        if (response.status !== 200) return null;
        const body = response.body;
        return body && typeof body === 'object' && 'protocol' in body && body.protocol === 1
            ? { ...saved, port: address.port, directory } : null;
    } catch { return null }
}

export async function ensureBroker(directory = runtimeDirectory()): Promise<Connection> {
    const saved = await credentials(directory);
    const current = await health(directory, saved);
    if (current) return current;
    const path = join(directory, 'start.lock');
    let lock;
    try { lock = await open(path, 'wx', 0o600) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Recover only a dead creator's lock. Never remove a live/unknown lock.
        try {
            const pid = Number(await privateFile(path));
            if (Number.isInteger(pid) && pid > 0) {
                try { process.kill(pid, 0) } catch (failure) {
                    if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
                        await unlink(path); return ensureBroker(directory);
                    }
                }
            }
        } catch { /* Another starter may have released its lock already. */ }
    }
    if (lock) {
        try {
            await lock.writeFile(String(process.pid));
            const second = await health(directory, saved);
            if (second) return second;
            const child = spawn(process.execPath, [fileURLToPath(new URL('./broker-main.js', import.meta.url))], {
                detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, TAMPERMONKEY_NATIVE_DIRECTORY: directory },
            });
            child.on('error', () => undefined); child.unref();
            for (let n = 0; n < 80; n++) { await delay(100); const ready = await health(directory, saved); if (ready) return ready; }
            throw new Error('Native broker did not start');
        } finally { await lock.close(); await unlink(path).catch(() => undefined) }
    }
    for (let n = 0; n < 100; n++) { await delay(100); const ready = await health(directory, saved); if (ready) return ready; }
    throw new Error('Native broker startup is busy; inspect its private start.lock');
}
