/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type * as Hap from '@homebridge/hap-nodejs';
import type { Entry } from './contracts.js';
export type OperatingControl = 'indicator' | 'nightVision';
export interface CameraOperatingSource {
  read: (
    cameraId: string,
  ) => Partial<Record<OperatingControl, { id: string; available: boolean; value: boolean }>>;
  write: (
    cameraId: string,
    control: OperatingControl,
    entityId: string,
    value: boolean,
  ) => Promise<void>;
}

/** Standard camera characteristics, not additional switches or accessories. */
export function syncCameraOperating(
  entry: Entry,
  hap: typeof Hap,
  source: CameraOperatingSource | undefined,
) {
  if (!source) return;
  const values = source.read(entry.cameraId),
    service = entry.controller.recordingManagement.operatingModeService;
  entry.operating ??= new Set();
  for (const control of ['indicator', 'nightVision'] as const) {
    const characteristic =
      control === 'indicator'
        ? hap.Characteristic.CameraOperatingModeIndicator
        : hap.Characteristic.NightVision;
    if (!values[control]) continue;
    if (!entry.operating.has(control)) {
      service.addOptionalCharacteristic(characteristic);
      service
        .getCharacteristic(characteristic)
        .onGet(() => {
          const state = source.read(entry.cameraId)[control];
          if (entry.closed || !state?.available)
            throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          return control === 'indicator' ? Number(state.value) : state.value;
        })
        .onSet(async (value) => {
          const state = source.read(entry.cameraId)[control];
          if (entry.closed || !state?.available)
            throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          try {
            await source.write(entry.cameraId, control, state.id, Boolean(value));
          } catch {
            throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          }
        });
      entry.operating.add(control);
    }
    const state = values[control];
    if (state.available)
      service.updateCharacteristic(
        characteristic,
        control === 'indicator' ? Number(state.value) : state.value,
      );
  }
}
