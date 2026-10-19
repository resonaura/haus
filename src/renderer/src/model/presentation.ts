import type { HausAccessory } from './types';
import { binaryStateDescription } from './device-appearance';
import { lightStateDescription } from './light-profile';
import { lightGroupDescription } from './room-devices';

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
  if (a.lightGroup) return lightGroupDescription(a);
  if (a.availability !== 'available') return titleCase(a.availability);
  const s = a.state;
  const domain = s.entity_id.split('.')[0];
  if (domain === 'light') return lightStateDescription(s);
  if (domain === 'binary_sensor') return binaryStateDescription(s) ?? titleCase(s.state);
  if (domain === 'climate')
    return `${s.attributes.current_temperature ?? s.attributes.temperature ?? '—'}° · ${titleCase(s.state)}`;
  if (domain === 'media_player')
    return s.state === 'playing'
      ? String(s.attributes.media_title ?? 'Playing')
      : titleCase(s.state);
  if (domain === 'sensor') return `${s.state}${s.attributes.unit_of_measurement ?? ''}`;
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
