/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';

/** Source enrollment changes transport ownership, never the camera ID used by recorded events. */
export class NativeCameraIdentities {
  constructor(catalog, onChanged = () => {}) {
    this.catalog = catalog.native;
    this.onChanged = onChanged;

  }
  select(bridgeId, physicalId, legacyCameraId) {
    if (
      typeof bridgeId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bridgeId) ||
      typeof physicalId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(physicalId) ||
      (legacyCameraId !== undefined &&
        (typeof legacyCameraId !== 'string' || !/^camera\.[a-z0-9_]{1,128}$/.test(legacyCameraId)))
    )
      throw Error('invalid_native_camera_identity');
    const old = this.catalog.identity(bridgeId, physicalId)?.cameraId;
    if (old) {
      if (legacyCameraId && old !== legacyCameraId) throw Error('native_camera_identity_conflict');
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
  async resolve(bridgeId, physicalId, legacyCameraId) {
    const cameraId = this.select(bridgeId, physicalId, legacyCameraId);
    const existed = this.catalog.identity(bridgeId, physicalId);
    await this.catalog.resolveIdentity({ bridgeId, physicalId, cameraId });
    if (!existed) this.onChanged();
    return cameraId;
  }
  list(bridgeId) {
    return this.catalog.identities(bridgeId).map(({ physicalId, cameraId }) => ({ physicalId, cameraId }));
  }
}
