/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Only one registered light on the camera's physical device can become its spotlight. */
export function cameraSpotlight({ registry, ha }) {
  const read = (cameraId) => {
    const data = registry(),
      camera = data.cameras.find((camera) => camera.id === cameraId);
    if (!camera) return;
    const devices = new Set([camera.deviceId, ...(camera.deviceIds ?? [])].filter(Boolean));
    const physical = new Map((data.devices ?? []).map((device) => [device.id, device]));
    const lights = (data.entities ?? []).filter(
      (entity) =>
        entity.entity_id.startsWith('light.') &&
        devices.has(entity.device_id) &&
        !entity.disabled_by &&
        !entity.hidden_by &&
        ((entity.platform === 'mqtt' &&
          /(?:^|_)spotlight$/.test(entity.unique_id ?? '') &&
          physical.get(entity.device_id)?.manufacturer?.toLowerCase() === 'aqara' &&
          /(?:\bg5\s*pro\b|agl004)/i.test(physical.get(entity.device_id)?.model ?? '')) ||
          (data.states ?? []).some(
            (state) =>
              state.entity_id === entity.entity_id &&
              state.attributes?.haus_camera_role === 'spotlight',
          )),
    );
    if (lights.length !== 1) return;
    const state = (data.states ?? []).find((state) => state.entity_id === lights[0].entity_id);
    if (!state) return;
    const attrs = state.attributes ?? {},
      modes = attrs.supported_color_modes ?? [];
    const temperature =
      modes.includes('color_temp') &&
      Number.isFinite(attrs.min_color_temp_kelvin) &&
      Number.isFinite(attrs.max_color_temp_kelvin)
        ? { minKelvin: attrs.min_color_temp_kelvin, maxKelvin: attrs.max_color_temp_kelvin }
        : undefined;
    return {
      id: state.entity_id,
      available: camera.available && !['unknown', 'unavailable'].includes(state.state),
      on: state.state === 'on',
      brightness: Number.isFinite(attrs.brightness)
        ? Math.round((attrs.brightness / 255) * 100)
        : undefined,
      hue: Array.isArray(attrs.hs_color) ? attrs.hs_color[0] : undefined,
      saturation: Array.isArray(attrs.hs_color) ? attrs.hs_color[1] : undefined,
      colorTemperature: Number.isFinite(attrs.color_temp_kelvin)
        ? attrs.color_temp_kelvin
        : undefined,
      capabilities: {
        brightness: modes.some((mode) =>
          ['brightness', 'color_temp', 'hs', 'rgb', 'rgbw', 'rgbww', 'xy', 'white'].includes(mode),
        ),
        color: modes.some((mode) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(mode)),
        colorTemperature: temperature,
      },
    };
  };
  return {
    read,
    async write(cameraId, entityId, value) {
      const current = read(cameraId);
      if (!current?.available || current.id !== entityId || ha.connected === false)
        throw Error('spotlight_unavailable');
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !Object.keys(value).length ||
        Object.keys(value).some(
          (key) => !['on', 'brightness', 'hue', 'saturation', 'colorTemperature'].includes(key),
        )
      )
        throw Error('invalid_spotlight_command');
      if (value.on !== undefined && typeof value.on !== 'boolean')
        throw Error('invalid_spotlight_command');
      const inRange = (number, min, max) =>
        typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max;
      if (
        value.brightness !== undefined &&
        (!current.capabilities.brightness || !inRange(value.brightness, 0, 100))
      )
        throw Error('invalid_spotlight_command');
      if (value.hue !== undefined && (!current.capabilities.color || !inRange(value.hue, 0, 360)))
        throw Error('invalid_spotlight_command');
      if (
        value.saturation !== undefined &&
        (!current.capabilities.color || !inRange(value.saturation, 0, 100))
      )
        throw Error('invalid_spotlight_command');
      if (
        value.colorTemperature !== undefined &&
        (!current.capabilities.colorTemperature ||
          !inRange(
            value.colorTemperature,
            current.capabilities.colorTemperature.minKelvin,
            current.capabilities.colorTemperature.maxKelvin,
          ))
      )
        throw Error('invalid_spotlight_command');
      const service = value.on === false ? 'turn_off' : 'turn_on',
        service_data = { entity_id: entityId };
      if (service === 'turn_on') {
        if (value.brightness !== undefined) service_data.brightness_pct = value.brightness;
        if (value.colorTemperature !== undefined)
          service_data.color_temp_kelvin = value.colorTemperature;
        if (value.hue !== undefined || value.saturation !== undefined)
          service_data.hs_color = [
            value.hue ?? current.hue ?? 0,
            value.saturation ?? current.saturation ?? 0,
          ];
      }
      await ha.request({ type: 'call_service', domain: 'light', service, service_data });
    },
  };
}
