import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const BLUR_MY_SHELL_UUID = 'blur-my-shell@aunetx';

export function isGnomeDesktop(environment: NodeJS.ProcessEnv = process.env): boolean {
  return [environment.XDG_CURRENT_DESKTOP, environment.DESKTOP_SESSION]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => /gnome/i.test(value));
}

export function hasBlurMyShell(enabledExtensions: string): boolean {
  return new RegExp(`['"]${BLUR_MY_SHELL_UUID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(
    enabledExtensions,
  );
}

export interface LinuxShellMaterialRuntime {
  supported(): boolean;
  readEnabledExtensions(): Promise<string>;
  watch(callback: () => void): () => void;
}

const systemRuntime: LinuxShellMaterialRuntime = {
  supported: () => process.platform === 'linux' && isGnomeDesktop(),
  async readEnabledExtensions() {
    const { stdout } = await execFileAsync(
      'gsettings',
      ['get', 'org.gnome.shell', 'enabled-extensions'],
      { timeout: 1500, encoding: 'utf8' },
    );
    return stdout;
  },
  watch(callback) {
    try {
      const monitor = spawn('gsettings', ['monitor', 'org.gnome.shell', 'enabled-extensions'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      monitor.stdout?.on('data', callback);
      monitor.on('error', () => {
        /* The sidebar remains opaque when shell monitoring is unavailable. */
      });
      return () => monitor.kill();
    } catch {
      return () => {};
    }
  },
};

/** Detect GNOME's shell blur extension and track it while Haus is open. */
export class LinuxShellMaterial {
  private removeMonitor: (() => void) | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  enabled = false;

  constructor(
    private readonly onChange: (enabled: boolean) => void,
    private readonly runtime: LinuxShellMaterialRuntime = systemRuntime,
  ) {}

  async start(): Promise<void> {
    if (!this.runtime.supported() || this.disposed) return;
    await this.refresh();
    if (this.disposed) return;
    this.removeMonitor = this.runtime.watch(() => this.scheduleRefresh());
  }

  private async refresh(): Promise<void> {
    try {
      this.setEnabled(hasBlurMyShell(await this.runtime.readEnabledExtensions()));
    } catch {
      this.setEnabled(false);
    }
  }

  private setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.onChange(enabled);
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 120);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    this.removeMonitor?.();
    this.removeMonitor = undefined;
  }
}
