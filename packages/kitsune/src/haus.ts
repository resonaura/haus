/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { DeviceRecord, Json } from './contracts.js';
import { Kitsune } from './hub.js';
import type { RuntimeOptions } from './runtime/host.js';
import { createHash } from 'node:crypto';
import { onboardingSettings } from './vendors/overrides.js';

export function kitsuneDeviceIdentity(provider: { pluginId: string; deviceId: string }) {
  return {
    bridgeId:
      'kitsune-' + createHash('sha256').update(provider.pluginId).digest('hex').slice(0, 24),
    physicalId: provider.deviceId,
    manufacturer: 'Kitsune',
    model: provider.pluginId,
  };
}

interface Source {
  kind: 'rtsp' | 'p2p-restream';
  url: string;
}
export interface HausCamera {
  id: string;
  name: string;
  available: boolean;
  enabled: boolean;
  independentSource: true;
  kitsuneProvider: { pluginId: string; deviceId: string };
  kitsuneSource?: Source;
  streamSelection?: { recordingId?: string; previewId?: string };
  sensors: { id: string; kind: 'motion'; active: boolean; available: boolean }[];
  aliases: string[];
  deviceIds: string[];
  deviceId?: string;
  areaId?: string;
}
interface PresentationRegistry {
  states?: { entity_id: string; attributes?: Record<string, unknown> }[];
  entities?: { entity_id: string; device_id?: string; area_id?: string }[];
  devices?: { id: string; area_id?: string }[];
}
export function cameraPresentation(cameraId: string, registry: PresentationRegistry) {
  const aliases = (registry.states ?? [])
    .filter(
      (state) =>
        state.attributes?.haus_source_camera === cameraId &&
        state.attributes?.haus_native_camera === 1,
    )
    .map((state) => state.entity_id);
  const entries = (registry.entities ?? []).filter((entry) => aliases.includes(entry.entity_id));
  const deviceIds = [
    ...new Set(entries.map((entry) => entry.device_id).filter((id): id is string => !!id)),
  ];
  const deviceId = deviceIds.length === 1 ? deviceIds[0] : undefined;
  const areaId =
    entries.find((entry) => entry.area_id)?.area_id ??
    registry.devices?.find((device) => device.id === deviceId)?.area_id;
  return { aliases, deviceIds, deviceId, areaId };
}
/** Haus adapter keeps controller discovery, media validation and activity out of SDK emulation. */
export class KitsuneCameras {
  readonly hub: Kitsune;
  private devices = new Map<
    string,
    {
      pluginId: string;
      record: DeviceRecord;
      source?: Source;
      streams?: { recordingId?: string; previewId?: string };
    }
  >();
  private syncs = new Map<string, Promise<void>>();
  private changed: () => void;
  private watched = new Set<string>();
  constructor(
    options: RuntimeOptions & {
      validateSource: (source: Source) => Promise<Source>;
      changed: () => void;
      activity: (cameraId: string, active: boolean) => void;
    },
  ) {
    this.changed = options.changed;
    this.hub = new Kitsune({
      ...options,
      emit: (event) => {
        const entry = this.devices.get(event.deviceId);
        if (event.type === 'kitsune:device:discovered' && event.device) {
          this.devices.set(event.deviceId, {
            pluginId: event.pluginId,
            record: event.device,
            source: entry?.source,
            streams: entry?.streams,
          });
          // Discovery can occur during module startup, before the process is ready for requests.
        } else if (event.type === 'kitsune:device:state' && entry && event.property) {
          entry.record.state[event.property] = event.value ?? null;
          if (event.property === 'motionDetected')
            options.activity(this.cameraId(event.deviceId), event.value === true);
        } else if (event.type === 'kitsune:device:removed') this.devices.delete(event.deviceId);
        options.emit(event);
        this.changed();
      },
    });
    this.validateSource = options.validateSource;
  }
  private validateSource: (source: Source) => Promise<Source>;
  private cameraId(id: string) {
    return `camera.kitsune_${id.replace(/^kitsune:/, '')}`;
  }
  async enable(vendor: string, version?: string) {
    const runtime = await this.hub.enable(vendor, version);
    if ('driver' in runtime) return runtime;
    const records = await runtime.call<DeviceRecord[]>('records');
    for (const record of records) {
      const existing = this.devices.get(record.id);
      this.devices.set(record.id, {
        pluginId: runtime.plugin.name,
        record,
        source: existing?.source,
        streams: existing?.streams,
      });
    }
    if (!this.watched.has(runtime.plugin.name)) {
      this.watched.add(runtime.plugin.name);
      runtime.once('stopped', () => {
        this.watched.delete(runtime.plugin.name);
        for (const item of this.devices.values())
          if (item.pluginId === runtime.plugin.name) item.record.state.online = false;
        this.changed();
      });
    }
    await this.refresh();
    this.changed();
    return { driver: 'npm', vendor, version: runtime.plugin.version };
  }
  async refresh() {
    for (const [id, entry] of this.devices) {
      if (!entry.record.interfaces.includes('VideoCamera') || !this.hub.plugins.has(entry.pluginId))
        continue;
      if (this.syncs.has(id)) continue;
      const pending = (async () => {
        try {
          const runtime = this.hub.plugins.get(entry.pluginId)!;
          const streams = await runtime.call<{
            recording: { id: string };
            preview: { id: string };
          }>('streams', [], id);
          const input = await this.hub.stream(entry.pluginId, id, { id: streams.recording.id });
          entry.streams = { recordingId: streams.recording.id, previewId: streams.preview.id };
          const candidates = [
            input.url,
            ...input.inputArguments.flatMap((arg, index, args) =>
              arg === '-i' ? [args[index + 1]] : [],
            ),
          ].filter(
            (value): value is string => typeof value === 'string' && /^rtsps?:\/\//.test(value),
          );
          const unique = [...new Set(candidates)];
          if (unique.length !== 1) throw Error('kitsune_media_adapter_required');
          entry.source = await this.validateSource({ kind: 'rtsp', url: unique[0] });
        } catch {
          entry.source = undefined;
        }
      })().finally(() => this.syncs.delete(id));
      this.syncs.set(id, pending);
    }
    await Promise.all(this.syncs.values());
    this.changed();
  }
  cameras(
    overrides: Record<
      string,
      {
        enabled?: boolean;
        name?: string;
        motionDetection?: { enabled: boolean; mode: 'objects' | 'motion' };
        talkback?: unknown;
      }
    > = {},
    registry: PresentationRegistry = {},
  ): HausCamera[] {
    return [...this.devices.values()]
      .filter(({ record }) => record.interfaces.includes('VideoCamera'))
      .map(({ pluginId, record, source, streams }) => {
        const id = this.cameraId(record.id),
          available = !!source && record.state.online !== false && this.hub.plugins.has(pluginId);
        return {
          id,
          name: overrides[id]?.name ?? record.name,
          enabled: overrides[id]?.enabled ?? false,
          available,
          independentSource: true,
          kitsuneProvider: { pluginId, deviceId: record.id },
          kitsuneSource: source,
          streamSelection: streams,
          motionDetection: overrides[id]?.motionDetection ?? { enabled: false, mode: 'objects' },
          talkback: overrides[id]?.talkback,
          ...cameraPresentation(id, registry),
          sensors: record.interfaces.includes('MotionSensor')
            ? [
                {
                  id: `${id}_motion`,
                  kind: 'motion',
                  active: record.state.motionDetected === true,
                  available,
                },
              ]
            : [],
        };
      });
  }
  async create(vendor: string, settings: Record<string, Json>) {
    await this.enable(vendor);
    const preset = this.hub.catalog().find((preset) => preset.id === vendor)!;
    if (preset.route.driver !== 'npm') throw Error('kitsune_native_onboarding_required');
    const runtime = this.hub.plugins.get(preset.route.package)!;
    const result = await runtime.call('createDevice', [settings]);
    await this.enable(vendor);
    return result;
  }
  async onboard(vendor: string, fields: Record<string, string>) {
    await this.enable(vendor);
    const preset = this.hub.catalog().find((preset) => preset.id === vendor)!;
    if (preset.route.driver !== 'npm') throw Error('kitsune_native_onboarding_required');
    const runtime = this.hub.plugins.get(preset.route.package)!;
    const actual =
      await runtime.call<{ key: string; type?: string; multiple?: boolean; readonly?: boolean }[]>(
        'getCreateDeviceSettings',
      );
    if (!Array.isArray(actual)) throw Error('kitsune_setting_requires_review');
    const mapped = onboardingSettings(preset, fields, actual);
    const names = actual.filter((setting) => ['name', 'newCamera'].includes(setting.key));
    if (names.length === 1)
      mapped.push({ key: names[0].key, value: fields.name || `${preset.name} Camera` });
    return this.create(vendor, Object.fromEntries(mapped.map(({ key, value }) => [key, value])));
  }
  async stop() {
    this.changed = () => {};
    await this.hub.stop();
  }
}
