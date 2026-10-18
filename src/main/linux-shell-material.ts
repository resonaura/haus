import { watch as watchFile } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SidebarMaterial } from '../shared/native';

const execFileAsync = promisify(execFile);
export const BLUR_MY_SHELL_UUID = 'blur-my-shell@aunetx';

export type LinuxDesktop = 'gnome' | 'kde' | 'hyprland';
export type LinuxBlurMaterial = 'blur-my-shell' | 'kwin-blur' | 'hyprland-blur';

export function detectLinuxDesktop(
  environment: NodeJS.ProcessEnv = process.env,
): LinuxDesktop | null {
  const desktop = [
    environment.XDG_CURRENT_DESKTOP,
    environment.DESKTOP_SESSION,
    environment.GDMSESSION,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(':');
  if (environment.HYPRLAND_INSTANCE_SIGNATURE || /hyprland/i.test(desktop)) return 'hyprland';
  if (/kde|plasma/i.test(desktop) || environment.KDE_FULL_SESSION === 'true') return 'kde';
  if (/gnome|ubuntu/i.test(desktop)) return 'gnome';
  return null;
}

export function isGnomeDesktop(environment: NodeJS.ProcessEnv = process.env): boolean {
  return detectLinuxDesktop(environment) === 'gnome';
}

export function hasBlurMyShell(enabledExtensions: string): boolean {
  return (
    enabledExtensions.includes(`'${BLUR_MY_SHELL_UUID}'`) ||
    enabledExtensions.includes('"' + BLUR_MY_SHELL_UUID + '"')
  );
}

export function hasKWinBlur(configuration: string): boolean {
  let section = '';
  for (const line of configuration.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }
    if (section !== 'plugins') continue;
    const setting = line.match(/^\s*blurEnabled\s*=\s*(true|false|1|0)\s*(?:[;#].*)?$/i);
    if (setting) return /^(true|1)$/i.test(setting[1]);
  }
  return false;
}

export function hasHyprlandBlur(option: string): boolean {
  try {
    const parsed: unknown = JSON.parse(option);
    if (!parsed || typeof parsed !== 'object') return false;
    const record = parsed as Record<string, unknown>;
    const enabled =
      record.int === 1 ||
      record.bool === true ||
      (typeof record.str === 'string' && /^(true|1)$/i.test(record.str));
    return enabled && record.set !== false;
  } catch {
    return false;
  }
}

export interface LinuxShellMaterialRuntime {
  desktop(): LinuxDesktop | null;
  readEnabledExtensions(): Promise<string>;
  readKWinConfiguration(): Promise<string>;
  readHyprlandBlurOption(): Promise<string>;
  watch(desktop: LinuxDesktop, callback: () => void): () => void;
}

function userConfigurationDirectory(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

const systemRuntime: LinuxShellMaterialRuntime = {
  desktop: () => (process.platform === 'linux' ? detectLinuxDesktop() : null),
  async readEnabledExtensions() {
    const { stdout } = await execFileAsync(
      'gsettings',
      ['get', 'org.gnome.shell', 'enabled-extensions'],
      { timeout: 1500, encoding: 'utf8' },
    );
    return stdout;
  },
  async readKWinConfiguration() {
    return readFile(join(userConfigurationDirectory(), 'kwinrc'), 'utf8');
  },
  async readHyprlandBlurOption() {
    const { stdout } = await execFileAsync(
      'hyprctl',
      ['getoption', 'decoration:blur:enabled', '-j'],
      {
        timeout: 1500,
        encoding: 'utf8',
      },
    );
    return stdout;
  },
  watch(desktop, callback) {
    if (desktop === 'gnome') {
      try {
        const monitor = spawn('gsettings', ['monitor', 'org.gnome.shell', 'enabled-extensions'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        monitor.stdout?.on('data', callback);
        monitor.on('error', () => {
          /* Keep the last known material when GNOME's settings bus is unavailable. */
        });
        return () => monitor.kill();
      } catch {
        return () => {};
      }
    }
    if (desktop === 'kde') {
      try {
        const watcher = watchFile(
          userConfigurationDirectory(),
          { persistent: false },
          (_event, filename) => {
            if (!filename || filename.toString() === 'kwinrc') callback();
          },
        );
        return () => watcher.close();
      } catch {
        return () => {};
      }
    }
    const timer = setInterval(callback, 4000);
    timer.unref();
    return () => clearInterval(timer);
  },
};

/** Tracks compositor blur preferences and keeps the sidebar opaque if blur is off. */
export class LinuxShellMaterial {
  private removeMonitor: (() => void) | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  material: SidebarMaterial = 'none';

  constructor(
    private readonly onChange: (material: SidebarMaterial) => void,
    private readonly runtime: LinuxShellMaterialRuntime = systemRuntime,
  ) {}

  async start(): Promise<void> {
    const desktop = this.runtime.desktop();
    if (!desktop || this.disposed) return;
    await this.refresh(desktop);
    if (this.disposed) return;
    this.removeMonitor = this.runtime.watch(desktop, () => this.scheduleRefresh(desktop));
  }

  private async refresh(desktop: LinuxDesktop): Promise<void> {
    let material: LinuxBlurMaterial | 'none' = 'none';
    try {
      if (desktop === 'gnome' && hasBlurMyShell(await this.runtime.readEnabledExtensions()))
        material = 'blur-my-shell';
      else if (desktop === 'kde' && hasKWinBlur(await this.runtime.readKWinConfiguration()))
        material = 'kwin-blur';
      else if (
        desktop === 'hyprland' &&
        hasHyprlandBlur(await this.runtime.readHyprlandBlurOption())
      )
        material = 'hyprland-blur';
    } catch {
      material = 'none';
    }
    this.setMaterial(material);
  }

  private setMaterial(material: SidebarMaterial): void {
    if (this.disposed || this.material === material) return;
    this.material = material;
    this.onChange(material);
  }

  private scheduleRefresh(desktop: LinuxDesktop): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(desktop), 120);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    this.removeMonitor?.();
    this.removeMonitor = undefined;
  }
}
