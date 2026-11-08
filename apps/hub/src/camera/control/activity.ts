/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { activityId as activityKey } from '@haus/media/activity';

export { activityKey };

export interface CameraActivitySensor {
  id: string;
  kind: string;
  active?: boolean;
  available?: boolean;
  independent?: boolean;
  source?: string;
  cameraNative?: boolean;
}

export interface CameraActivityItem {
  id: string;
  available?: boolean;
  sensors?: CameraActivitySensor[];
  motionDetection?: { enabled?: boolean; mode?: string };
}

export interface CameraActivityStatus {
  available: boolean;
  active: boolean;
  source: 'none' | 'assisted' | 'analysis_unavailable' | 'native_fallback' | 'native';
  assistState?: string;
  sources?: string[];
  replaces?: string[];
  lastDetectedAt?: number;
  kind?: string;
}

interface CameraActivityEntry {
  camera: CameraActivityItem;
  delivered: Map<string, number>;
  until: number;
  waitingAt?: number;
  lastDetectedAt?: number;
  kind?: string;
  nativeActive?: Set<string>;
}

const nativeCameraSensor = (sensor: CameraActivitySensor): boolean =>
  sensor.source === 'device' || sensor.cameraNative === true;

/** One authority for recording and HA state. Raw sensors are never rewritten. */
export class CameraActivity {
  recorder: {
    trigger(id: string, kind: string, source: string, at: number): Promise<unknown>;
  };
  motion: {
    status(id: string): { state: string; fresh?: boolean };
  };
  now: () => number;
  entries = new Map<string, CameraActivityEntry>();
  captureNative?: (id: string, kind: string, source: string, at: number) => boolean;

  constructor({
    recorder,
    motion,
    now = Date.now,
  }: {
    recorder: {
      trigger(id: string, kind: string, source: string, at: number): Promise<unknown>;
    };
    motion: {
      status(id: string): { state: string; fresh?: boolean };
    };
    now?: () => number;
  }) {
    this.recorder = recorder;
    this.motion = motion;
    this.now = now;
  }

  sync(cameras: CameraActivityItem[]): void {
    for (const [id] of this.entries)
      if (!cameras.some((camera) => camera.id === id)) this.entries.delete(id);
    for (const camera of cameras) {
      const entry = this.entries.get(camera.id) ?? {
        camera,
        delivered: new Map<string, number>(),
        until: 0,
      };
      entry.camera = camera;
      this.entries.set(camera.id, entry);
    }
  }

  status(id: string): CameraActivityStatus {
    const entry = this.entries.get(id);
    if (!entry) return { available: false, active: false, source: 'none' };
    const { camera } = entry;
    const native = (camera.sensors ?? []).filter((sensor) => sensor.available !== false);
    const assist = camera.motionDetection?.enabled === true;
    const analysis = assist ? this.motion.status(id) : { state: 'off' };
    const healthy = analysis.state === 'running' && analysis.fresh === true;
    if (assist && !healthy) entry.waitingAt ??= this.now();
    else entry.waitingAt = undefined;
    const validating =
      assist &&
      (healthy || (entry.waitingAt !== undefined && this.now() - entry.waitingAt < 30000));
    // Generic native motion becomes a hint while analysis validates the scene.
    // Recognized native objects/doorbell keep their existing semantics.
    const accepted = native.filter(
      (sensor) => !validating || sensor.kind !== 'motion' || sensor.independent === true,
    );
    return {
      available: Boolean(camera.available) && (healthy || accepted.length > 0),
      active:
        Boolean(camera.available) &&
        (entry.until > this.now() || accepted.some((sensor) => Boolean(sensor.active))),
      source: assist
        ? healthy
          ? 'assisted'
          : validating
            ? 'analysis_unavailable'
            : native.length
              ? 'native_fallback'
              : 'analysis_unavailable'
        : 'native',
      assistState: analysis.state,
      sources: (camera.sensors ?? []).map((sensor) => sensor.id),
      replaces: (camera.sensors ?? []).filter(nativeCameraSensor).map((sensor) => sensor.id),
      lastDetectedAt: entry.lastDetectedAt,
      kind: entry.kind,
    };
  }

  accept(
    id: string,
    kind: string,
    source: string,
    at = this.now(),
    recordingManaged = false,
  ): void {
    const entry = this.entries.get(id);
    if (
      !entry ||
      !entry.camera.available ||
      !Number.isFinite(at) ||
      Math.abs(this.now() - at) > 30000
    )
      return;
    entry.until = Math.max(entry.until, this.now() + 10000);
    entry.lastDetectedAt = at;
    entry.kind = kind;
    if (this.now() - (entry.delivered.get(kind) ?? -Infinity) < 3000) return;
    entry.delivered.set(kind, this.now());
    if (recordingManaged || this.captureNative?.(id, kind, source, at)) return;
    try {
      void this.recorder.trigger(id, kind, source, at).catch(() => {});
    } catch {
      /* State remains useful in stream-only mode. */
    }
  }

  native(id: string, kind: string, source: string, at = this.now()): void {
    const entry = this.entries.get(id);
    if (
      !entry ||
      (kind === 'motion' &&
        !entry.camera.sensors?.some(
          (sensor) => sensor.id === source && sensor.independent === true,
        ) &&
        entry.camera.motionDetection?.enabled &&
        ['assisted', 'analysis_unavailable'].includes(this.status(id).source))
    )
      return;
    this.accept(id, kind, source, at);
  }

  tick(): void {
    for (const [id, entry] of this.entries) {
      const status = this.status(id);
      const active = new Set<string>();
      for (const sensor of entry.camera.sensors ?? []) {
        if (
          !sensor.active ||
          sensor.available === false ||
          (sensor.kind === 'motion' &&
            sensor.independent !== true &&
            ['assisted', 'analysis_unavailable'].includes(status.source))
        )
          continue;
        active.add(sensor.id);
        if (!entry.nativeActive?.has(sensor.id)) this.native(id, sensor.kind, sensor.id);
      }
      entry.nativeActive = active;
    }
  }

  software(id: string, event: { kind: string; at?: number; recordingManaged?: boolean }): void {
    if (!['motion', 'person', 'pet', 'vehicle'].includes(event.kind)) return;
    this.accept(id, event.kind, 'haus_activity_assist', event.at, event.recordingManaged === true);
  }

  activeSensors(camera: { id: string }): { id: string; kind: string; active: boolean }[] {
    const state = this.status(camera.id);
    return state.available && state.active
      ? [
          {
            id: activityKey(camera.id),
            kind: state.kind ?? 'motion',
            active: true,
          },
        ]
      : [];
  }
}
