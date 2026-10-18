import type { HausAccessory, HausAction } from './types';
import { lightProfile } from './light-profile';
import { lightColor } from './light-color';
import { earliestPending } from './pending-feedback';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
type RoomPreferences = {
  favorites: readonly string[];
  manualUsage: Readonly<Record<string, { count: number; lastUsed: number }>>;
};

/** Stable importance: live state and use counters never move a control under the pointer. */
export function roomDevicePriority(item: HausAccessory, favorites: readonly string[] = []) {
  const domain = item.primaryEntityId.split('.')[0];
  const cls = item.state.attributes.device_class;
  if (item.isService || item.defaultHidden) return 10000;
  if (item.entityIds.some((id) => favorites.includes(id))) return 10;
  if (item.category === 'network') return 800;
  if (/battery|signal_strength|timestamp|duration/.test(String(cls ?? ''))) return 900;
  if (/\b(battery|rssi|uptime|firmware)\b/i.test(item.name.replaceAll('_', ' '))) return 900;
  const rank: Record<string, number> = {
    light: 100,
    climate: 200,
    fan: 210,
    humidifier: 220,
    cover: 250,
    media_player: 300,
    vacuum: 350,
    switch: 400,
    input_boolean: 410,
    lock: 450,
    alarm_control_panel: 460,
    valve: 480,
    water_heater: 490,
  };
  if (rank[domain] !== undefined) return rank[domain];
  if (['temperature', 'humidity', 'illuminance'].includes(cls)) return 600;
  if (domain === 'binary_sensor') return 650;
  if (item.category === 'printers') return 680;
  return 750;
}

function numberedLight(item: HausAccessory) {
  if (!item.primaryEntityId.startsWith('light.') || !item.areaId || item.isService) return;
  const match =
    item.name.match(/^(.*?[^\d\s])(?:\s*[#№]\s*|\s+|\s*\()(\d{1,3})\)?$/u) ??
    item.name.match(/^(.*(?:lamp|light|bulb|strip|светильник|лампа|лента))(\d{1,3})$/iu);
  if (!match) return;
  const name = match[1].trim();
  const key = `light-group:${item.areaId}:${name.toLocaleLowerCase()}:${lightProfile(item.state).kind}`;
  return { key, name, number: Number(match[2]) };
}

/** Conservative name-based grouping, scoped to a known room and compatible light capabilities. */
export function groupNumberedLights(
  items: HausAccessory[],
  enabled = true,
  disabled: readonly string[] = [],
): HausAccessory[] {
  if (!enabled) return items;
  const groups = new Map<string, HausAccessory[]>();
  for (const item of items) {
    const numbered = numberedLight(item);
    if (numbered && !disabled.includes(numbered.key))
      groups.set(numbered.key, [...(groups.get(numbered.key) ?? []), item]);
  }
  const emitted = new Set<string>();
  return items.flatMap((item) => {
    const numbered = numberedLight(item);
    const members = numbered && groups.get(numbered.key);
    if (!numbered || !members || members.length < 2) return [item];
    // Duplicate numbering is not enough evidence that these are a set.
    if (new Set(members.map((member) => numberedLight(member)!.number)).size !== members.length)
      return [item];
    if (emitted.has(numbered.key)) return [];
    emitted.add(numbered.key);
    const ordered = [...members].sort((a, b) => collator.compare(a.name, b.name));
    const available = ordered.filter((member) => member.availability === 'available');
    const on = available.filter((member) => member.state.state === 'on');
    const representative = on[0] ?? available[0] ?? ordered[0];
    const attrs: Record<string, any> = {
      ...representative.state.attributes,
      friendly_name: numbered.name,
    };
    const sameColor = on.every((member) => lightColor(member.state) === lightColor(on[0].state));
    if (!sameColor) {
      for (const key of ['rgb_color', 'hs_color', 'xy_color', 'color_temp', 'color_temp_kelvin'])
        delete attrs[key];
    }
    if (on.length && on.every((member) => typeof member.state.attributes.brightness === 'number'))
      attrs.brightness = Math.round(
        on.reduce((sum, member) => sum + member.state.attributes.brightness, 0) / on.length,
      );
    // Only expose controls that every member supports, with a shared temperature range.
    const capabilities = ordered[0].capabilities.filter((capability) =>
      ordered.every((member) => member.capabilities.includes(capability)),
    );
    attrs.min_color_temp_kelvin = Math.max(
      ...ordered.map((member) => Number(member.state.attributes.min_color_temp_kelvin ?? 2000)),
    );
    attrs.max_color_temp_kelvin = Math.min(
      ...ordered.map((member) => Number(member.state.attributes.max_color_temp_kelvin ?? 6500)),
    );
    if (
      attrs.min_color_temp_kelvin > attrs.max_color_temp_kelvin &&
      capabilities.includes('temperature')
    )
      capabilities.splice(capabilities.indexOf('temperature'), 1);
    return [
      {
        ...representative,
        id: numbered.key,
        name: numbered.name,
        deviceId: undefined,
        entityIds: [...new Set(ordered.flatMap((member) => member.entityIds))],
        secondaryEntities: [],
        capabilities,
        state: {
          ...representative.state,
          state: on.length ? 'on' : available.length ? 'off' : 'unavailable',
          attributes: attrs,
        },
        availability: available.length ? 'available' : 'unavailable',
        lightGroup: { key: numbered.key, members: ordered },
        pending: ordered.some((member) => member.pending),
        pendingSince: earliestPending(ordered.map((member) => member.pendingSince)),
      },
    ];
  });
}

/** Manual placement wins; stable names break ties without moving tiles when power changes. */
export function orderRoomDevices(
  items: HausAccessory[],
  preferences: RoomPreferences,
  saved: readonly string[] = [],
) {
  const position = (item: HausAccessory) => {
    const aliases = [
      item.id,
      ...(item.lightGroup?.members.map((member) => member.id) ?? []),
      numberedLight(item)?.key,
    ];
    const indexes = aliases
      .map((id) => (id ? saved.indexOf(id) : -1))
      .filter((index) => index >= 0);
    return indexes.length ? Math.min(...indexes) : Infinity;
  };
  return [...items].sort((a, b) => {
    const aPosition = position(a);
    const bPosition = position(b);
    if (aPosition !== bPosition) return aPosition - bPosition;
    return (
      roomDevicePriority(a, preferences.favorites) - roomDevicePriority(b, preferences.favorites) ||
      collator.compare(a.name, b.name) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function lightGroupDescription(item: HausAccessory) {
  const members = item.lightGroup?.members ?? [];
  const on = members.filter((member) => member.state.state === 'on').length;
  const offline = members.filter((member) => member.availability !== 'available').length;
  return `${members.length} lights · ${on ? `${on} on` : 'Off'}${offline ? ` · ${offline} unavailable` : ''}`;
}

/** Expand an intent into real member targets; no virtual entity is ever sent to HA. */
export function lightGroupActions(item: HausAccessory, action: HausAction): HausAction[] {
  const available =
    item.lightGroup?.members.filter((member) => member.availability === 'available') ?? [];
  if (!available.length) throw new Error('All lights in this group are unavailable.');
  return available.map((member) => ({ ...action, target: { entity_id: member.primaryEntityId } }));
}
