/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { NATIVE_CHANNELS, type HausNative, type NativeEvent } from '../shared/native';
import { unpackIpcResult } from '../shared/ipc-envelope';

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).then((result) => unpackIpcResult<T>(result));

const nativeEventListeners = new Set<(payload: NativeEvent) => void>();

const dispatchNativeEvent = (_event: Electron.IpcRendererEvent, payload: NativeEvent): void => {
  for (const listener of Array.from(nativeEventListeners)) listener(payload);
};

function addNativeEventListener(listener: (payload: NativeEvent) => void): () => void {
  if (nativeEventListeners.size === 0) ipcRenderer.on(NATIVE_CHANNELS.event, dispatchNativeEvent);
  nativeEventListeners.add(listener);
  return () => {
    if (!nativeEventListeners.delete(listener)) return;
    if (nativeEventListeners.size === 0) {
      ipcRenderer.removeListener(NATIVE_CHANNELS.event, dispatchNativeEvent);
    }
  };
}

const native: HausNative = {
  getCachedHome: () => invoke(NATIVE_CHANNELS.cachedHome),
  serverSshProfile: (id) => invoke(NATIVE_CHANNELS.serverSshProfile, id),
  serverSshServers: () => invoke(NATIVE_CHANNELS.serverSshServers),
  serverSshRemove: (id) => invoke(NATIVE_CHANNELS.serverSshRemove, id),
  serverTerminalOpen: (request) => invoke(NATIVE_CHANNELS.serverTerminalOpen, request),
  serverTerminalWrite: (id, data) => invoke(NATIVE_CHANNELS.serverTerminalWrite, id, data),
  serverTerminalResize: (id, cols, rows) =>
    invoke(NATIVE_CHANNELS.serverTerminalResize, id, cols, rows),
  serverTerminalAck: (id, bytes) => ipcRenderer.send(NATIVE_CHANNELS.serverTerminalAck, id, bytes),
  serverTerminalClose: (id) => invoke(NATIVE_CHANNELS.serverTerminalClose, id),
  onServerTerminal: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: import('../shared/terminal').ServerTerminalEvent,
    ) => callback(payload);
    ipcRenderer.on(NATIVE_CHANNELS.serverTerminalEvent, listener);
    return () => ipcRenderer.removeListener(NATIVE_CHANNELS.serverTerminalEvent, listener);
  },
  logCamera: (event) => ipcRenderer.send(NATIVE_CHANNELS.cameraDiagnostic, event),
  logHelperDiagnostic: (event) => ipcRenderer.send(NATIVE_CHANNELS.helperDiagnostic, event),
  hapticFeedback: (pattern = 'alignment') =>
    ipcRenderer.send(NATIVE_CHANNELS.hapticFeedback, pattern),
  reportFailure: (report) => invoke(NATIVE_CHANNELS.reportFailure, report),
  rendererReady: () => invoke(NATIVE_CHANNELS.rendererReady),
  getRecovery: () => invoke(NATIVE_CHANNELS.recovery),
  recoveryAction: (action) => invoke(NATIVE_CHANNELS.recoveryAction, action),
  getWindowChrome: () => invoke(NATIVE_CHANNELS.windowChrome),
  windowAction: (action) => invoke(NATIVE_CHANNELS.windowAction, action),
  startTalk: (id) => invoke(NATIVE_CHANNELS.startTalk, id),
  writeTalk: (data) => invoke(NATIVE_CHANNELS.writeTalk, data),
  stopTalk: () => invoke(NATIVE_CHANNELS.stopTalk),
  saveRecording: (id) => invoke(NATIVE_CHANNELS.saveRecording, id),
  saveRecoveryKit: () => invoke(NATIVE_CHANNELS.saveRecoveryKit),
  helper: (request) => invoke(NATIVE_CHANNELS.helper, request),
  nativeProviders: (request) => invoke(NATIVE_CHANNELS.nativeProviders, request),
  updateSidebarMaterial: (width) => invoke(NATIVE_CHANNELS.sidebarMaterial, width),
  openAddon: (slug) => invoke(NATIVE_CHANNELS.addon, slug),
  openIntegrationLogin: (flowId, options) =>
    invoke(NATIVE_CHANNELS.integrationLogin, flowId, options),
  management: (request) => invoke(NATIVE_CHANNELS.management, request),
  brandIcon: (kind, id, dark, hint) => invoke(NATIVE_CHANNELS.brandIcon, kind, id, dark, hint),
  discover: (options) => invoke(NATIVE_CHANNELS.discover, options),
  cancelDiscovery: () => ipcRenderer.send(NATIVE_CHANNELS.cancelDiscovery),
  discoverHausNvrNodes: () => invoke(NATIVE_CHANNELS.discoverHausNvrNodes),
  cancelHausNvrDiscovery: () => ipcRenderer.send(NATIVE_CHANNELS.cancelHausNvrDiscovery),
  getSession: () => invoke(NATIVE_CHANNELS.session),
  beginPairing: (url) => invoke(NATIVE_CHANNELS.beginPairing, url),
  connect: (url, pairingCode, explicitHa) =>
    invoke(NATIVE_CHANNELS.connect, url, pairingCode, explicitHa),
  disconnect: () => invoke(NATIVE_CHANNELS.disconnect),
  request: (message) => invoke(NATIVE_CHANNELS.request, message),
  cameraLastSnapshot: (entityId) => invoke(NATIVE_CHANNELS.cameraLastSnapshot, entityId),
  cameraSnapshot: (entityId) => invoke(NATIVE_CHANNELS.cameraSnapshot, entityId),
  getSceneConfig: (entityId, sceneId) => invoke(NATIVE_CHANNELS.sceneConfig, entityId, sceneId),
  subscribe: async <T>(message: Record<string, unknown>, callback: (event: T) => void) => {
    let subscription: string | undefined;
    const buffered: Array<{ subscriptionId: unknown; payload: unknown }> = [];
    const removeListener = addNativeEventListener((payload) => {
      if (payload.type !== 'ha-event' || payload.event.event_type !== 'haus_subscription') return;
      const data = payload.event.data;
      if (!subscription)
        buffered.push({ subscriptionId: data.subscriptionId, payload: data.payload });
      else if (data.subscriptionId === subscription) callback(data.payload as T);
    });
    try {
      subscription = await invoke<string>(NATIVE_CHANNELS.subscribe, message);
      for (const item of buffered)
        if (item.subscriptionId === subscription) callback(item.payload as T);
    } catch (error) {
      removeListener();
      throw error;
    }
    return () => {
      removeListener();
      void invoke(NATIVE_CHANNELS.unsubscribe, subscription).catch(() => undefined);
    };
  },
  getPreferences: () => invoke(NATIVE_CHANNELS.preferences),
  setPreferences: (patch) => invoke(NATIVE_CHANNELS.setPreferences, patch),
  openExternal: (url) => invoke(NATIVE_CHANNELS.openExternal, url),
  showContextMenu: (items) => invoke(NATIVE_CHANNELS.contextMenu, items),
  onEvent: (callback) => addNativeEventListener(callback),
};

contextBridge.exposeInMainWorld('hausNative', Object.freeze(native));
