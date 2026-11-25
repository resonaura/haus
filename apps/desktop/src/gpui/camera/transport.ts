/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  CameraAvailability,
  CameraDeviceConfig,
  CameraEvent,
  CameraHomeKitStatus,
  CameraOperatingControl,
} from '@haus/core/transport';
import { recordingDay, recordingMonthBoundaries } from '@haus/core/transport';
import type { HausHelper } from '../../main/helper.js';
import { isRecord } from '../../main/hub/types.js';

export type GpuiCameraViewer = Pick<HausHelper, 'request' | 'media' | 'clear'>;

export interface CameraServiceAvailability {
  readonly installed: boolean;
  readonly state?: string;
}

export interface CameraEventsQuery {
  readonly from: number;
  readonly to: number;
  readonly kind?: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseEvent(raw: unknown): CameraEvent | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.cameraId !== 'string' ||
    typeof raw.startAt !== 'number' ||
    typeof raw.endAt !== 'number' ||
    typeof raw.status !== 'string' ||
    typeof raw.duration !== 'number'
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    cameraId: raw.cameraId,
    startAt: raw.startAt,
    mediaStartAt: typeof raw.mediaStartAt === 'number' ? raw.mediaStartAt : undefined,
    endAt: raw.endAt,
    status: raw.status,
    kinds: asStringArray(raw.kinds),
    duration: raw.duration,
    originalDuration: typeof raw.originalDuration === 'number' ? raw.originalDuration : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    playbackInfo: isRecord(raw.playbackInfo)
      ? {
          originalCompatible: raw.playbackInfo.originalCompatible === true,
          originalPolicyVersion:
            typeof raw.playbackInfo.originalPolicyVersion === 'number'
              ? raw.playbackInfo.originalPolicyVersion
              : undefined,
          audio: raw.playbackInfo.audio === true,
        }
      : undefined,
    bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
  };
}

function parseOperating(raw: unknown): CameraDeviceConfig['operating'] | undefined {
  if (!isRecord(raw)) return undefined;
  const parseEntry = (entry: unknown): CameraOperatingControl | undefined => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.available !== 'boolean' ||
      typeof entry.value !== 'boolean'
    ) {
      return undefined;
    }
    return { id: entry.id, available: entry.available, value: entry.value };
  };
  return {
    indicator: parseEntry(raw.indicator),
    nightVision: parseEntry(raw.nightVision),
  };
}

function parseHomeKit(raw: unknown): CameraHomeKitStatus | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.enabled !== 'boolean' ||
    typeof raw.processor !== 'string' ||
    typeof raw.state !== 'string'
  ) {
    return undefined;
  }
  const state = ['off', 'waiting', 'pairing', 'paired', 'unavailable'].includes(raw.state)
    ? (raw.state as CameraHomeKitStatus['state'])
    : 'unavailable';
  return {
    enabled: raw.enabled,
    processor: raw.processor,
    state,
    recording: raw.recording === true,
    prebufferReady: raw.prebufferReady === true,
    processorName: typeof raw.processorName === 'string' ? raw.processorName : undefined,
    talkback: raw.talkback === true,
    paired: typeof raw.paired === 'boolean' ? raw.paired : undefined,
    pairingManagement:
      typeof raw.pairingManagement === 'boolean' ? raw.pairingManagement : undefined,
    message: typeof raw.message === 'string' ? raw.message : undefined,
  };
}

function parseCameraConfig(raw: unknown): CameraDeviceConfig | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string') return undefined;
  const motion = isRecord(raw.motionDetection)
    ? {
        enabled: raw.motionDetection.enabled === true,
        mode: raw.motionDetection.mode === 'motion' ? ('motion' as const) : ('objects' as const),
      }
    : undefined;
  return {
    id: raw.id,
    enabled: raw.enabled === true,
    aliases: asStringArray(raw.aliases),
    talkAvailable: raw.talkAvailable === true,
    motionDetection: motion,
    operating: parseOperating(raw.operating),
    homekit: parseHomeKit(raw.homekit),
  };
}

export interface GpuiCameraApi {
  availability(): Promise<CameraServiceAvailability>;
  listEvents(cameraId: string, query: CameraEventsQuery): Promise<CameraEvent[]>;
  recordedDays(cameraId: string, month: string): Promise<readonly string[]>;
  loadSettings(cameraId: string): Promise<CameraDeviceConfig | undefined>;
  patchSettings(
    cameraId: string,
    patch: Partial<Pick<CameraDeviceConfig, 'enabled' | 'motionDetection'>>,
  ): Promise<void>;
  startManualRecording(cameraId: string): Promise<CameraEvent | undefined>;
  prepareRecording(eventId: string): Promise<void>;
  setOperatingControl(
    cameraId: string,
    control: 'indicator' | 'nightVision',
    entityId: string,
    value: boolean,
  ): Promise<void>;
  setHomeKit(cameraId: string, enabled: boolean, processor?: string): Promise<void>;
  startHomeKitPairing(
    cameraId: string,
  ): Promise<{ readonly paired: boolean; readonly code?: string }>;
  resetHomeKitPairing(cameraId: string): Promise<void>;
  clear(): void;
}

export function createGpuiCameraApi(
  createViewer: (hub: string) => GpuiCameraViewer,
  hub: string,
): GpuiCameraApi {
  let cachedViewer: GpuiCameraViewer | undefined;
  const viewer = () => {
    cachedViewer ??= createViewer(hub);
    return cachedViewer;
  };

  return {
    async availability() {
      const res = await viewer().request({ method: 'GET', path: '/api/availability' });
      if (!isRecord(res)) return { installed: false };
      return {
        installed: res.installed === true,
        state: typeof res.state === 'string' ? res.state : undefined,
      };
    },
    async listEvents(cameraId, query) {
      const params = new URLSearchParams({
        camera_id: cameraId,
        from: String(query.from),
        to: String(query.to),
        limit: '100',
      });
      if (query.kind && query.kind !== 'all') params.set('kind', query.kind);
      const res = await viewer().request({ method: 'GET', path: `/api/events?${params}` });
      if (!isRecord(res)) return [];
      const list = Array.isArray(res.events)
        ? res.events
        : Array.isArray(res.items)
          ? res.items
          : [];
      return list.flatMap((entry) => {
        const parsed = parseEvent(entry);
        return parsed ? [parsed] : [];
      });
    },
    async recordedDays(cameraId, month) {
      const params = new URLSearchParams({
        camera_id: cameraId,
        boundaries: recordingMonthBoundaries(month).join(','),
      });
      const res = await viewer().request({ method: 'GET', path: `/api/events/calendar?${params}` });
      if (
        !isRecord(res) ||
        !Array.isArray(res.days) ||
        !res.days.every((day): day is number => typeof day === 'number' && Number.isFinite(day))
      ) {
        throw new Error('The Hub returned invalid recording dates.');
      }
      return res.days.map((day) => recordingDay(day));
    },
    async loadSettings(cameraId) {
      const res = await viewer().request({ method: 'GET', path: '/api/cameras' });
      if (!isRecord(res) || !Array.isArray(res.cameras)) return undefined;
      const configs = res.cameras.flatMap((item) => {
        const parsed = parseCameraConfig(item);
        return parsed ? [parsed] : [];
      });
      return configs.find((cam) => cam.id === cameraId || cam.aliases?.includes(cameraId));
    },
    async patchSettings(cameraId, patch) {
      await viewer().request({
        method: 'PATCH',
        path: `/api/cameras/${cameraId}`,
        data: patch,
      });
    },
    async startManualRecording(cameraId) {
      const res = await viewer().request({
        method: 'POST',
        path: `/api/cameras/${cameraId}/record`,
        data: {},
      });
      return parseEvent(res);
    },
    async prepareRecording(eventId) {
      await viewer().request({
        method: 'GET',
        path: `/api/events/${eventId}/prepare`,
      });
    },
    async setOperatingControl(cameraId, control, entityId, value) {
      await viewer().request({
        method: 'POST',
        path: `/api/cameras/${cameraId}/operating`,
        data: { control, entityId, value },
      });
    },
    async setHomeKit(cameraId, enabled, processor = 'auto') {
      await viewer().request({
        method: 'POST',
        path: `/api/cameras/${cameraId}/homekit`,
        data: { enabled, processor },
      });
    },
    async startHomeKitPairing(cameraId) {
      const res = await viewer().request({
        method: 'POST',
        path: `/api/cameras/${cameraId}/homekit/pair`,
        data: {},
      });
      if (isRecord(res) && res.paired === false && typeof res.code === 'string') {
        return { paired: false, code: res.code };
      }
      return { paired: isRecord(res) && res.paired === true };
    },
    async resetHomeKitPairing(cameraId) {
      await viewer().request({
        method: 'POST',
        path: `/api/cameras/${cameraId}/homekit/reset`,
        data: {},
      });
    },
    clear() {
      cachedViewer?.clear();
      cachedViewer = undefined;
    },
  };
}

export type { CameraAvailability };
