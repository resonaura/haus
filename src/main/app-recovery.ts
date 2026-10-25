import {
  app,
  clipboard,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { NATIVE_CHANNELS } from '../shared/native';
import {
  failureReport,
  validateFailure,
  type FailureReport,
  type RecoveryInfo,
} from '../shared/recovery';

interface RecoveryHost {
  window(): BrowserWindow | null;
  rendererUrl: string;
  recoveryUrl: string;
  suspend(): void;
  restore(): void;
  stopTalk(): void;
  stopApp(): void;
}

/** The recovery document is independent of React, HA, camera code and the application stylesheet. */
export class AppRecovery {
  private failure?: FailureReport;
  private fatal = false;
  private generation = 0;
  private bootTimer?: ReturnType<typeof setTimeout>;
  private recoveringDocument = false;
  private dialogShown = false;
  private reloading = false;
  constructor(private readonly host: RecoveryHost) {
    ipcMain.handle(NATIVE_CHANNELS.recovery, (event) => {
      this.assertSender(event);
      return this.info();
    });
    ipcMain.handle(NATIVE_CHANNELS.reportFailure, (event, value) => {
      this.assertSender(event, true);
      const report = validateFailure(value);
      if (report.kind !== 'render') throw Error('Invalid renderer failure.');
      this.show(report);
    });
    ipcMain.handle(NATIVE_CHANNELS.rendererReady, (event) => {
      this.assertSender(event, true);
      clearTimeout(this.bootTimer);
      if (this.failure && !this.fatal) {
        this.failure = undefined;
        this.recoveringDocument = false;
        this.dialogShown = false;
        this.reloading = false;
        this.host.restore();
      }
    });
    ipcMain.handle(NATIVE_CHANNELS.recoveryAction, async (event, action) => {
      this.assertSender(event);
      if (!this.failure) throw Error('No recovery is in progress.');
      if (action === 'copy') clipboard.writeText(this.info().diagnostic);
      else if (action === 'restart') this.restart();
      else if (action === 'close') app.quit();
      else if (action === 'reload' && !this.fatal) {
        const window = this.host.window();
        if (!window || window.isDestroyed()) return;
        this.recoveringDocument = false;
        this.reloading = true;
        this.armBoot();
        try {
          await window.loadURL(this.host.rendererUrl);
        } catch {
          this.show(failureReport('load'));
        }
      } else throw Error('Invalid recovery action.');
    });
  }
  get active() {
    return Boolean(this.failure) && !this.reloading;
  }
  private assertSender(event: IpcMainInvokeEvent, rendererOnly = false) {
    const window = this.host.window();
    const url = event.senderFrame?.url.split('#')[0];
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      (url !== this.host.rendererUrl.split('#')[0] &&
        (rendererOnly || url !== this.host.recoveryUrl.split('#')[0]))
    )
      throw Error('Recovery is only available to the Haus window.');
  }
  info(): RecoveryInfo {
    return {
      restartRequired: this.fatal,
      diagnostic: [
        `Haus ${app.getVersion()}`,
        `Failure: ${this.failure?.kind ?? 'unknown'}`,
        `Error: ${this.failure?.name ?? 'Error'}`,
        `Reference: ${this.failure?.reference ?? 'unavailable'}`,
        `System: ${process.platform} ${process.arch}`,
        `Electron: ${process.versions.electron}`,
      ].join('\n'),
    };
  }
  private restart() {
    app.relaunch();
    app.exit(0);
  }
  private armBoot() {
    clearTimeout(this.bootTimer);
    const generation = ++this.generation;
    this.bootTimer = setTimeout(() => {
      if (generation === this.generation) this.show(failureReport('startup'));
    }, 20000);
    this.bootTimer.unref();
  }
  attach(window: BrowserWindow) {
    this.armBoot();
    window.webContents.on('render-process-gone', (_event, details) => {
      if (window !== this.host.window() || window.isDestroyed() || details.reason === 'clean-exit')
        return;
      this.show(
        this.failure?.kind === 'unresponsive'
          ? this.failure
          : failureReport('renderer', details.reason),
      );
    });
    window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3 && window === this.host.window())
        this.show(failureReport('load', code));
    });
    window.on('unresponsive', () => {
      if (window !== this.host.window() || window.isDestroyed()) return;
      this.failure = failureReport('unresponsive');
      this.host.stopTalk();
      window.webContents.forcefullyCrashRenderer();
    });
    window.once('closed', () => {
      clearTimeout(this.bootTimer);
      ++this.generation;
    });
  }
  show(report: FailureReport) {
    const window = this.host.window();
    if (!window || window.isDestroyed()) return;
    if (this.recoveringDocument && report.kind === 'render') return;
    this.reloading = false;
    clearTimeout(this.bootTimer);
    ++this.generation;
    this.failure = this.fatal ? this.failure : report;
    this.host.stopTalk();
    this.host.suspend();
    window.setBackgroundColor('#0c0c0c');
    window.show();
    if (this.recoveringDocument) {
      if (this.dialogShown) return;
      this.dialogShown = true;
      // Do not loop if the recovery renderer itself cannot start (for example persistent GPU failure).
      void dialog
        .showMessageBox(window, {
          type: 'error',
          title: 'Haus needs to restart',
          message: 'Haus could not restore its window.',
          detail: 'Restart the app to try again. Your home configuration is kept.',
          buttons: ['Restart Haus', 'Close'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => (response === 0 ? this.restart() : app.quit()));
      return;
    }
    this.recoveringDocument = true;
    void window.loadURL(this.host.recoveryUrl).catch(() => {
      if (window === this.host.window() && !window.isDestroyed()) this.show(report);
    });
  }
  mainFailure(error: unknown) {
    if (this.fatal) return;
    this.fatal = true;
    this.failure = failureReport('main', error);
    // Keep enough location data to debug the compiled application, without
    // logging exception messages, source URLs, user paths or arbitrary frames.
    const frames =
      error instanceof Error
        ? (error.stack ?? '')
            .slice(0, 16384)
            .split('\n')
            .slice(1)
            .flatMap((line) => {
              const location = /\/(index\.[cm]?js:\d+:\d+)\)?\s*$/.exec(line);
              return location ? [location[1]] : [];
            })
            .slice(0, 8)
        : [];
    console.error('[Haus] Main process failure', { ...this.failure, frames });
    // A main-process exception is not safe to resume; expose only restart/close afterwards.
    try {
      this.host.stopApp();
    } catch {
      /* Continue to the independent recovery UI. */
    }
    this.show(this.failure);
  }
}
