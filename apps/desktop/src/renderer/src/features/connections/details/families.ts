import type { AddonInfo, IntegrationEntry } from '../../../ha/management';

const families = new Map([
  ['tuya', 'tuya'],
  ['tuya-rtsp-bridge', 'tuya'],
  ['govee', 'govee'],
  ['homebridge-govee', 'govee'],
  ['govee2mqtt', 'govee'],
]);

/** Presentation identity only. Never use this key to address a runtime or an entry. */
export function integrationFamily(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/^[a-f0-9]{8}_/, '')
    .replaceAll('_', '-');
  return families.get(normalized) ?? id;
}

export function familyName(id: string, fallback: string): string {
  const family = integrationFamily(id);
  return family === 'tuya' ? 'Tuya' : family === 'govee' ? 'Govee' : fallback;
}

export function familyEntries(entries: readonly IntegrationEntry[], domain: string) {
  const family = integrationFamily(domain);
  return entries.filter((entry) => integrationFamily(entry.domain) === family);
}

export function groupAddonFamilies(items: readonly AddonInfo[]) {
  const groups = new Map<string, { id: string; name: string; items: AddonInfo[] }>();
  for (const item of items) {
    const id = integrationFamily(item.slug);
    const group = groups.get(id) ?? { id, name: familyName(id, item.name), items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function integrationSummary(entries: readonly IntegrationEntry[], deviceCount: number) {
  const apps = entries.filter(
    (entry) => entry.source === 'app' || entry.entry_id.startsWith('app:'),
  );
  const accounts = entries.length - apps.length;
  return [
    ...(accounts ? [`${accounts} ${accounts === 1 ? 'account' : 'accounts'}`] : []),
    ...(apps.length ? [`${apps.length} ${apps.length === 1 ? 'component' : 'components'}`] : []),
    `${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}`,
  ].join(' · ');
}
