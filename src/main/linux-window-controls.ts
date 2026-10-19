import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectLinuxDesktop } from './linux-shell-material';
const run = promisify(execFile);
const uuid = 'kiwi@kemma';
const read = async (args: string[]) =>
  (await run('gsettings', args, { timeout: 1500, maxBuffer: 65536 })).stdout.trim();
export function kiwiControlsEnabled(
  extensions: string,
  disabled: string,
  state: string,
  buttons: string,
) {
  return (
    new RegExp(`['"]${uuid}['"]`).test(extensions) &&
    disabled !== 'true' &&
    /['"]state['"]:\s*<(?:uint32\s+|int32\s+|double\s+)?1(?:\.0+)?>/.test(state) &&
    buttons !== 'false'
  );
}
export async function readKiwiControls() {
  if (process.platform !== 'linux' || detectLinuxDesktop() !== 'gnome') return false;
  try {
    const [extensions, disabled, info] = await Promise.all([
      read(['get', 'org.gnome.shell', 'enabled-extensions']),
      read(['get', 'org.gnome.shell', 'disable-user-extensions']),
      run(
        'gdbus',
        [
          'call',
          '--session',
          '--dest',
          'org.gnome.Shell',
          '--object-path',
          '/org/gnome/Shell',
          '--method',
          'org.gnome.Shell.Extensions.GetExtensionInfo',
          uuid,
        ],
        { timeout: 1500, maxBuffer: 65536 },
      ),
    ]);
    let buttons = 'true';
    for (const directory of [
      undefined,
      join(
        process.env.XDG_DATA_HOME || join(homedir(), '.local/share'),
        'gnome-shell/extensions',
        uuid,
        'schemas',
      ),
      '/usr/share/gnome-shell/extensions/kiwi@kemma/schemas',
    ]) {
      try {
        buttons = await read([
          ...(directory ? ['--schemadir', directory] : []),
          'get',
          'org.gnome.shell.extensions.kiwi',
          'enable-app-window-buttons',
        ]);
        break;
      } catch {
        /* Extension schemas may be local rather than globally registered. */
      }
    }
    return kiwiControlsEnabled(extensions, disabled, info.stdout, buttons);
  } catch {
    return false;
  }
}
export function watchKiwiControls(update: (kiwi: boolean) => void) {
  if (process.platform !== 'linux' || detectLinuxDesktop() !== 'gnome') return () => {};
  let active = true,
    busy = false;
  const refresh = async () => {
    if (busy || !active) return;
    busy = true;
    try {
      const kiwi = await readKiwiControls();
      if (active) update(kiwi);
    } finally {
      busy = false;
    }
  };
  const monitor = spawn('gsettings', ['monitor', 'org.gnome.shell'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  monitor.stdout.on('data', () => void refresh());
  monitor.on('error', () => {});
  const timer = setInterval(() => void refresh(), 15000);
  timer.unref();
  return () => {
    active = false;
    monitor.kill();
    clearInterval(timer);
  };
}
