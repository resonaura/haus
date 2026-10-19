import type { Device } from './types';
export const isServiceRoom = (name: string) =>
  /^(?:system|home assistant|homeassistant|services?|infrastructure)$/i.test(name.trim());
export const isVirtualDevice = (device?: Device) =>
  /^(?:integration|home assistant app|homebridge|service|add-on|addon)$/i.test(
    String(device?.model ?? '').trim(),
  );
export const isPhysicalHub = (device?: Device) =>
  !isVirtualDevice(device) &&
  !/camera|nest/i.test(String(device?.model ?? '')) &&
  /(?:hub|bridge|gateway)/i.test(`${device?.model ?? ''}`);
export const isButtonController = (device?: Device) =>
  /(?:tap dial|dimmer switch|smart button|remote control|wireless switch|ylkg0[78])/i.test(
    `${device?.model ?? ''}`,
  );
/** A clock's two integrations can describe the exact same physical object. Never join by room alone. */
export function clockDeviceAliases(devices: Device[]) {
  const groups = new Map<string, Device[]>();
  for (const device of devices) {
    const name = String(device.name_by_user || device.name || '')
      .trim()
      .toLowerCase();
    if (!device.area_id || !/\b(?:clock|nixie)\b/.test(`${name} ${device.model ?? ''}`)) continue;
    const key = `${device.area_id}:${name}`;
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }
  const aliases = new Map<string, string>();
  for (const items of groups.values())
    if (items.length === 2) {
      const owner = items.find((item) => /clock|nixie/i.test(String(item.model)));
      if (owner) for (const item of items) aliases.set(item.id, owner.id);
    }
  return aliases;
}
