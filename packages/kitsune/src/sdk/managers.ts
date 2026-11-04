/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  DeviceDescriptor,
  DeviceRecord,
  HostAdapters,
  Json,
  MediaObject,
  PluginDevice,
} from '../contracts.js';
import { compatibilityGuard } from './proxy-guard.js';
import { deviceStorage } from './storage.js';
import {
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedMimeTypes,
  sdkVersion,
  stateProperties,
} from './v1/surface.js';

export function createSdk(pluginId: string, host: HostAdapters) {
  const guard = compatibilityGuard(pluginId, host.diagnostic);
  const events = new EventEmitter();
  const stateInterfaces: Record<string, string> = {
    motionDetected: 'MotionSensor',
    audioDetected: 'AudioSensor',
    online: 'Online',
    batteryLevel: 'Battery',
    on: 'OnOff',
    brightness: 'Brightness',
    lockState: 'Lock',
    info: 'DeviceInformation',
  };
  const records = new Map<string, DeviceRecord>();
  const devices = new Map<string, object>();
  const catalogScope = `${pluginId}:@devices`;
  const stored = host.storage.get(catalogScope).records;
  if (stored)
    for (const record of JSON.parse(stored) as DeviceRecord[]) records.set(record.id, record);
  const idFor = (nativeId?: string) =>
    `kitsune:${createHash('sha256')
      .update(JSON.stringify([pluginId, nativeId ?? '']))
      .digest('hex')
      .slice(0, 32)}`;
  const persist = () =>
    host.storage.set(catalogScope, 'records', JSON.stringify([...records.values()]));
  const scopedConsole = (nativeId?: string) =>
    guard(
      Object.fromEntries(
        ['log', 'info', 'warn', 'error', 'debug', 'alert', 'clearAlert'].map((level) => [
          level,
          (..._args: unknown[]) =>
            host.diagnostic({
              component: 'kitsune:runtime',
              event: `plugin_${level}`,
              pluginId,
              target: idFor(nativeId),
              message: `Plugin console.${level}; arguments omitted from shared diagnostics`,
            }),
        ]),
      ),
      'console',
    );
  const onState = (nativeId: string | undefined, property: string, value: Json) => {
    const id = idFor(nativeId);
    let record = records.get(id);
    if (!record) {
      record = { id, nativeId, name: nativeId ?? pluginId, interfaces: [], state: {} };
      records.set(id, record);
    }
    record.state[property] = structuredClone(value);
    persist();
    const event = {
      type: 'kitsune:device:state' as const,
      pluginId,
      deviceId: id,
      property,
      interface: stateInterfaces[property],
      value,
    };
    host.emit(event);
    events.emit(id, event);
    events.emit('event', event);
  };
  const listen = (
    id: string,
    options: string | { event?: string } | undefined,
    callback: (...args: unknown[]) => void,
  ) => {
    const eventInterface = typeof options === 'string' ? options : options?.event;
    const listener = (event: { interface?: string; property?: string; value?: Json }) => {
      if (!eventInterface || !event.interface || event.interface === eventInterface)
        callback(
          devices.get(id),
          { eventInterface, property: event.property, eventTime: Date.now() },
          event.value,
        );
    };
    events.on(id, listener);
    return { removeListener: () => events.off(id, listener) };
  };
  const deviceManager = guard(
    {
      async onDeviceDiscovered(descriptor: DeviceDescriptor) {
        if (
          !descriptor ||
          typeof descriptor.name !== 'string' ||
          !Array.isArray(descriptor.interfaces) ||
          descriptor.interfaces.some((v) => typeof v !== 'string')
        )
          throw Error('kitsune_invalid_device');
        const id = idFor(descriptor.nativeId),
          record: DeviceRecord = {
            ...structuredClone(descriptor),
            id,
            state: records.get(id)?.state ?? {},
          };
        records.set(id, record);
        persist();
        host.emit({
          type: 'kitsune:device:discovered',
          pluginId,
          deviceId: id,
          device: structuredClone(record),
        });
        return id;
      },
      async onDevicesChanged(manifest: { providerNativeId?: string; devices: DeviceDescriptor[] }) {
        for (const descriptor of manifest.devices)
          await deviceManager.onDeviceDiscovered({
            ...descriptor,
            providerNativeId: manifest.providerNativeId,
          });
        const live = new Set(manifest.devices.map((device) => idFor(device.nativeId)));
        for (const record of records.values())
          if (
            record.providerNativeId === manifest.providerNativeId &&
            record.nativeId !== undefined &&
            !live.has(record.id)
          )
            await deviceManager.onDeviceRemoved(record.nativeId);
      },
      async onDeviceRemoved(nativeId: string) {
        const id = idFor(nativeId);
        records.delete(id);
        devices.delete(id);
        persist();
        host.emit({ type: 'kitsune:device:removed', pluginId, deviceId: id });
      },
      onDeviceEvent(nativeId: string | undefined, eventInterface: string, value: Json) {
        const property = Object.keys(stateInterfaces).find(
          (property) => stateInterfaces[property] === eventInterface,
        );
        if (property) onState(nativeId, property, value);
        const id = idFor(nativeId),
          event = {
            type: 'kitsune:device:event' as const,
            pluginId,
            deviceId: id,
            interface: eventInterface,
            value,
          };
        host.emit(event);
        events.emit(id, event);
        events.emit('event', event);
      },
      getDeviceState(nativeId?: string) {
        return guard(
          new Proxy(
            {},
            {
              get: (_object, property) => {
                const record = records.get(idFor(nativeId));
                if (property === 'id') return idFor(nativeId);
                return record?.state[String(property)] ?? (record && Reflect.get(record, property));
              },
              set: (_object, property, value: Json) => {
                onState(nativeId, String(property), value);
                return true;
              },
              has: (_object, property) =>
                property === 'id' ||
                (stateProperties as readonly string[]).includes(String(property)) ||
                String(property) in (records.get(idFor(nativeId))?.state ?? {}),
            },
          ),
          'deviceState',
        );
      },
      getDeviceStorage(nativeId?: string) {
        return guard(deviceStorage(host.storage, `${pluginId}:${nativeId ?? ''}`), 'storage');
      },
      getNativeIds() {
        return [...records.values()]
          .map((device) => device.nativeId)
          .filter((id): id is string => id !== undefined);
      },
      getDeviceLogger: scopedConsole,
      getDeviceConsole: scopedConsole,
    },
    'deviceManager',
  );
  const systemManager = guard(
    {
      getDeviceById(id: string) {
        return devices.get(id);
      },
      getDeviceByName(name: string) {
        const device = [...records.values()].find((device) => device.name === name);
        return device && devices.get(device.id);
      },
      getSystemState() {
        return Object.fromEntries(
          [...records.values()].map((device) => [
            device.id,
            Object.fromEntries(
              Object.entries({ ...device, ...device.state }).map(([key, value]) => [
                key,
                { value, stateTime: Date.now(), lastEventTime: Date.now() },
              ]),
            ),
          ]),
        );
      },
      listen(callback: (...args: unknown[]) => void) {
        const listener = (event: {
          deviceId: string;
          interface?: string;
          property?: string;
          value?: Json;
        }) =>
          callback(
            devices.get(event.deviceId),
            { eventInterface: event.interface, property: event.property, eventTime: Date.now() },
            event.value,
          );
        events.on('event', listener);
        return { removeListener: () => events.off('event', listener) };
      },
      listenDevice: listen,
    },
    'systemManager',
  );
  const createMediaObject = async (
    data: Buffer | string,
    mimeType: string,
    options?: Record<string, Json>,
  ): Promise<MediaObject> => {
    const buffer = Buffer.from(data);
    return { data: buffer, mimeType, options, getData: async () => buffer };
  };
  const mediaManager = guard(
    {
      createMediaObject,
      createFFmpegMediaObject(
        input: { inputArguments?: string[]; url?: string },
        options?: Record<string, Json>,
      ) {
        if (!input || (!input.url && !input.inputArguments?.length))
          throw Error('kitsune_invalid_media');
        return createMediaObject(JSON.stringify(input), ScryptedMimeTypes.FFmpegInput, options);
      },
      async convertMediaObjectToBuffer(media: MediaObject, mimeType: string) {
        if (media.mimeType === mimeType) return media.getData();
        if (!host.media) throw Error('kitsune_media_conversion_unavailable');
        return host.media.toBuffer(media, mimeType);
      },
      async convertMediaObjectToUrl(media: MediaObject, mimeType: string) {
        if (
          ['text/x-uri', 'text/x-local-uri', 'text/x-insecure-local-uri'].includes(media.mimeType)
        )
          return (await media.getData()).toString();
        if (!host.media) throw Error('kitsune_media_conversion_unavailable');
        return host.media.toUrl(media, mimeType);
      },
      async getFFmpegPath() {
        return host.ffmpegPath;
      },
    },
    'mediaManager',
  );
  const endpoint = (base: string | undefined, nativeId?: string) => {
    if (!base) throw Error('kitsune_public_endpoint_unavailable');
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(pluginId)}/${encodeURIComponent(nativeId ?? '')}/`;
    return url.href;
  };
  const endpointManager = guard(
    {
      async getLocalEndpoint(nativeId?: string) {
        return endpoint(host.endpointBase, nativeId);
      },
      async getPublicLocalEndpoint(nativeId?: string) {
        return endpoint(host.publicEndpointBase, nativeId);
      },
      async getPublicPushEndpoint(nativeId?: string) {
        return endpoint(host.publicEndpointBase, nativeId);
      },
    },
    'endpointManager',
  );
  class ScryptedDeviceBase {
    readonly nativeId?: string;
    readonly id: string;
    readonly storage;
    readonly console;
    readonly log;
    constructor(nativeId?: string) {
      this.nativeId = nativeId;
      this.id = idFor(nativeId);
      this.storage = deviceManager.getDeviceStorage(nativeId);
      this.console = scopedConsole(nativeId);
      this.log = this.console;
      const device = guard(this, 'ScryptedDeviceBase');
      devices.set(this.id, device);
      return device;
    }
    listen(options: string | { event?: string }, callback: (...args: unknown[]) => void) {
      return listen(this.id, options, callback);
    }
    onDeviceEvent(eventInterface: string, data: Json) {
      return deviceManager.onDeviceEvent(this.nativeId, eventInterface, data);
    }
  }
  for (const property of stateProperties)
    Object.defineProperty(ScryptedDeviceBase.prototype, property, {
      configurable: true,
      get(this: ScryptedDeviceBase) {
        return records.get(this.id)?.state[property];
      },
      set(this: ScryptedDeviceBase, value: Json) {
        onState(this.nativeId, property, value);
      },
    });
  const api = {
    sdkVersion,
    ScryptedDeviceBase,
    ScryptedInterface: guard(ScryptedInterface, 'ScryptedInterface'),
    ScryptedDeviceType: guard(ScryptedDeviceType, 'ScryptedDeviceType'),
    ScryptedMimeTypes: guard(ScryptedMimeTypes, 'ScryptedMimeTypes'),
    deviceManager,
    systemManager,
    mediaManager,
    endpointManager,
    pluginHostAPI: guard({}, 'pluginHostAPI'),
    log: scopedConsole(),
    localStorage: deviceManager.getDeviceStorage(),
  };
  return {
    sdk: guard(api, 'sdk'),
    records: () => [...records.values()].map((record) => structuredClone(record)),
    registerRoot(root: PluginDevice) {
      devices.set(idFor(), root);
    },
    async resolveDevice(id: string, root: PluginDevice): Promise<PluginDevice | undefined> {
      if (id === idFor()) return root;
      if (devices.has(id)) return devices.get(id) as PluginDevice;
      const record = records.get(id);
      if (!record?.nativeId || !root.getDevice) return;
      const device = (await root.getDevice(record.nativeId)) as PluginDevice;
      if (device) devices.set(id, device);
      return device;
    },
    stop() {
      events.removeAllListeners();
      devices.clear();
    },
  };
}
