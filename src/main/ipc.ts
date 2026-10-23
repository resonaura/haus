import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
} from 'electron';
import { createWriteStream } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NATIVE_CHANNELS, type SidebarMaterial, type WindowChrome } from '../shared/native';
import type { HomeAssistantConnection } from './connection';
import { discoverServers } from './discovery';
import type { SecureStore } from './secure-store';
import type { HausHelper } from './helper';
import { validateExternalUrl, validatePreferences, validateRequest } from './validation';
import { NativeHaptics } from './haptics';

const addonWindows = new Map<string, BrowserWindow>();

export function registerNativeIpc(
  window: () => BrowserWindow | null,
  connection: HomeAssistantConnection,
  store: SecureStore,
  rendererUrl: string,
  setAppearance: (theme: 'system' | 'light' | 'dark') => void,
  updateSidebarMaterial: (width: unknown) => SidebarMaterial,
  helper: HausHelper,
  windowChrome: () => WindowChrome,
  recovering: () => boolean = () => false,
): void {
  const assertSender = (event: IpcMainInvokeEvent | IpcMainEvent): void => {
    const owner = window();
    if (
      recovering() ||
      !owner ||
      owner.isDestroyed() ||
      event.sender !== owner.webContents ||
      event.senderFrame !== owner.webContents.mainFrame ||
      event.senderFrame?.url.split('#')[0] !== rendererUrl.split('#')[0]
    )
      throw new Error('Native commands are only available to the Haus app.');
  };
  const handle = (channel: string, callback: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertSender(event);
      return callback(...args);
    });
  };
  const haptics = new NativeHaptics();
  ipcMain.on(NATIVE_CHANNELS.hapticFeedback, (event, pattern: unknown) => {
    try {
      assertSender(event);
      const owner = window();
      if (!owner?.isFocused() || !owner.isVisible() || owner.isMinimized()) return;
      haptics.perform(pattern);
    } catch {
      // Ignore stale/untrusted or recovering renderers without an IPC reply.
    }
  });
  handle(NATIVE_CHANNELS.startTalk, (id) => helper.startTalk(id));
  handle(NATIVE_CHANNELS.windowChrome, windowChrome);
  handle(NATIVE_CHANNELS.windowAction, (action) => {
    const owner = window();
    if (!owner || owner.isDestroyed()) return;
    if (action === 'close') owner.close();
    else if (action === 'minimize') owner.minimize();
    else if (action === 'maximize') {
      if (owner.isMaximized()) owner.unmaximize();
      else owner.maximize();
    } else throw new Error('Invalid window command.');
  });
  handle(NATIVE_CHANNELS.writeTalk, (data) => helper.writeTalk(data));
  handle(NATIVE_CHANNELS.stopTalk, () => helper.stopTalk());
  handle(NATIVE_CHANNELS.discover, () => discoverServers());
  handle(NATIVE_CHANNELS.helper, (request) => helper.request(request));
  handle(NATIVE_CHANNELS.saveRecoveryKit, async () => {
    const owner = window();
    if (!owner) return false;
    const version = helper.contextVersion();
    const result = await dialog.showSaveDialog(owner, {
      title: 'Save recovery kit',
      defaultPath: join(app.getPath('downloads'), 'haus-recovery.json'),
      filters: [{ name: 'Recovery kit', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    if (helper.contextVersion() !== version)
      throw new Error('The connected home changed. Choose the export again.');
    const kit = await helper.recoveryKit(),
      temporary = `${result.filePath}.${randomUUID()}.download`;
    try {
      await writeFile(temporary, JSON.stringify(kit, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(temporary, result.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return true;
  });
  handle(NATIVE_CHANNELS.saveRecording, async (id) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
      throw new Error('Invalid recording.');
    const owner = window();
    if (!owner) return false;
    const result = await dialog.showSaveDialog(owner, {
      title: 'Save recording',
      defaultPath: join(app.getPath('downloads'), `Haus-${id}.mp4`),
      filters: [{ name: 'Video', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const response = await helper.media(`haus-media://recordings/${id}/video`, null);
    if (!response.ok || !response.body || response.headers.get('content-type') !== 'video/mp4')
      throw new Error('This recording could not be downloaded.');
    const temporary = `${result.filePath}.${randomUUID()}.download`;
    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      await rename(temporary, result.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return true;
  });
  handle(NATIVE_CHANNELS.sidebarMaterial, updateSidebarMaterial);
  handle(NATIVE_CHANNELS.session, () => connection.getSession());
  handle(NATIVE_CHANNELS.connect, (url) => {
    helper.clear();
    return connection.connect(url);
  });
  handle(NATIVE_CHANNELS.disconnect, () => {
    helper.clear();
    for (const view of addonWindows.values()) if (!view.isDestroyed()) view.close();
    return connection.disconnect();
  });
  handle(NATIVE_CHANNELS.request, (message) => connection.request(validateRequest(message)));
  handle(NATIVE_CHANNELS.management, (request) => connection.management(request));
  handle(NATIVE_CHANNELS.integrationLogin, async (flowId, options) => {
    if (typeof flowId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(flowId))
      throw new Error('Invalid integration flow.');
    const step = await connection.management({
      method: 'GET',
      path: `config/config_entries/${options === true ? 'options/' : ''}flow/${flowId}`,
    });
    if (
      !step ||
      typeof step !== 'object' ||
      !('type' in step) ||
      step.type !== 'external' ||
      !('url' in step) ||
      typeof step.url !== 'string'
    )
      throw new Error('This flow is not waiting for browser sign-in.');
    const url = new URL(step.url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('The provider returned an unsupported sign-in URL.');
    await shell.openExternal(url.href);
  });
  handle(NATIVE_CHANNELS.brandIcon, (kind, id, dark) =>
    connection.brandIcon(kind, id, dark === true),
  );
  handle(NATIVE_CHANNELS.addon, async (slug) => {
    if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug))
      throw new Error('Invalid add-on.');
    const existing = addonWindows.get(slug);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    const surface = await connection.addonSurface(slug);
    const origin = new URL(surface.url).origin;
    const isolated = session.fromPartition(`haus-addon-${slug}-${Date.now()}`);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const setCookie = async (value: string) =>
      isolated.cookies.set({
        url: origin,
        name: 'ingress_session',
        value,
        path: '/api/hassio_ingress/',
        httpOnly: true,
        secure: origin.startsWith('https:'),
        sameSite: 'strict',
      });
    if (surface.cookie) await setCookie(surface.cookie);
    const view = new BrowserWindow({
      title: `${surface.title} — Haus`,
      width: 1200,
      height: 860,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: '#080808',
      parent: window() ?? undefined,
      webPreferences: {
        session: isolated,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    addonWindows.set(slug, view);
    view.webContents.setWindowOpenHandler(({ url }) => {
      try {
        void shell.openExternal(validateExternalUrl(url, connection.serverUrl)).catch(() => {});
      } catch {
        /* Keep unsupported links in the isolated surface. */
      }
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    view.webContents.on('will-attach-webview', (event) => event.preventDefault());
    const renew = surface.cookie
      ? setInterval(() => {
          void connection
            .addonSurface(slug)
            .then((next) => (next.cookie ? setCookie(next.cookie) : undefined))
            .catch(() => {});
        }, 240_000)
      : undefined;
    view.on('closed', () => {
      clearInterval(renew);
      addonWindows.delete(slug);
      void isolated.clearStorageData();
    });
    await view.loadURL(surface.url);
  });
  handle(NATIVE_CHANNELS.subscribe, (message) => connection.subscribe(validateRequest(message)));
  handle(NATIVE_CHANNELS.unsubscribe, (subscriptionId) => {
    if (typeof subscriptionId !== 'string' || !/^[a-f0-9-]{36}$/.test(subscriptionId))
      throw new Error('Invalid subscription.');
    return connection.unsubscribe(subscriptionId);
  });
  handle(NATIVE_CHANNELS.cameraLastSnapshot, (entityId) => connection.cameraLastSnapshot(entityId));
  handle(NATIVE_CHANNELS.cameraSnapshot, (entityId) => connection.cameraSnapshot(entityId));
  handle(NATIVE_CHANNELS.sceneConfig, (entityId, sceneId) =>
    connection.getSceneConfig(entityId, sceneId),
  );
  handle(NATIVE_CHANNELS.preferences, () => store.getPreferences());
  handle(NATIVE_CHANNELS.setPreferences, async (patch) => {
    const preferences = validatePreferences(patch);
    await store.setPreferences(preferences);
    if (
      preferences.theme === 'light' ||
      preferences.theme === 'dark' ||
      preferences.theme === 'system'
    )
      setAppearance(preferences.theme);
  });
  handle(NATIVE_CHANNELS.openExternal, (url) =>
    shell.openExternal(validateExternalUrl(url, connection.serverUrl)),
  );
  handle(NATIVE_CHANNELS.contextMenu, (items) => {
    return new Promise((resolve) => {
      const owner = window();
      if (!owner || owner.isDestroyed()) return resolve(null);
      let selectedId: string | null = null;
      const list = Array.isArray(items) ? items : [];
      const buildTemplate = (entries: any[]): Electron.MenuItemConstructorOptions[] =>
        entries.map((item) => {
          if (item?.type === 'separator') return { type: 'separator' };
          if (item?.type === 'submenu')
            return {
              label: String(item?.label ?? ''),
              enabled: item?.enabled !== false,
              submenu: buildTemplate(Array.isArray(item?.items) ? item.items : []),
            };
          return {
            label: String(item?.label ?? ''),
            enabled: item?.enabled !== false,
            click: () => {
              selectedId = String(item?.id ?? '');
            },
          };
        });
      const template = buildTemplate(list);
      const menu = Menu.buildFromTemplate(template);
      menu.once('menu-will-close', () => {
        setTimeout(() => resolve(selectedId), 30);
      });
      menu.popup({ window: owner });
    });
  });
}
