/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { reconcileDeviceUserAssignments, type HausDevice } from '@haus/core';
import type { StandaloneHomePersistence } from '../../home/home.persistence.js';
import type { StandaloneHomeService } from '../../home/home.service.js';
import { flattenTuyaStatus, isTuyaCameraCloudDevice } from './mapper.js';
import type { TuyaCloudDevice } from './types.js';

export interface TuyaDetectedCamera {
  readonly id: string;
  readonly name: string;
  readonly entryId: string;
  readonly productName?: string;
  readonly online?: boolean;
}

/** Splits Tuya cloud devices into non-camera smart devices and detected cloud cameras. */
export function partitionTuyaCloudDevices(
  cloudDevices: readonly TuyaCloudDevice[],
  entryId: string,
): { readonly devices: TuyaCloudDevice[]; readonly cameras: TuyaDetectedCamera[] } {
  const devices: TuyaCloudDevice[] = [];
  const cameras: TuyaDetectedCamera[] = [];
  for (const cloudDevice of cloudDevices) {
    const statusMap = flattenTuyaStatus(cloudDevice.status);
    if (isTuyaCameraCloudDevice(cloudDevice, statusMap)) {
      cameras.push({
        id: cloudDevice.id,
        name: cloudDevice.name,
        entryId,
        ...(cloudDevice.product_name ? { productName: cloudDevice.product_name } : {}),
        ...(typeof cloudDevice.online === 'boolean' ? { online: cloudDevice.online } : {}),
      });
    } else {
      devices.push(cloudDevice);
    }
  }
  return { devices, cameras };
}

/** True for legacy unplayable Tuya cloud camera stub devices that must stay out of device/camera lists. */
export function isTuyaCloudCameraStubDevice(
  device: Pick<HausDevice, 'id' | 'category' | 'endpoints'>,
): boolean {
  if (!device.id.startsWith('tuya:')) return false;
  if (device.category === 'cameras') return true;
  return device.endpoints.some(
    (ep) => !ep.mediaId && ep.id.startsWith('ep_tuya_') && ep.id.endsWith('_camera'),
  );
}

/** Tracks Tuya cloud cameras separately from HausDevice so setup alerts work without polluting lists. */
export class TuyaDetectedCameraStore {
  private readonly byEntry = new Map<string, readonly TuyaDetectedCamera[]>();

  constructor(private readonly persistence: StandaloneHomePersistence) {}

  async restore(): Promise<void> {
    const rows =
      await this.persistence.listByKind<readonly TuyaDetectedCamera[]>('tuya_cloud_cameras');
    for (const row of rows) {
      if (Array.isArray(row.value)) {
        this.byEntry.set(row.entryId, row.value);
      }
    }
  }

  async setForEntry(entryId: string, cameras: readonly TuyaDetectedCamera[]): Promise<void> {
    const prev = this.byEntry.get(entryId);
    if (cameras.length === 0) {
      if (prev && prev.length > 0) {
        this.byEntry.delete(entryId);
        await this.persistence.remove('tuya_cloud_cameras', entryId);
      }
      return;
    }
    this.byEntry.set(entryId, cameras);
    if (JSON.stringify(prev) !== JSON.stringify(cameras)) {
      await this.persistence.save('tuya_cloud_cameras', entryId, cameras);
    }
  }

  async removeEntry(entryId: string): Promise<void> {
    this.byEntry.delete(entryId);
    await this.persistence.remove('tuya_cloud_cameras', entryId);
  }

  list(entryId?: string): readonly TuyaDetectedCamera[] {
    if (entryId) return this.byEntry.get(entryId) ?? [];
    const out: TuyaDetectedCamera[] = [];
    for (const items of this.byEntry.values()) out.push(...items);
    return out;
  }

  pruneLegacyCameraStubs(homeService: StandaloneHomeService | undefined, entryId?: string): void {
    if (!homeService) return;
    for (const dev of homeService.listDevices()) {
      if (entryId && dev.source?.instanceId !== entryId) continue;
      if (isTuyaCloudCameraStubDevice(dev)) {
        homeService.removeDevice(dev.id);
      }
    }
  }
}

export function pruneRemovedTuyaDevices(
  homeService: StandaloneHomeService | undefined,
  entryId: string,
  seenDeviceIds?: ReadonlySet<string>,
): void {
  if (!homeService) return;
  for (const existing of homeService.listDevices()) {
    if (existing.source?.instanceId !== entryId) continue;
    if (!seenDeviceIds || !seenDeviceIds.has(existing.id)) {
      homeService.removeDevice(existing.id);
    }
  }
}

export function setTuyaEntryDevicesOffline(
  homeService: StandaloneHomeService | undefined,
  entryId: string,
): void {
  if (!homeService) return;
  for (const dev of homeService.listDevices()) {
    if (dev.source?.instanceId === entryId) {
      homeService.registerDevice({ ...dev, availability: 'offline' });
    }
  }
}

export async function syncMappedTuyaDevice(params: {
  readonly homeService: StandaloneHomeService;
  readonly mapped: {
    readonly device: HausDevice;
    readonly initialStates: ReadonlyArray<readonly [string, Record<string, unknown>]>;
  };
  readonly observedEndpoints: Set<string>;
  readonly isStale: () => boolean;
}): Promise<void> {
  const { homeService, mapped, observedEndpoints, isStale } = params;
  const prevStates = new Map(
    mapped.initialStates.map(([epId]) => [epId, homeService.getEndpointState(epId)]),
  );
  const existing =
    homeService.devices?.getDevice(mapped.device.id) ?? homeService.getDevice(mapped.device.id);
  homeService.registerDevice(reconcileDeviceUserAssignments(existing, mapped.device));
  await Promise.all(
    mapped.initialStates.map(async ([endpointId, patch]) => {
      if (isStale()) return;
      const dispatch = observedEndpoints.has(endpointId);
      observedEndpoints.add(endpointId);
      await homeService.updateEndpointState(
        endpointId,
        patch,
        dispatch,
        undefined,
        prevStates.get(endpointId),
      );
    }),
  );
}
