import { mkdir, lstat, readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOST_NAME } from './protocol';
import { runtimeDirectory, secureDirectory } from './runtime';

export type Browser = 'firefox' | 'chrome';
type Environment = { platform: string; home: string; directory: string; node: string; entry: string };
const description = 'Tampermonkey MCP native source editor';

export function installationPlan(browser: Browser, environment: Environment) {
    const { platform, home, directory, node, entry } = environment;
    if (!['firefox', 'chrome'].includes(browser) || !['win32', 'darwin', 'linux'].includes(platform)) throw new Error('Unsupported native host platform or browser');
    const windows = platform === 'win32';
    const launcher = join(directory, windows ? 'native-host.cmd' : 'native-host');
    if ([node, entry].some(path => /[\0\r\n]/.test(path))) throw new Error('Invalid native host path');
    if (windows && [node, entry].some(path => /["%!\r\n]/.test(path))) throw new Error('Native host paths contain unsupported batch characters');
    const path = launcher;
    const manifest = {
        name: HOST_NAME, description, path, type: 'stdio',
        ...(browser === 'firefox' ? { allowed_extensions: ['editor-firefox@tampermonkey.net'] }
            : { allowed_origins: ['chrome-extension://lieodnapokbjkkdkhdljlllmgkmdokcm/'] }),
    };
    let destination: string;
    if (windows) destination = join(directory, `${browser}-manifest.json`);
    else if (platform === 'darwin') destination = join(home, 'Library', 'Application Support', browser === 'firefox' ? 'Mozilla' : 'Google/Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    else destination = join(home, ...(browser === 'firefox' ? ['.mozilla', 'native-messaging-hosts'] : ['.config', 'google-chrome', 'NativeMessagingHosts']), `${HOST_NAME}.json`);
    const key = windows ? `HKCU\\Software\\${browser === 'firefox' ? 'Mozilla' : 'Google\\Chrome'}\\NativeMessagingHosts\\${HOST_NAME}` : null;
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    const launcherSource = windows ? `@echo off\r\nrem Tampermonkey MCP native host\r\n"${node}" "${entry}" %*\r\n`
        : `#!/bin/sh\n# Tampermonkey MCP native host\nexec ${quote(node)} ${quote(entry)} "$@"\n`;
    return { manifest, destination, key, launcher, launcherSource };
}

async function existing(path: string): Promise<string | null> {
    try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing to replace a non-regular native host file');
        return readFile(path, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

export async function installNativeHost(browser: Browser, remove = false): Promise<void> {
    const environment = {
        platform: process.platform, home: homedir(), directory: runtimeDirectory(), node: process.execPath,
        entry: fileURLToPath(new URL('./host-main.js', import.meta.url)),
    };
    // Use the current absolute Node path on every OS. GUI-launched browsers
    // may not inherit a version manager's PATH.
    if (!isAbsolute(environment.entry)) throw new Error('Native host entry must be absolute');
    const plan = installationPlan(browser, environment);
    const previous = await existing(plan.destination);
    if (previous) {
        const value = JSON.parse(previous) as { name?: string; description?: string };
        if (value.name !== HOST_NAME || value.description !== description) throw new Error('Refusing to overwrite an unrelated native host manifest');
    }
    let registered: string | undefined;
    if (plan.key) {
        const current = spawnSync('reg.exe', ['query', plan.key, '/ve'], { encoding: 'utf8', windowsHide: true });
        registered = current.stdout?.match(/REG_SZ\s+(.+)/)?.[1].trim();
        if (registered && registered.toLowerCase() !== plan.destination.toLowerCase()) throw new Error('Native registry entry belongs to another installation');
    }
    if (remove) {
        if (plan.key) {
            if (registered) {
                const removed = spawnSync('reg.exe', ['delete', plan.key, '/f'], { windowsHide: true, stdio: 'pipe' });
                if (removed.status !== 0) throw new Error('Could not remove the native host registration');
            }
        }
        if (previous) await unlink(plan.destination);
        return;
    }
    await secureDirectory(environment.directory);
    await mkdir(dirname(plan.destination), { recursive: true });
    const oldLauncher = await existing(plan.launcher);
    const marker = process.platform === 'win32' ? '@echo off\r\nrem Tampermonkey MCP native host\r\n' : '#!/bin/sh\n# Tampermonkey MCP native host\n';
    if (oldLauncher && !oldLauncher.startsWith(marker)) throw new Error('Refusing to overwrite an unrelated launcher');
    await writeFile(plan.launcher, plan.launcherSource, { mode: 0o700 });
    if (process.platform !== 'win32') await chmod(plan.launcher, 0o700);
    await writeFile(plan.destination, JSON.stringify(plan.manifest, null, 2) + '\n', { mode: 0o600 });
    if (plan.key) {
        const registered = spawnSync('reg.exe', ['add', plan.key, '/ve', '/t', 'REG_SZ', '/d', plan.destination, '/f'], { windowsHide: true, stdio: 'pipe' });
        if (registered.status !== 0) throw new Error('Could not register the native host');
    }
}
