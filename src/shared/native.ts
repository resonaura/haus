/** The only native capability surface exposed to the renderer. OAuth credentials stay in main. */
export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
  host: string;
  port: number;
  version?: string;
}

export interface NativeSession {
  url: string;
  name: string;
}

export type NativeEvent =
  | { type: 'window'; state: WindowChrome }
  | { type: 'appearance'; sidebarMaterial: SidebarMaterial }
  | {
      type: 'connection';
      status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
      error?: string;
    }
  | {
      type: 'ha-event';
      event: {
        event_type: string;
        data: Record<string, unknown>;
        context?: { id?: string; parent_id?: string | null; user_id?: string | null };
      };
    };

export interface ContextMenuItem {
  id: string;
  label: string;
  type?: 'normal' | 'separator' | 'submenu';
  enabled?: boolean;
  items?: ContextMenuItem[];
}

export type SidebarMaterial =
  | 'liquid-glass'
  | 'vibrancy'
  | 'acrylic'
  | 'blur-my-shell'
  | 'kwin-blur'
  | 'hyprland-blur'
  | 'none';

export type HapticPattern = 'generic' | 'alignment' | 'levelChange';

export interface HausNative {
  serverSshProfile(serverId: string): Promise<import('./terminal').ServerSshProfile | null>;
  serverTerminalOpen(request: import('./terminal').ServerTerminalOpen): Promise<void>;
  serverTerminalWrite(sessionId: string, data: string): Promise<void>;
  serverTerminalResize(sessionId: string, cols: number, rows: number): Promise<void>;
  serverTerminalAck(sessionId: string, bytes: number): void;
  serverTerminalClose(sessionId: string): Promise<void>;
  onServerTerminal(callback: (event: import('./terminal').ServerTerminalEvent) => void): () => void;
  logCamera?(event: import('./camera-diagnostics').CameraDiagnostic): void;
  hapticFeedback(pattern?: HapticPattern): void;
  reportFailure(report: import('./recovery').FailureReport): Promise<void>;
  rendererReady(): Promise<void>;
  getRecovery(): Promise<import('./recovery').RecoveryInfo>;
  recoveryAction(action: 'reload' | 'restart' | 'copy' | 'close'): Promise<void>;
  getWindowChrome(): Promise<WindowChrome>;
  windowAction(action: 'close' | 'minimize' | 'maximize'): Promise<void>;
  startTalk(cameraId: string): Promise<void>;
  writeTalk(data: Uint8Array): Promise<void>;
  stopTalk(): Promise<void>;
  saveRecording(id: string): Promise<boolean>;
  saveRecoveryKit(): Promise<boolean>;
  helper<T = unknown>(request: {
    method: 'GET' | 'POST' | 'PATCH';
    path: string;
    data?: Record<string, unknown>;
  }): Promise<T>;
  updateSidebarMaterial(width: number): Promise<SidebarMaterial>;
  openAddon(slug: string): Promise<void>;
  openIntegrationLogin(flowId: string, options?: boolean): Promise<void>;
  management<T = unknown>(request: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    data?: Record<string, unknown>;
  }): Promise<T>;
  brandIcon(kind: 'integration' | 'addon', id: string, dark?: boolean): Promise<string | null>;
  discover(): Promise<DiscoveredServer[]>;
  getSession(): Promise<NativeSession | null>;
  connect(url: string): Promise<NativeSession>;
  disconnect(): Promise<void>;
  request<T = unknown>(message: Record<string, unknown>): Promise<T>;
  subscribe<T = unknown>(
    message: Record<string, unknown>,
    callback: (event: T) => void,
  ): Promise<() => void>;
  cameraSnapshot(entityId: string): Promise<string>;
  cameraLastSnapshot(entityId: string): Promise<{ image: string; receivedAt: number } | null>;
  getSceneConfig(entityId: string, sceneId: string): Promise<Record<string, unknown> | null>;
  onEvent(callback: (event: NativeEvent) => void): () => void;
  getPreferences(): Promise<Record<string, unknown>>;
  setPreferences(patch: Record<string, unknown>): Promise<void>;
  openExternal(url: string): Promise<void>;
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
}

declare global {
  interface Window {
    hausNative?: HausNative;
  }
}

export const NATIVE_CHANNELS = {
  serverSshProfile: 'haus:server-ssh-profile',
  serverTerminalOpen: 'haus:server-terminal-open',
  serverTerminalWrite: 'haus:server-terminal-write',
  serverTerminalResize: 'haus:server-terminal-resize',
  serverTerminalAck: 'haus:server-terminal-ack',
  serverTerminalClose: 'haus:server-terminal-close',
  serverTerminalEvent: 'haus:server-terminal-event',
  cameraDiagnostic: 'haus:camera-diagnostic',
  hapticFeedback: 'haus:haptic-feedback',
  reportFailure: 'haus:failure',
  rendererReady: 'haus:renderer-ready',
  recovery: 'haus:recovery',
  recoveryAction: 'haus:recovery-action',
  windowChrome: 'haus:window-chrome',
  windowAction: 'haus:window-action',
  startTalk: 'haus:talk-start',
  writeTalk: 'haus:talk-audio',
  stopTalk: 'haus:talk-stop',
  saveRecording: 'haus:save-recording',
  saveRecoveryKit: 'haus:save-recovery-kit',
  helper: 'haus:helper',
  sidebarMaterial: 'haus:sidebar-material',
  addon: 'haus:addon',
  integrationLogin: 'haus:integration-login',
  management: 'haus:management',
  brandIcon: 'haus:brand-icon',
  discover: 'haus:discover',
  session: 'haus:session',
  connect: 'haus:connect',
  disconnect: 'haus:disconnect',
  request: 'haus:request',
  event: 'haus:event',
  preferences: 'haus:preferences',
  setPreferences: 'haus:set-preferences',
  openExternal: 'haus:open-external',
  subscribe: 'haus:subscribe',
  unsubscribe: 'haus:unsubscribe',
  cameraSnapshot: 'haus:camera-snapshot',
  cameraLastSnapshot: 'haus:camera-last-snapshot',
  sceneConfig: 'haus:scene-config',
  contextMenu: 'haus:context-menu',
} as const;

export interface WindowChrome {
  platform: 'darwin' | 'win32' | 'linux' | 'other';
  controls: 'native-left' | 'native-right' | 'traffic-left' | 'custom-right';
  maximized: boolean;
  fullscreen: boolean;
}
