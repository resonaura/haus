import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectLinuxDesktop } from './linux-shell-material';
import { readYuzuOSAppearance } from './yuzuos-appearance';
import type { TrafficLightArtwork } from '../shared/native';
const run = promisify(execFile);
export const KIWI_UUID = 'kiwi@kemma';
export const YUZUOS_UUID = 'yuzuos@resonaura.local';
const read = async (args: string[]) =>
  (await run('gsettings', args, { timeout: 1500, maxBuffer: 65536 })).stdout.trim();
export function kiwiControlsEnabled(
  extensions: string,
  disabled: string,
  state: string,
  buttons: string,
) {
  return (
    new RegExp(`['"]${KIWI_UUID}['"]`).test(extensions) &&
    disabled !== 'true' &&
    /['"]state['"]:\s*<(?:uint32\s+|int32\s+|double\s+)?1(?:\.0+)?>/.test(state) &&
    buttons !== 'false'
  );
}
export function yuzuosControlsEnabled(
  extensions: string,
  disabled: string,
  state: string,
  style: string,
) {
  const cleanStyle = style.replace(/^['"]|['"]$/g, '');
  return (
    new RegExp(`['"]${YUZUOS_UUID}['"]`).test(extensions) &&
    disabled !== 'true' &&
    /['"]state['"]:\s*<(?:uint32\s+|int32\s+|double\s+)?1(?:\.0+)?>/.test(state) &&
    cleanStyle !== 'off'
  );
}
export interface LinuxWindowControls {
  enabled: boolean;
  trafficLights?: TrafficLightArtwork;
}
export async function readLinuxWindowControls(): Promise<LinuxWindowControls> {
  if (process.platform !== 'linux' || detectLinuxDesktop() !== 'gnome') return { enabled: false };
  try {
    const [extensions, disabled] = await Promise.all([
      read(['get', 'org.gnome.shell', 'enabled-extensions']),
      read(['get', 'org.gnome.shell', 'disable-user-extensions']),
    ]);
    if (disabled === 'true') return { enabled: false };
    const yuzuos = await readYuzuOSAppearance();
    if (yuzuos.controls) return { enabled: true, trafficLights: yuzuos.trafficLights };
    if (new RegExp(`['"]${KIWI_UUID}['"]`).test(extensions)) {
      const info = await run(
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
          KIWI_UUID,
        ],
        { timeout: 1500, maxBuffer: 65536 },
      );
      let buttons = 'true';
      for (const directory of [
        undefined,
        join(
          process.env.XDG_DATA_HOME || join(homedir(), '.local/share'),
          'gnome-shell/extensions',
          KIWI_UUID,
          'schemas',
        ),
        `/usr/share/gnome-shell/extensions/${KIWI_UUID}/schemas`,
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
      return { enabled: kiwiControlsEnabled(extensions, disabled, info.stdout, buttons) };
    }
    return { enabled: false };
  } catch {
    return { enabled: false };
  }
}
export async function readKiwiControls() {
  return (await readLinuxWindowControls()).enabled;
}
export function watchKiwiControls(update: (kiwi: boolean, artwork?: TrafficLightArtwork) => void) {
  if (process.platform !== 'linux' || detectLinuxDesktop() !== 'gnome') return () => {};
  let active = true,
    busy = false;
  const refresh = async () => {
    if (busy || !active) return;
    busy = true;
    try {
      const state = await readLinuxWindowControls();
      if (active) update(state.enabled, state.trafficLights);
    } finally {
      busy = false;
    }
  };
  const monitor = spawn('gsettings', ['monitor', 'org.gnome.shell'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  monitor.stdout.on('data', () => void refresh());
  monitor.on('error', () => {});
  const timer = setInterval(() => void refresh(), 2000);
  timer.unref();
  return () => {
    active = false;
    monitor.kill();
    clearInterval(timer);
  };
}
