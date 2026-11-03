/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';

/** Source enrollment changes transport ownership, never the camera ID used by recorded events. */
export class NativeCameraIdentities {
  constructor(db, onChanged = () => {}) {
    this.db = db;
    this.onChanged = onChanged;
    db.exec(
      'CREATE TABLE IF NOT EXISTS native_camera_identities(bridge_id TEXT NOT NULL,physical_id TEXT NOT NULL,camera_id TEXT NOT NULL UNIQUE,PRIMARY KEY(bridge_id,physical_id))',
    );
  }
  resolve(bridgeId, physicalId, legacyCameraId) {
    if (
      typeof bridgeId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bridgeId) ||
      typeof physicalId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(physicalId) ||
      (legacyCameraId !== undefined &&
        (typeof legacyCameraId !== 'string' || !/^camera\.[a-z0-9_]{1,128}$/.test(legacyCameraId)))
    )
      throw Error('invalid_native_camera_identity');
    const find = () =>
      this.db
        .prepare(
          'SELECT camera_id FROM native_camera_identities WHERE bridge_id=? AND physical_id=?',
        )
        .get(bridgeId, physicalId)?.camera_id;
    const old = find();
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
    try {
      this.db
        .prepare(
          'INSERT INTO native_camera_identities(bridge_id,physical_id,camera_id)VALUES(?,?,?)',
        )
        .run(bridgeId, physicalId, cameraId);
    } catch {
      if (find() === cameraId) return cameraId;
      throw Error('native_camera_identity_conflict');
    }
    this.onChanged();
    return cameraId;
  }
  list(bridgeId) {
    return this.db
      .prepare(
        'SELECT physical_id AS physicalId,camera_id AS cameraId FROM native_camera_identities WHERE bridge_id=? ORDER BY physical_id',
      )
      .all(bridgeId);
  }
}
