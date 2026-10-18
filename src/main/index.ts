import { app, BrowserWindow, session, shell, nativeTheme, protocol } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HomeAssistantConnection } from './connection';
import { registerNativeIpc } from './ipc';
import { SecureStore } from './secure-store';
import { NATIVE_CHANNELS } from '../shared/native';
import { NativeSidebarMaterial } from './sidebar-material';
import { HausHelper } from './helper';

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
type AppTheme = 'light' | 'dark';
let currentTheme: AppTheme = 'light';
const rendererPath = join(moduleDirectory, '../renderer/index.html');
const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererPath).href)
  .href;

function applyNativeAppearance(theme: AppTheme): void {
  if (currentTheme === theme && nativeTheme.themeSource === theme) return;
  currentTheme = theme;
  nativeTheme.themeSource = theme;
  sidebarMaterial?.setTheme(theme);
  const dark = theme === 'dark';
  if (process.platform !== 'darwin') mainWindow?.setBackgroundColor('#00000000');
  if (process.platform !== 'darwin') {
    mainWindow?.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: dark ? '#F4F4F4' : '#333333',
      height: 44,
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
            thickFrame: true,
            transparent: true,
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: '#00000000',
              symbolColor: dark ? '#F4F4F4' : '#333333',
              height: 44,
            },
            backgroundMaterial: 'acrylic' as const,
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
  sidebarMaterial = new NativeSidebarMaterial(mainWindow, currentTheme);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
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
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const store = new SecureStore(app.getPath('userData'));
    const preferences: Record<string, unknown> = await store.getPreferences().catch(() => ({}));
    applyNativeAppearance(preferences.theme === 'dark' ? 'dark' : 'light');
    connection = new HomeAssistantConnection(
      store,
      (event) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(NATIVE_CHANNELS.event, event);
      },
      (url) => shell.openExternal(url),
    );
    const helper = new HausHelper(connection);
    protocol.handle('haus-media', async (request) => {
      try {
        return await helper.media(request.url, request.headers.get('Range'), request.signal);
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
      (width) => sidebarMaterial?.update(width) ?? 'none',
      helper,
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => connection?.dispose());
}
