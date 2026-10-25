import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { NATIVE_CHANNELS } from '../shared/native';
import { failureReport } from '../shared/recovery';
const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  clipboard: { writeText: vi.fn() },
  app: { getVersion: () => '1.0.0', relaunch: vi.fn(), exit: vi.fn(), quit: vi.fn() },
  dialog: { showMessageBox: vi.fn(() => new Promise(() => {})) },
}));
vi.mock('electron', () => ({
  ...native,
  ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => native.handlers.set(key, fn) },
}));
import { AppRecovery } from './app-recovery';
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  native.handlers.clear();
});
function fixture() {
  vi.useFakeTimers();
  const frame = { url: 'file:///haus/index.html' };
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    forcefullyCrashRenderer: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
    loadURL: vi.fn(async () => {}),
    setBackgroundColor: vi.fn(),
    show: vi.fn(),
  });
  const host = {
    window: () => window as unknown as BrowserWindow,
    rendererUrl: frame.url,
    recoveryUrl: 'file:///haus/recovery.html',
    suspend: vi.fn(),
    restore: vi.fn(),
    stopTalk: vi.fn(),
    stopApp: vi.fn(),
  };
  const recovery = new AppRecovery(host);
  recovery.attach(host.window());
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const invoke = (channel: string, ...args: unknown[]) =>
    native.handlers.get(channel)!(event, ...args);
  return { window, host, recovery, frame, event, invoke };
}
it('replaces a crashed renderer with an opaque recovery document, preserves window geometry and restores only after React mounts', async () => {
  const f = fixture();
  f.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(f.recovery.active).toBe(true);
  expect(f.host.suspend).toHaveBeenCalledTimes(1);
  expect(f.host.stopTalk).toHaveBeenCalledTimes(1);
  expect(f.window.setBackgroundColor).toHaveBeenCalledWith('#0c0c0c');
  expect(f.window.loadURL).toHaveBeenLastCalledWith(f.host.recoveryUrl);
  f.frame.url = f.host.recoveryUrl;
  await f.invoke(NATIVE_CHANNELS.recoveryAction, 'reload');
  expect(f.recovery.active).toBe(false); // Native session/preferences must be readable during reboot.
  expect(f.window.loadURL).toHaveBeenLastCalledWith(f.host.rendererUrl);
  expect(f.host.restore).not.toHaveBeenCalled();
  f.frame.url = f.host.rendererUrl;
  f.invoke(NATIVE_CHANNELS.rendererReady);
  expect(f.recovery.active).toBe(false);
  expect(f.host.restore).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(21000);
  expect(f.recovery.active).toBe(false);
});
it('coalesces duplicate React reports and limits a failing recovery document to a single native restart dialog', () => {
  const f = fixture();
  f.invoke(NATIVE_CHANNELS.reportFailure, failureReport('render', new TypeError('private')));
  f.invoke(NATIVE_CHANNELS.reportFailure, failureReport('render', new TypeError('private')));
  expect(f.window.loadURL).toHaveBeenCalledTimes(1);
  expect(native.dialog.showMessageBox).not.toHaveBeenCalled();
  f.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  f.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(native.dialog.showMessageBox).toHaveBeenCalledTimes(1);
});
it('uses only restart/close after a main exception and copies only allowlisted diagnostics', async () => {
  const f = fixture();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = new TypeError('rtsp://secret@192.0.2.1/private?token=secret');
  error.stack +=
    '\n    at stop (file:///private/home/out/main/index.js:123:4)\n    at secret (rtsp://secret@192.0.2.1/private:99:1)';
  f.recovery.mainFailure(error);
  const logged = JSON.stringify(log.mock.calls);
  expect(logged).toContain('index.js:123:4');
  expect(logged).not.toMatch(/secret|192\.0\.2\.1|rtsp|private/);
  log.mockRestore();
  expect(f.host.stopApp).toHaveBeenCalledTimes(1);
  expect(f.recovery.info().restartRequired).toBe(true);
  f.frame.url = f.host.recoveryUrl;
  await expect(f.invoke(NATIVE_CHANNELS.recoveryAction, 'reload')).rejects.toThrow('Invalid');
  await f.invoke(NATIVE_CHANNELS.recoveryAction, 'copy');
  const copied = native.clipboard.writeText.mock.calls[0][0];
  expect(copied).toContain('Failure: main');
  expect(copied).not.toMatch(/secret|192\.0\.2\.1|rtsp|private/);
  await f.invoke(NATIVE_CHANNELS.recoveryAction, 'restart');
  expect(native.app.relaunch).toHaveBeenCalledTimes(1);
  expect(native.app.exit).toHaveBeenCalledWith(0);
});
it('rejects other frames/documents, arbitrary commands and renderer attempts to claim a main failure', async () => {
  const f = fixture();
  expect(() => f.invoke(NATIVE_CHANNELS.reportFailure, { kind: 'main' })).toThrow(
    'Invalid renderer',
  );
  f.frame.url = 'https://example.test/';
  expect(() => f.invoke(NATIVE_CHANNELS.recovery)).toThrow('only available');
  f.frame.url = f.host.rendererUrl;
  expect(() =>
    native.handlers.get(NATIVE_CHANNELS.recovery)!({
      ...f.event,
      senderFrame: { url: f.frame.url },
    }),
  ).toThrow('only available');
  f.invoke(NATIVE_CHANNELS.reportFailure, {
    kind: 'render',
    name: 'rtsp://private',
    reference: 'private-token',
  });
  expect(f.recovery.info().diagnostic).not.toMatch(/rtsp|private-token/);
  await expect(f.invoke(NATIVE_CHANNELS.recoveryAction, 'execute')).rejects.toThrow('Invalid');
});
it('recovers a missing bootstrap and terminates an unresponsive renderer without treating navigation cancellation as an error', () => {
  const f = fixture();
  f.window.webContents.emit('did-fail-load', {}, -3, 'cancelled', '', true);
  expect(f.recovery.active).toBe(false);
  vi.advanceTimersByTime(20000);
  expect(f.recovery.info().diagnostic).toContain('Failure: startup');
  const second = fixture();
  second.window.emit('unresponsive');
  expect(second.window.webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1);
  second.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(second.recovery.info().diagnostic).toContain('Failure: unresponsive');
});
