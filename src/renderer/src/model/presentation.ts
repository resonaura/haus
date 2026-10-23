import type { HausAccessory } from './types';
import { binaryStateDescription } from './device-appearance';
import { lightStateDescription } from './light-profile';
import { lightGroupDescription } from './room-devices';
import { knownScaleReading, isScaleReading } from './device-telemetry';
import { heaterModeLabel, isKettle, knownTemperature } from './water-heater';
import { formatTemperature } from './format-temperature';

export const titleCase = (text: string) =>
  text.replaceAll('_', ' ').replace(/\b\w/g, (s) => s.toUpperCase());
export const formatLastUsed = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(timestamp),
  );
};
export function describeAccessory(a: HausAccessory): string {
  if (a.buttonController) {
    const buttons = [a.state, ...a.secondaryEntities].filter((item) =>
      item.entity_id.startsWith('event.'),
    );
    return `${buttons.length} controls${a.batteryLevel !== undefined ? '' : ' · Wireless remote'}`;
  }
  if (a.physicalHub)
    return 'Hub · ' + (a.availability === 'available' ? 'Ready' : 'Status unavailable');
  if (a.lightGroup) return lightGroupDescription(a);
  if (
    a.availability !== 'available' &&
    isScaleReading(a.state, { id: a.deviceId ?? '', name: a.name, model: a.model })
  ) {
    const reading = knownScaleReading(a.secondaryEntities, {
      id: a.deviceId ?? '',
      name: a.name,
      model: a.model,
    });
    if (reading) return `Last ${reading.state}${reading.attributes.unit_of_measurement ?? ''}`;
  }
  if (a.availability !== 'available') return titleCase(a.availability);
  if (a.category === 'network') {
    const clients = [a.state, ...a.secondaryEntities].find((item) =>
      item.entity_id.endsWith('connected_clients'),
    );
    return `${['green', 'connected', 'online'].includes(a.state.state) ? 'Connected' : titleCase(a.state.state)}${clients && Number.isFinite(Number(clients.state)) ? ` · ${clients.state} clients` : ''}`;
  }
  const s = a.state;
  const domain = s.entity_id.split('.')[0];
  if (domain === 'light') return lightStateDescription(s);
  if (domain === 'binary_sensor') return binaryStateDescription(s) ?? titleCase(s.state);
  if (domain === 'climate') {
    const temperature = formatTemperature(
      s.attributes.current_temperature ?? s.attributes.temperature,
      s.attributes.suggested_display_precision,
    );
    return `${temperature !== undefined ? `${temperature}° · ` : ''}${titleCase(s.state)}`;
  }
  if (domain === 'water_heater') {
    const temperature = knownTemperature(s.attributes.current_temperature);
    const activity =
      typeof s.attributes.activity === 'string'
        ? s.attributes.activity
        : heaterModeLabel(s.state, isKettle(a));
    const formatted = formatTemperature(temperature, s.attributes.suggested_display_precision);
    return `${formatted !== undefined ? `${formatted}° · ` : ''}${activity}`;
  }
  if (domain === 'media_player')
    return s.state === 'playing'
      ? String(s.attributes.media_title ?? 'Playing')
      : titleCase(s.state);
  if (domain === 'sensor') {
    const value =
      s.attributes.device_class === 'temperature'
        ? (formatTemperature(s.state, s.attributes.suggested_display_precision) ?? s.state)
        : s.state;
    return `${value}${s.attributes.unit_of_measurement ?? ''}`;
  }
  if (domain === 'button' || domain === 'input_button') {
    const timestamp = Date.parse(s.state);
    return Number.isFinite(timestamp)
      ? `Last pressed ${formatLastUsed(timestamp)}`
      : 'Ready to press';
  }
  if (domain === 'cover' && s.attributes.current_position != null)
    return `${s.attributes.current_position}% open`;
  return titleCase(s.state);
}
