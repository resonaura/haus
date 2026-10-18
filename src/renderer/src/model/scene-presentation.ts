import type { EntityRegistryEntry, HassEntity } from './types';

export function sceneLightingIsDark(
  settings: Record<string, unknown> | undefined,
): boolean | undefined {
  if (!settings) return undefined;
  const lights = Object.entries(settings).filter(([id]) => id.startsWith('light.'));
  if (!lights.length) return undefined;
  return lights.every(([, setting]) => {
    if (setting === 'off') return true;
    if (!setting || typeof setting !== 'object') return false;
    const value = setting as Record<string, unknown>;
    const attrs =
      value.attributes && typeof value.attributes === 'object'
        ? (value.attributes as Record<string, unknown>)
        : value;
    return (
      value.state === 'off' || (typeof attrs.brightness === 'number' && attrs.brightness <= 12)
    );
  });
}

export function scenePresentation(scene: HassEntity, room?: string, entry?: EntityRegistryEntry) {
  const raw = String(
    scene.attributes.friendly_name ?? scene.entity_id.split('.')[1].replaceAll('_', ' '),
  );
  const hue = /\(\s*hue\s*\)/i.test(raw) || entry?.platform?.toLowerCase() === 'hue';
  const name =
    raw
      .replace(/\(\s*hue\s*\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Scene';
  const title =
    room && name.toLowerCase().startsWith(room.toLowerCase() + ' ')
      ? name.slice(room.length + 1)
      : name;
  return { name, title, source: hue ? 'Hue' : undefined };
}

/** Keep each room together, then sort visible titles without prefixes or source badges. */
export function sortScenesByName(
  scenes: HassEntity[],
  roomForScene: (scene: HassEntity) => string | undefined = () => undefined,
) {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return [...scenes].sort((a, b) => {
    const roomA = roomForScene(a);
    const roomB = roomForScene(b);
    return (
      collator.compare(roomA ?? 'Whole home', roomB ?? 'Whole home') ||
      collator.compare(scenePresentation(a, roomA).title, scenePresentation(b, roomB).title) ||
      a.entity_id.localeCompare(b.entity_id)
    );
  });
}

/** Home visibility is independent of library visibility; hiding in Haus takes precedence. */
export function sceneViews(
  scenes: HassEntity[],
  hiddenApp: ReadonlySet<string>,
  hiddenHome: ReadonlySet<string>,
) {
  const visible = scenes.filter((scene) => !hiddenApp.has(scene.entity_id));
  return {
    visible,
    home: visible.filter((scene) => !hiddenHome.has(scene.entity_id)),
    hidden: scenes.filter((scene) => hiddenApp.has(scene.entity_id)),
  };
}
