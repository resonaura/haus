import { app, BrowserWindow, session, shell, nativeTheme, protocol } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HomeAssistantConnection } from './connection';
import { registerNativeIpc } from './ipc';
import { SecureStore } from './secure-store';
import { NATIVE_CHANNELS } from '../shared/native';
import { NativeSidebarMaterial } from './sidebar-material';
import { HausHelper } from './helper';
import { LinuxShellMaterial } from './linux-shell-material';
import { applyWindowsAcrylicFallback, windowsAcrylicMode } from './windows-acrylic';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'haus-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let connection: HomeAssistantConnection | undefined;
let sidebarMaterial: NativeSidebarMaterial | undefined;
let linuxShellMaterial: LinuxShellMaterial | undefined;
let windowsAcrylicEnabled = false;
let helper: HausHelper | undefined;
type AppTheme = 'light' | 'dark';
let currentTheme: AppTheme = 'light';
const rendererPath = join(moduleDirectory, '../renderer/index.html');
const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererPath).href)
  .href;

function applyNativeAppearance(theme: AppTheme): void {
  currentTheme = theme;
  nativeTheme.themeSource = theme;
  sidebarMaterial?.setTheme(theme);
  const dark = theme === 'dark';
  if (process.platform !== 'darwin') mainWindow?.setBackgroundColor('#00000000');
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    windowsAcrylicEnabled = applyWindowsAcrylicFallback(
      mainWindow,
      process.getSystemVersion(),
      undefined,
      dark,
    );
  }
  if (process.platform !== 'darwin') {
    mainWindow?.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: dark ? '#F4F4F4' : '#333333',
      height: 44,
    });
  }
}

function currentSidebarMaterial() {
  if (process.platform === 'darwin') return sidebarMaterial?.material ?? 'vibrancy';
  if (process.platform === 'win32') return windowsAcrylicEnabled ? 'acrylic' : 'none';
  if (process.platform === 'linux') return linuxShellMaterial?.material ?? 'none';
  return 'none';
}

function publishSidebarMaterial(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(NATIVE_CHANNELS.event, {
      type: 'appearance',
      sidebarMaterial: currentSidebarMaterial(),
    });
  }
}

function createWindow(): void {
  const dark = currentTheme === 'dark';
  mainWindow = new BrowserWindow({
    title: 'Haus',
    width: 1440,
    height: 1000,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#00000000',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          transparent: true,
          trafficLightPosition: { x: 22, y: 22 },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
        }
      : process.platform === 'win32'
        ? {
            frame: false,
            thickFrame: windowsAcrylicMode(process.getSystemVersion()) === 'electron',
            transparent: false,
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: '#00000000',
              symbolColor: dark ? '#F4F4F4' : '#333333',
              height: 44,
            },
            ...(windowsAcrylicMode(process.getSystemVersion()) === 'electron'
              ? { backgroundMaterial: 'acrylic' as const }
              : {}),
          }
        : {
            ...(process.platform === 'linux' ? { transparent: true } : {}),
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: '#00000000',
              symbolColor: dark ? '#F4F4F4' : '#333333',
              height: 44,
            },
          }),
    webPreferences: {
      preload: join(moduleDirectory, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron's Node ESM preload loader requires an unsandboxed preload.
      // The renderer still has no Node access; all native calls use the audited bridge.
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  mainWindow.webContents.on('render-process-gone', () => helper?.stopTalk());
  mainWindow.on('closed', () => helper?.stopTalk());
  sidebarMaterial = new NativeSidebarMaterial(mainWindow, currentTheme);
  if (process.platform === 'win32') applyNativeAppearance(currentTheme);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (process.platform === 'win32') {
      applyNativeAppearance(currentTheme);
      publishSidebarMaterial();
    }
  });
  if (process.platform === 'win32') {
    const reapply = () => {
      applyNativeAppearance(currentTheme);
      publishSidebarMaterial();
    };
    mainWindow.on('restore', reapply);
    mainWindow.on('unmaximize', reapply);
  }
  mainWindow.webContents.on('did-finish-load', publishSidebarMaterial);
  mainWindow.on('closed', () => {
    sidebarMaterial?.dispose();
    sidebarMaterial = undefined;
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(rendererUrl);
  else void mainWindow.loadFile(rendererPath);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void app.whenReady().then(async () => {
    app.setAppUserModelId('app.haus.desktop');
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(
        contents === mainWindow?.webContents &&
          permission === 'media' &&
          'mediaTypes' in details &&
          Array.isArray(details.mediaTypes) &&
          details.mediaTypes.length > 0 &&
          details.mediaTypes.every((type: string) => type === 'audio'),
      ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        contents === mainWindow?.webContents &&
        permission === 'media' &&
        details.mediaType === 'audio',
    );
    const store = new SecureStore(app.getPath('userData'));
    const preferences: Record<string, unknown> = await store.getPreferences().catch(() => ({}));
    applyNativeAppearance(preferences.theme === 'dark' ? 'dark' : 'light');
    if (process.platform === 'linux') {
      linuxShellMaterial = new LinuxShellMaterial(publishSidebarMaterial);
      await linuxShellMaterial.start();
    }
    connection = new HomeAssistantConnection(
      store,
      (event) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(NATIVE_CHANNELS.event, event);
      },
      (url) => shell.openExternal(url),
    );
    const recordingHelper = new HausHelper(connection);
    helper = recordingHelper;
    app.once('before-quit', () => recordingHelper.clear());
    protocol.handle('haus-media', async (request) => {
      try {
        return await recordingHelper.media(
          request.url,
          request.headers.get('Range'),
          request.signal,
        );
      } catch {
        return new Response('Recording unavailable', { status: 503 });
      }
    });
    registerNativeIpc(
      () => mainWindow,
      connection,
      store,
      rendererUrl,
      applyNativeAppearance,
      (width) => {
        if (process.platform === 'darwin') return sidebarMaterial?.update(width) ?? 'vibrancy';
        return currentSidebarMaterial();
      },
      recordingHelper,
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    connection?.dispose();
    linuxShellMaterial?.dispose();
  });
}
