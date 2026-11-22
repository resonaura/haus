/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { HausDevice, SourceDeviceRef, SourceServiceRef } from '@haus/core';
import {
  EUFY_DIRECTIONS,
  EufyCameraSession,
  eufyCameraEvent,
  type EufyCamera,
  type EufyDeviceEventMessage,
  type EufyDirection,
} from '@haus/kitsune/native';
import { CAMERA_SERVICE } from './tokens.js';
import type { CameraService } from './types.js';
import { DefaultCameraService } from './camera.service.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { Recorder } from '../events/recorder/recorder.js';
import { RECORDING_CONFIG } from '../events/tokens.js';

interface CameraIntegrationConfig {
  readonly eufy_ws_url?: string;
}

function isEufyDirection(value: string): value is EufyDirection {
  return Object.hasOwn(EUFY_DIRECTIONS, value);
}

const LEGACY_EUFY_CAMERA_ID = 'camera.outdoor_side_camera';

interface TuyaCamera {
  readonly id: string;
  readonly name?: string;
  readonly model?: string;
  readonly productId?: string;
  readonly rtspUrl?: string;
  readonly rtspPath?: string;
}

function isTuyaCamera(value: unknown): value is TuyaCamera {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'id' in value &&
    typeof value.id === 'string' &&
    (!('name' in value) || typeof value.name === 'string') &&
    (!('model' in value) || typeof value.model === 'string') &&
    (!('productId' in value) || typeof value.productId === 'string') &&
    (!('rtspUrl' in value) || typeof value.rtspUrl === 'string') &&
    (!('rtspPath' in value) || typeof value.rtspPath === 'string')
  );
}

function resolveTuyaRtspUrl(camera: TuyaCamera, baseUrl?: string): string | undefined {
  if (camera.rtspUrl) {
    try {
      const source = new URL(camera.rtspUrl);
      return source.protocol === 'rtsp:' || source.protocol === 'rtsps:' ? source.href : undefined;
    } catch {
      return undefined;
    }
  }

  if (!camera.rtspPath || !baseUrl) return undefined;

  try {
    const base = new URL(baseUrl);
    if (base.protocol !== 'rtsp:' && base.protocol !== 'rtsps:') return undefined;
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const source = new URL(camera.rtspPath.replace(/^\/+/, ''), base);
    if (source.protocol !== base.protocol || source.host !== base.host) return undefined;
    return source.href;
  } catch {
    return undefined;
  }
}

@Injectable()
export class CameraIntegrationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CameraIntegrationService.name);
  private eufySession?: EufyCameraSession;
  private readonly eufyCameras = new Map<
    string,
    { id: string; motion?: boolean; unregister?: () => void }
  >();
  private eufyReconnectTimer?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(
    @Inject(CAMERA_SERVICE)
    private readonly cameraService: CameraService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    private readonly recorder?: Recorder,
    @Optional()
    @Inject(RECORDING_CONFIG)
    private readonly recordingConfig?: CameraIntegrationConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && !process.env.HAUS_DISCOVER_CAMERAS) {
      return;
    }

    this.registerAqaraCameras();
    await this.initTuyaCameras();
    await this.reconcilePersistedCameraDevices();
    void this.initEufyWebSocket();
  }

  onApplicationShutdown(): void {
    this.isShuttingDown = true;
    if (this.eufyReconnectTimer) {
      clearTimeout(this.eufyReconnectTimer);
      this.eufyReconnectTimer = undefined;
    }
    if (this.eufySession) this.resetEufySession(this.eufySession);
  }

  private registerAqaraCameras(): void {
    const cameras = [
      {
        id: 'camera.outdoor_camera',
        name: 'Outdoor Camera',
        model: 'Camera G2H Pro',
        rtspUrl: process.env.HAUS_AQARA_OUTDOOR_RTSP,
      },
      {
        id: 'camera.guinea_pigs_camera',
        name: 'Guinea Pigs Camera',
        model: 'Camera E1',
        rtspUrl: process.env.HAUS_AQARA_GUINEA_RTSP,
      },
    ];

    for (const camera of cameras) {
      if (!camera.rtspUrl) {
        this.logger.warn(`Skipping ${camera.name}: no camera source is configured.`);
        continue;
      }
      this.registerCameraDevice({ ...camera, manufacturer: 'Aqara' });
    }
  }

  private async initTuyaCameras(): Promise<void> {
    const tuyaBaseUrl = process.env.HAUS_TUYA_URL;
    if (!tuyaBaseUrl) {
      this.logger.warn('Skipping Tuya camera discovery: no bridge URL is configured.');
      return;
    }

    try {
      const res = await fetch(`${tuyaBaseUrl}/api/cameras`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload: unknown = await res.json();
      if (!Array.isArray(payload)) {
        this.logger.warn('Tuya camera discovery returned an invalid response.');
        return;
      }

      for (const value of payload) {
        if (!isTuyaCamera(value)) continue;
        const item = value;
        const rtspUrl = resolveTuyaRtspUrl(item, process.env.HAUS_TUYA_RTSP_BASE_URL);
        if (!rtspUrl) {
          this.logger.warn('Skipping a Tuya camera without an explicit RTSP source.');
          continue;
        }
        const id = 'camera.narnia_camera';
        const name = item.name ?? 'Narnia Camera';
        const snapshotUrl = `${tuyaBaseUrl.replace(/\/$/, '')}/api/cameras/${encodeURIComponent(item.id)}/snapshot`;

        this.registerCameraDevice({
          id,
          name,
          manufacturer: 'Tuya',
          model: item.productId ?? 'Smart Life Camera',
          rtspUrl,
          snapshotFetch: async () => {
            try {
              const snapRes = await fetch(snapshotUrl, { signal: AbortSignal.timeout(4000) });
              if (snapRes.ok) {
                const arr = await snapRes.arrayBuffer();
                return Buffer.from(arr);
              }
            } catch {
              // fallback
            }
            return null;
          },
        });
      }
    } catch {
      this.logger.warn('Tuya camera discovery failed; no fallback camera was registered.');
    }
  }

  private async initEufyWebSocket(): Promise<void> {
    const url = this.eufyWebSocketUrl();
    if (!url || this.isShuttingDown) return;
    const session = new EufyCameraSession(url);
    this.eufySession = session;
    session.once('disconnected', () => this.resetEufySession(session));
    session.on('device-event', (raw: EufyDeviceEventMessage | undefined) => {
      const event = eufyCameraEvent(raw);
      const camera = event && this.eufyCameras.get(event.serial);
      if (!camera || !event || this.eufySession !== session) return;
      if (event.type !== 'motion') {
        if (this.cameraService instanceof DefaultCameraService) {
          this.cameraService.observeOperating(camera.id, event.type, event.value);
        }
        return;
      }
      if (camera.motion === event.value) return;
      camera.motion = event.value;
      this.cameraService.setMotionSensor?.(camera.id, {
        id: 'eufy:motion',
        kind: 'motion',
        active: event.value,
      });
      void this.homeService
        ?.updateEndpointState(
          `ep_${camera.id}`,
          { state: event.value ? 'detected' : 'clear', motion: event.value },
          true,
        )
        .catch(() => this.logger.warn('Could not publish Eufy motion state.'));
      if (event.value) {
        void this.recorder?.trigger(camera.id, 'motion', 'eufy:motion').catch(() => {
          this.logger.debug('Eufy motion recording was unavailable.');
        });
      }
    });

    try {
      await session.connect();
      const cameras = await session.cameras();
      if (this.eufySession !== session || this.isShuttingDown) return;
      const legacy = this.homeService?.getDevice(LEGACY_EUFY_CAMERA_ID);
      const boundSerial = legacy?.sourceRefs?.find(
        (ref) => ref.protocol === 'vendor' && ref.instanceId === 'eufy_security',
      )?.externalId;
      const matched = cameras.filter((camera) => camera.model && camera.model === legacy?.model);
      const legacySerial =
        boundSerial ??
        process.env.HAUS_EUFY_LEGACY_SERIAL?.trim() ??
        (matched.length === 1 ? matched[0]?.serial : undefined);
      for (const camera of cameras) this.registerEufyCamera(camera, session, legacySerial);
    } catch {
      this.logger.warn('Eufy Security connection unavailable.');
      this.resetEufySession(session);
    }
  }

  private resetEufySession(session: EufyCameraSession): void {
    if (this.eufySession !== session) return;
    this.eufySession = undefined;
    session.close();
    for (const camera of this.eufyCameras.values()) {
      camera.unregister?.();
      this.cameraService.setMotionSensor?.(camera.id, {
        id: 'eufy:motion',
        kind: 'motion',
        active: false,
      });
      if (!this.isShuttingDown) {
        if (this.cameraService instanceof DefaultCameraService) {
          this.cameraService.observeProviderAvailability(camera.id, false);
        }
        const device = this.homeService?.getDevice(camera.id);
        if (device) this.homeService?.registerDevice({ ...device, availability: 'offline' });
      }
    }
    this.eufyCameras.clear();
    if (this.isShuttingDown) return;
    this.eufyReconnectTimer = setTimeout(() => void this.initEufyWebSocket(), 10_000);
    this.eufyReconnectTimer.unref();
  }

  private registerEufyCamera(
    camera: EufyCamera,
    session: EufyCameraSession,
    legacySerial?: string,
  ): void {
    const previous = this.homeService
      ?.listDevices()
      .find((device) =>
        device.sourceRefs?.some(
          (ref) =>
            ref.protocol === 'vendor' &&
            ref.instanceId === 'eufy_security' &&
            ref.externalId === camera.serial,
        ),
      );
    const preserveLegacy = legacySerial === camera.serial;
    const id =
      previous?.id ??
      (preserveLegacy
        ? LEGACY_EUFY_CAMERA_ID
        : `camera.eufy_${Buffer.from(camera.serial).toString('hex')}`);
    const source: SourceServiceRef = {
      protocol: 'vendor',
      domain: 'eufy_security',
      externalId: camera.serial,
    };
    const directions = Object.keys(EUFY_DIRECTIONS).filter(isEufyDirection);
    const controls = new Map(
      directions.map((direction) => [`ep_${id}_ptz_${direction}`, direction]),
    );
    const unregister = camera.panTilt
      ? this.homeService?.registerCommandHandler(
          source,
          async (endpoint, capability, command) => {
            const direction = controls.get(endpoint);
            if (!direction || capability !== 'press' || command !== 'press') {
              throw Error('unsupported_eufy_command');
            }
            await session.move(camera.serial, direction);
          },
          { optimistic: false },
        )
      : undefined;
    this.eufyCameras.set(camera.serial, { id, unregister });
    this.registerCameraDevice({
      id,
      name: camera.name,
      manufacturer: 'Eufy Security',
      model: camera.model,
      rtspUrl: camera.rtspUrl,
      operating: camera.operating,
      eufySerial: camera.serial,
      source: {
        protocol: source.protocol,
        instanceId: source.domain,
        externalId: source.externalId,
      },
      onOperatingChange: camera.setOperating,
      controls: camera.panTilt
        ? [...controls].map(([endpoint, direction]) => ({
            id: endpoint,
            name: `Pan ${direction}`,
            sourceOwner: source,
            capabilities: [{ id: 'press', kind: 'action', readable: false, operations: ['press'] }],
            readings: {},
          }))
        : [],
    });
  }

  private registerCameraDevice(config: {
    id: string;
    name: string;
    manufacturer: string;
    model: string;
    rtspUrl?: string;
    eufySerial?: string;
    source?: SourceDeviceRef;
    controls?: HausDevice['endpoints'];
    snapshotFetch?: () => Promise<Buffer | null>;
    operating?: { indicator?: boolean; nightVision?: boolean };
    onOperatingChange?: (control: 'indicator' | 'nightVision', value: boolean) => Promise<void>;
  }): void {
    if (this.cameraService instanceof DefaultCameraService) {
      this.cameraService.registerCamera({
        id: config.id,
        name: config.name,
        rtspUrl: config.rtspUrl,
        eufySerial: config.eufySerial,
        snapshotFetch: config.snapshotFetch,
        enabled: false,
        operating: config.operating,
        onOperatingChange: config.onOperatingChange,
      });
    }

    if (this.homeService) {
      const existing = this.homeService.getDevice(config.id);
      const epId = `ep_${config.id}`;
      const device: HausDevice = {
        id: config.id,
        source: { instanceId: 'haus-cameras', externalId: config.id },
        name: config.name,
        category: 'cameras',
        roomId: existing?.roomId ?? 'unassigned',
        ...(existing?.areaId ? { areaId: existing.areaId } : {}),
        ...(existing?.metadata ? { metadata: existing.metadata } : {}),
        ...(existing?.opaqueMetadata ? { opaqueMetadata: existing.opaqueMetadata } : {}),
        availability: 'online',
        connectivity: { protocol: 'local_ip' },
        manufacturer: config.manufacturer,
        model: config.model,
        sourceRefs: [config.source ?? { protocol: 'virtual', externalId: config.id }],
        endpoints: [
          {
            id: epId,
            name: config.name,
            mediaId: config.id,
            category: 'cameras',
            capabilities: [
              {
                id: 'video',
                kind: 'custom',
                readable: true,
                operations: ['stream', 'snapshot'],
              },
              {
                id: 'motion',
                kind: 'binary',
                readable: true,
                operations: [],
              },
            ],
            readings: {},
          },
          ...(config.controls ?? []),
        ],
      };
      this.homeService.registerDevice(device);
    }

    this.logger.log('Registered a configured native camera.');
  }

  private async reconcilePersistedCameraDevices(): Promise<void> {
    if (!this.homeService) return;
    const activeIds = new Set((await this.cameraService.listCameras()).map((cam) => cam.id));
    for (const device of this.homeService.listDevices()) {
      if (device.source.instanceId !== 'haus-cameras' || activeIds.has(device.id)) continue;
      if (!this.isCameraSourceConfigured(device)) {
        this.homeService.removeDevice(device.id);
        continue;
      }
      const endpoints = device.endpoints.map((endpoint) =>
        endpoint.capabilities.some((cap) => cap.id === 'video') && !endpoint.mediaId
          ? { ...endpoint, mediaId: device.id, category: endpoint.category ?? 'cameras' }
          : endpoint,
      );
      this.homeService.registerDevice({
        ...device,
        availability: 'offline',
        endpoints,
      });
    }
  }

  private isCameraSourceConfigured(device: HausDevice): boolean {
    if (device.id === 'camera.outdoor_camera')
      return Boolean(process.env.HAUS_AQARA_OUTDOOR_RTSP?.trim());
    if (device.id === 'camera.guinea_pigs_camera')
      return Boolean(process.env.HAUS_AQARA_GUINEA_RTSP?.trim());
    if (device.manufacturer === 'Tuya')
      return Boolean(
        process.env.HAUS_TUYA_URL?.trim() && process.env.HAUS_TUYA_RTSP_BASE_URL?.trim(),
      );
    if (device.manufacturer === 'Eufy Security') return Boolean(this.eufyWebSocketUrl());
    return true;
  }

  private eufyWebSocketUrl(): string | undefined {
    return (
      this.recordingConfig?.eufy_ws_url?.trim() || process.env.HAUS_EUFY_WS_URL?.trim() || undefined
    );
  }
}
