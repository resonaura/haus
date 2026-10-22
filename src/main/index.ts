import { app, BrowserWindow, session, shell, nativeTheme, protocol } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HomeAssistantConnection } from './connection';
import { registerNativeIpc } from './ipc';
import { SecureStore } from './secure-store';
import { NATIVE_CHANNELS, type WindowChrome } from '../shared/native';
import { NativeSidebarMaterial } from './sidebar-material';
import { HausHelper } from './helper';
import { LinuxShellMaterial } from './linux-shell-material';
import {
  applyWindowsAcrylicFallback,
  applyWindowsRoundedCorners,
  windowsAcrylicMode,
} from './windows-acrylic';
import { readKiwiControls, watchKiwiControls } from './linux-window-controls';
import { AppRecovery } from './app-recovery';
import { failureReport } from '../shared/recovery';
import { suspendWindowsAcrylic } from './windows-acrylic';

// Keep Electron's secure-storage identity stable across the Haus rebrand. The existing
// encrypted session was created under the package name `haus`; changing this before the
// first safeStorage call makes macOS look up a different Keychain item.
app.setName('haus');

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
const developmentIcon = join(moduleDirectory, '../../build/icon.png');
let mainWindow: BrowserWindow | null = null;
let openHausWindow: (() => void) | undefined;
let connection: HomeAssistantConnection | undefined;
let sidebarMaterial: NativeSidebarMaterial | undefined;
let linuxShellMaterial: LinuxShellMaterial | undefined;
let windowsAcrylicEnabled = false;
let helper: HausHelper | undefined;
let kiwi = false;
let stopKiwi: (() => void) | undefined;
let quitting = false;
function windowChrome(): WindowChrome {
  return {
    platform: ['darwin', 'win32', 'linux'].includes(process.platform)
      ? (process.platform as WindowChrome['platform'])
      : 'other',
    controls:
      process.platform === 'darwin'
        ? 'native-left'
        : process.platform === 'win32'
          ? 'native-right'
          : kiwi
            ? 'traffic-left'
            : 'custom-right',
    maximized: mainWindow?.isMaximized() ?? false,
    fullscreen: mainWindow?.isFullScreen() ?? false,
  };
}
function publishWindowChrome() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(NATIVE_CHANNELS.event, { type: 'window', state: windowChrome() });
}
type AppTheme = 'light' | 'dark';
let currentTheme: AppTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
let appearanceSource: 'system' | AppTheme = 'system';
const rendererPath = join(moduleDirectory, '../renderer/index.html');
const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererPath).href)
  .href;
const recovery = new AppRecovery({
  window: () => (quitting ? null : mainWindow),
  rendererUrl,
  recoveryUrl: new URL('recovery.html', rendererUrl).href,
  stopTalk: () => helper?.stopTalk(),
  stopApp: () => {
    helper?.clear();
    connection?.dispose();
  },
  suspend: () => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    sidebarMaterial?.update(0);
    if (process.platform === 'darwin') window.setVibrancy(null);
    if (process.platform === 'win32') suspendWindowsAcrylic(window);
    window.setBackgroundColor('#0c0c0c');
  },
  restore: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    sidebarMaterial?.dispose();
    mainWindow.setBackgroundColor('#00000000');
    if (process.platform === 'darwin') mainWindow.setVibrancy('sidebar');
    sidebarMaterial = new NativeSidebarMaterial(mainWindow, currentTheme);
    applyNativeAppearance(appearanceSource);
    publishSidebarMaterial();
  },
});

function applyNativeAppearance(source: 'system' | AppTheme): void {
  appearanceSource = source;
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  currentTheme = theme;
  if (recovery.active) return;
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
    applyWindowsRoundedCorners(mainWindow, process.getSystemVersion());
  }
  if (process.platform === 'win32') {
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

function createWindow(onFirstShown?: () => void): void {
  const dark = currentTheme === 'dark';
  const window = new BrowserWindow({
    title: 'Haus',
    ...(process.env.ELECTRON_RENDERER_URL && process.platform !== 'darwin'
      ? { icon: developmentIcon }
      : {}),
    width: 1440,
    height: 1000,
    minWidth: 900,
    minHeight: 640,
    show: false,
    roundedCorners: true,
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
            frame: false,
            ...(process.platform === 'linux' ? { transparent: true } : {}),
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: false,
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
  mainWindow = window;
  window.webContents.on('render-process-gone', () => helper?.stopTalk());
  window.on('closed', () => helper?.stopTalk());
  const windowSidebarMaterial = new NativeSidebarMaterial(window, currentTheme);
  sidebarMaterial = windowSidebarMaterial;
  recovery.attach(window);
  if (process.platform === 'win32') applyNativeAppearance(appearanceSource);
  window.once('ready-to-show', () => {
    if (window.isDestroyed() || mainWindow !== window) return;
    window.show();
    onFirstShown?.();
    if (process.platform === 'win32') {
      applyNativeAppearance(appearanceSource);
      publishSidebarMaterial();
    }
  });
  if (process.platform === 'win32') {
    const reapply = () => {
      applyNativeAppearance(appearanceSource);
      publishSidebarMaterial();
    };
    window.on('restore', reapply);
    window.on('unmaximize', reapply);
  }
  window.webContents.on('did-finish-load', publishSidebarMaterial);
  window.webContents.on('did-finish-load', publishWindowChrome);
  window.on('maximize', publishWindowChrome);
  window.on('unmaximize', publishWindowChrome);
  window.on('enter-full-screen', publishWindowChrome);
  window.on('leave-full-screen', publishWindowChrome);
  window.on('closed', () => {
    windowSidebarMaterial.dispose();
    if (sidebarMaterial === windowSidebarMaterial) sidebarMaterial = undefined;
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  void window.loadURL(rendererUrl).catch(() => recovery.show(failureReport('load')));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      openHausWindow?.();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void app.whenReady().then(async () => {
    const existingUserDataPath = app.getPath('userData');
    let releaseStartup!: () => void;
    const startupReady = new Promise<void>((resolve) => {
      releaseStartup = resolve;
    });
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
    applyNativeAppearance(
      preferences.theme === 'dark' || preferences.theme === 'light' ? preferences.theme : 'system',
    );
    nativeTheme.on('updated', () => applyNativeAppearance(appearanceSource));
    if (process.platform === 'linux') {
      kiwi = await readKiwiControls();
      stopKiwi = watchKiwiControls((value) => {
        if (kiwi !== value) {
          kiwi = value;
          publishWindowChrome();
        }
      });
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
      startupReady,
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
      windowChrome,
      () => recovery.active,
    );
    // Restore the legacy storage path only after a window frame is visible. Session
    // reads await this gate so a Keychain prompt cannot hold a hidden window hostage.
    // Keep app.getName() as `haus` for safeStorage compatibility with existing sessions;
    // the packaged productName and BrowserWindow title provide the visible Haus branding.
    let startupReleased = false;
    const releaseStartupAfterVisible = () => {
      if (startupReleased) return;
      startupReleased = true;
      setTimeout(() => {
        app.setPath('userData', existingUserDataPath);
        releaseStartup();
      }, 80);
    };
    openHausWindow = () => createWindow(releaseStartupAfterVisible);
    openHausWindow();
    process.on('uncaughtException', (error) => recovery.mainFailure(error));
    app.on('child-process-gone', (_event, details) => {
      if (details.type === 'GPU' && details.reason !== 'clean-exit')
        recovery.show(failureReport('gpu', details.reason));
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openHausWindow?.();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    quitting = true;
    connection?.dispose();
    linuxShellMaterial?.dispose();
    stopKiwi?.();
  });
}
