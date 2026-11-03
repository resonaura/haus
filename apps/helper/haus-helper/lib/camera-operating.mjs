/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Provider-defined registry property identity, never translated name/room matching. */
export function cameraOperating({ registry, ha }) {
  const read = (cameraId) => {
    const data = registry(),
      camera = data.cameras.find((camera) => camera.id === cameraId);
    if (!camera) return {};
    const devices = new Set([camera.deviceId, ...(camera.deviceIds ?? [])].filter(Boolean));
    const result = {};
    for (const control of ['indicator', 'nightVision']) {
      const candidates = (data.entities ?? []).filter((entity) => {
        if (
          !devices.has(entity.device_id) ||
          entity.disabled_by ||
          entity.hidden_by ||
          !/^(switch|light)\./.test(entity.entity_id)
        )
          return false;
        if (entity.platform === 'eufy_security')
          return entity.unique_id?.endsWith(
            control === 'indicator' ? '_device_statusLed' : '_device_autoNightvision',
          );
        if (entity.platform === 'tuya' && control === 'indicator')
          return entity.unique_id?.endsWith('basic_indicator');
        const state = (data.states ?? []).find((state) => state.entity_id === entity.entity_id);
        return state?.attributes?.haus_camera_role === control;
      });
      if (candidates.length !== 1) continue;
      const entity = candidates[0],
        state = (data.states ?? []).find((state) => state.entity_id === entity.entity_id);
      if (!state) continue;
      result[control] = {
        id: entity.entity_id,
        available: ha.connected !== false && !['unknown', 'unavailable'].includes(state.state),
        value: state.state === 'on',
      };
    }
    return result;
  };
  return {
    read,
    async write(cameraId, control, entityId, value) {
      const current = read(cameraId)[control];
      if (!current?.available || current.id !== entityId || typeof value !== 'boolean')
        throw Error('camera_control_unavailable');
      await ha.request({
        type: 'call_service',
        domain: entityId.split('.')[0],
        service: value ? 'turn_on' : 'turn_off',
        service_data: { entity_id: entityId },
      });
    },
  };
}
