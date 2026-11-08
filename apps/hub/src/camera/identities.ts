/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';

export interface NativeCameraIdentityRecord {
  physicalId: string;
  cameraId: string;
}

export interface NativeIdentityCatalogPort {
  identity(bridgeId: string, physicalId: string): { cameraId: string } | undefined;
  resolveIdentity(input: {
    bridgeId: string;
    physicalId: string;
    cameraId: string;
  }): Promise<unknown>;
  identities(bridgeId: string): ReadonlyArray<NativeCameraIdentityRecord>;
}

/** Source enrollment changes transport ownership, never the camera ID used by recorded events. */
export class NativeCameraIdentities {
  readonly catalog: NativeIdentityCatalogPort;
  readonly onChanged: () => void;

  constructor(catalog: { native: NativeIdentityCatalogPort }, onChanged: () => void = () => {}) {
    this.catalog = catalog.native;
    this.onChanged = onChanged;
  }

  select(bridgeId: string, physicalId: string, legacyCameraId?: string): string {
    if (
      typeof bridgeId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bridgeId) ||
      typeof physicalId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(physicalId) ||
      (legacyCameraId !== undefined &&
        (typeof legacyCameraId !== 'string' || !/^camera\.[a-z0-9_]{1,128}$/.test(legacyCameraId)))
    ) {
      throw new Error('invalid_native_camera_identity');
    }
    const old = this.catalog.identity(bridgeId, physicalId)?.cameraId;
    if (old) {
      if (legacyCameraId && old !== legacyCameraId) {
        throw new Error('native_camera_identity_conflict');
      }
      return old;
    }
    const cameraId =
      legacyCameraId ??
      `camera.haus_${createHash('sha256')
        .update(JSON.stringify([bridgeId, physicalId]))
        .digest('hex')
        .slice(0, 32)}`;
    return cameraId;
  }

  async resolve(bridgeId: string, physicalId: string, legacyCameraId?: string): Promise<string> {
    const cameraId = this.select(bridgeId, physicalId, legacyCameraId);
    const existed = this.catalog.identity(bridgeId, physicalId);
    await this.catalog.resolveIdentity({ bridgeId, physicalId, cameraId });
    if (!existed) this.onChanged();
    return cameraId;
  }

  list(bridgeId: string): NativeCameraIdentityRecord[] {
    return this.catalog
      .identities(bridgeId)
      .map(({ physicalId, cameraId }) => ({ physicalId, cameraId }));
  }
}
