import { contextBridge, ipcRenderer } from 'electron';
import { NATIVE_CHANNELS, type HausNative, type NativeEvent } from '../shared/native';

const native: HausNative = {
  hapticFeedback: (pattern = 'alignment') =>
    ipcRenderer.send(NATIVE_CHANNELS.hapticFeedback, pattern),
  reportFailure: (report) => ipcRenderer.invoke(NATIVE_CHANNELS.reportFailure, report),
  rendererReady: () => ipcRenderer.invoke(NATIVE_CHANNELS.rendererReady),
  getRecovery: () => ipcRenderer.invoke(NATIVE_CHANNELS.recovery),
  recoveryAction: (action) => ipcRenderer.invoke(NATIVE_CHANNELS.recoveryAction, action),
  getWindowChrome: () => ipcRenderer.invoke(NATIVE_CHANNELS.windowChrome),
  windowAction: (action) => ipcRenderer.invoke(NATIVE_CHANNELS.windowAction, action),
  startTalk: (id) => ipcRenderer.invoke(NATIVE_CHANNELS.startTalk, id),
  writeTalk: (data) => ipcRenderer.invoke(NATIVE_CHANNELS.writeTalk, data),
  stopTalk: () => ipcRenderer.invoke(NATIVE_CHANNELS.stopTalk),
  saveRecording: (id) => ipcRenderer.invoke(NATIVE_CHANNELS.saveRecording, id),
  saveRecoveryKit: () => ipcRenderer.invoke(NATIVE_CHANNELS.saveRecoveryKit),
  helper: (request) => ipcRenderer.invoke(NATIVE_CHANNELS.helper, request),
  updateSidebarMaterial: (width) => ipcRenderer.invoke(NATIVE_CHANNELS.sidebarMaterial, width),
  openAddon: (slug) => ipcRenderer.invoke(NATIVE_CHANNELS.addon, slug),
  openIntegrationLogin: (flowId, options) =>
    ipcRenderer.invoke(NATIVE_CHANNELS.integrationLogin, flowId, options),
  management: (request) => ipcRenderer.invoke(NATIVE_CHANNELS.management, request),
  brandIcon: (kind, id, dark) => ipcRenderer.invoke(NATIVE_CHANNELS.brandIcon, kind, id, dark),
  discover: () => ipcRenderer.invoke(NATIVE_CHANNELS.discover),
  getSession: () => ipcRenderer.invoke(NATIVE_CHANNELS.session),
  connect: (url) => ipcRenderer.invoke(NATIVE_CHANNELS.connect, url),
  disconnect: () => ipcRenderer.invoke(NATIVE_CHANNELS.disconnect),
  request: (message) => ipcRenderer.invoke(NATIVE_CHANNELS.request, message),
  cameraLastSnapshot: (entityId) =>
    ipcRenderer.invoke(NATIVE_CHANNELS.cameraLastSnapshot, entityId),
  cameraSnapshot: (entityId) => ipcRenderer.invoke(NATIVE_CHANNELS.cameraSnapshot, entityId),
  getSceneConfig: (entityId, sceneId) =>
    ipcRenderer.invoke(NATIVE_CHANNELS.sceneConfig, entityId, sceneId),
  subscribe: async <T>(message: Record<string, unknown>, callback: (event: T) => void) => {
    let subscription: string | undefined;
    const buffered: Array<{ subscriptionId: unknown; payload: unknown }> = [];
    const listener = (_event: Electron.IpcRendererEvent, payload: NativeEvent): void => {
      if (payload.type !== 'ha-event' || payload.event.event_type !== 'haus_subscription') return;
      const data = payload.event.data;
      if (!subscription)
        buffered.push({ subscriptionId: data.subscriptionId, payload: data.payload });
      else if (data.subscriptionId === subscription) callback(data.payload as T);
    };
    ipcRenderer.on(NATIVE_CHANNELS.event, listener);
    try {
      subscription = await ipcRenderer.invoke(NATIVE_CHANNELS.subscribe, message);
      for (const item of buffered)
        if (item.subscriptionId === subscription) callback(item.payload as T);
    } catch (error) {
      ipcRenderer.removeListener(NATIVE_CHANNELS.event, listener);
      throw error;
    }
    return () => {
      ipcRenderer.removeListener(NATIVE_CHANNELS.event, listener);
      void ipcRenderer.invoke(NATIVE_CHANNELS.unsubscribe, subscription).catch(() => undefined);
    };
  },
  getPreferences: () => ipcRenderer.invoke(NATIVE_CHANNELS.preferences),
  setPreferences: (patch) => ipcRenderer.invoke(NATIVE_CHANNELS.setPreferences, patch),
  openExternal: (url) => ipcRenderer.invoke(NATIVE_CHANNELS.openExternal, url),
  showContextMenu: (items) => ipcRenderer.invoke(NATIVE_CHANNELS.contextMenu, items),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: NativeEvent): void =>
      callback(payload);
    ipcRenderer.on(NATIVE_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(NATIVE_CHANNELS.event, listener);
  },
};

contextBridge.exposeInMainWorld('hausNative', Object.freeze(native));
