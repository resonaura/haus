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
import WebSocket from 'ws';
import type { HausDevice } from '@haus/core';
import { CAMERA_SERVICE } from './tokens.js';
import type { CameraService } from './types.js';
import { DefaultCameraService } from './camera.service.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';

interface EufyDevicePropertyPayload {
  readonly properties?: {
    readonly rtspStreamUrl?: string;
    readonly statusLed?: boolean;
    readonly autoNightvision?: boolean;
    readonly name?: string;
    readonly model?: string;
    readonly serialNumber?: string;
  };
}

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
  private eufyWs?: WebSocket;
  private eufyReconnectTimer?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(
    @Inject(CAMERA_SERVICE)
    private readonly cameraService: CameraService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && !process.env.HAUS_DISCOVER_CAMERAS) {
      return;
    }

    this.registerAqaraCameras();
    await this.initTuyaCameras();
    this.initEufyWebSocket();
  }

  onApplicationShutdown(): void {
    this.isShuttingDown = true;
    if (this.eufyReconnectTimer) {
      clearTimeout(this.eufyReconnectTimer);
      this.eufyReconnectTimer = undefined;
    }
    if (this.eufyWs) {
      try {
        this.eufyWs.close();
      } catch {
        // ignore
      }
      this.eufyWs = undefined;
    }
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

  private initEufyWebSocket(): void {
    if (this.isShuttingDown) return;
    const wsUrl = process.env.HAUS_EUFY_WS_URL;
    if (!wsUrl) return;

    try {
      const ws = new WebSocket(wsUrl);
      this.eufyWs = ws;

      ws.on('open', () => {
        this.logger.log('Connected to configured Eufy Security WebSocket.');
        ws.send(JSON.stringify({ messageId: 'eufy_listen', command: 'start_listening' }));
      });

      ws.on('message', (bytes: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(String(bytes)) as {
            type?: string;
            messageId?: string;
            result?: {
              state?: { devices?: Array<{ serialNumber: string; name: string; model: string }> };
            };
            event?: {
              event?: string;
              serialNumber?: string;
              name?: string;
              value?: unknown;
            };
          };

          if (msg.type === 'result' && msg.result?.state?.devices) {
            for (const dev of msg.result.state.devices) {
              const reqId = `eufy_props_${dev.serialNumber}`;
              ws.send(
                JSON.stringify({
                  messageId: reqId,
                  command: 'device.get_properties',
                  serialNumber: dev.serialNumber,
                }),
              );
            }
          } else if (msg.type === 'result' && msg.messageId?.startsWith('eufy_props_')) {
            const payload = msg.result as EufyDevicePropertyPayload | undefined;
            const props = payload?.properties;
            const serial = msg.messageId.replace('eufy_props_', '');

            const id = 'camera.outdoor_side_camera';
            const name = props?.name ?? 'Outdoor Side Camera';
            const model = props?.model ?? 'T8410C';
            const rtspUrl = props?.rtspStreamUrl;
            const indicator = Boolean(props?.statusLed);
            const nightVision = Boolean(props?.autoNightvision);

            this.registerCameraDevice({
              id,
              name,
              manufacturer: 'Eufy Security',
              model,
              rtspUrl,
              operating: { indicator, nightVision },
              onOperatingChange: async (control, value) => {
                const prop = control === 'indicator' ? 'statusLed' : 'autoNightvision';
                if (this.eufyWs && this.eufyWs.readyState === WebSocket.OPEN) {
                  this.eufyWs.send(
                    JSON.stringify({
                      messageId: `set_prop_${Date.now()}`,
                      command: 'device.set_property',
                      serialNumber: serial,
                      name: prop,
                      value,
                    }),
                  );
                }
              },
            });
          } else if (msg.type === 'event' && msg.event) {
            const ev = msg.event;
            const id = 'camera.outdoor_side_camera';
            if (ev.name === 'motionDetected' && this.homeService) {
              const detected = Boolean(ev.value);
              void this.homeService.updateEndpointState(
                `ep_${id}`,
                { state: detected ? 'detected' : 'clear', motion: detected },
                true,
              );
            } else if (
              ev.name === 'statusLed' &&
              this.cameraService instanceof DefaultCameraService
            ) {
              void this.cameraService.setOperating(id, 'indicator', id, Boolean(ev.value));
            } else if (
              ev.name === 'autoNightvision' &&
              this.cameraService instanceof DefaultCameraService
            ) {
              void this.cameraService.setOperating(id, 'nightVision', id, Boolean(ev.value));
            }
          }
        } catch {
          // ignore parsing error
        }
      });

      ws.on('close', () => {
        this.eufyWs = undefined;
        if (!this.isShuttingDown) {
          this.eufyReconnectTimer = setTimeout(() => this.initEufyWebSocket(), 10000);
        }
      });

      ws.on('error', () => {
        this.logger.warn('Eufy WebSocket connection failed; retrying in 10s.');
      });
    } catch {
      this.logger.warn('Could not initialize the configured Eufy WebSocket.');
      if (!this.isShuttingDown) {
        this.eufyReconnectTimer = setTimeout(() => this.initEufyWebSocket(), 10000);
      }
    }
  }

  private registerCameraDevice(config: {
    id: string;
    name: string;
    manufacturer: string;
    model: string;
    rtspUrl?: string;
    snapshotFetch?: () => Promise<Buffer | null>;
    operating?: { indicator?: boolean; nightVision?: boolean };
    onOperatingChange?: (control: 'indicator' | 'nightVision', value: boolean) => Promise<void>;
  }): void {
    if (this.cameraService instanceof DefaultCameraService) {
      this.cameraService.registerCamera({
        id: config.id,
        name: config.name,
        rtspUrl: config.rtspUrl,
        snapshotFetch: config.snapshotFetch,
        enabled: true,
        operating: config.operating ?? { indicator: true, nightVision: true },
        onOperatingChange: config.onOperatingChange,
      });
    }

    if (this.homeService) {
      const epId = `ep_${config.id}`;
      const device: HausDevice = {
        id: config.id,
        source: { instanceId: 'haus-cameras', externalId: config.id },
        name: config.name,
        category: 'security',
        roomId: 'unassigned',
        availability: 'online',
        connectivity: { protocol: 'local_ip' },
        manufacturer: config.manufacturer,
        model: config.model,
        sourceRefs: [{ protocol: 'virtual', externalId: config.id }],
        endpoints: [
          {
            id: epId,
            name: config.name,
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
        ],
      };
      this.homeService.registerDevice(device);
    }

    this.logger.log('Registered a configured native camera.');
  }
}
