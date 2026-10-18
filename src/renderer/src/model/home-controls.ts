import type { HausAccessory } from './types';

/** Rank whole devices, including use of their secondary controls, without splitting them into tiles. */
export function homeControls(
  accessories: HausAccessory[],
  favorites: readonly string[],
  usage: Readonly<Record<string, { count: number; lastUsed: number }>>,
) {
  const eligible = accessories.filter(
    (item) =>
      !['sensor', 'binary_sensor', 'automation', 'camera'].includes(
        item.primaryEntityId.split('.')[0],
      ),
  );
  const ranked = eligible.map((accessory) => {
    const history = [...new Set(accessory.entityIds)].map((id) => usage[id]);
    return {
      accessory,
      count: history.reduce((sum, item) => sum + (item?.count ?? 0), 0),
      lastUsed: Math.max(0, ...history.map((item) => item?.lastUsed ?? 0)),
    };
  });
  const mostUsed = ranked
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, 4)
    .map((item) => item.accessory);
  const pinned = eligible.filter((item) => item.entityIds.some((id) => favorites.includes(id)));
  return {
    controls: mostUsed.length ? mostUsed : pinned,
    usingFavorites: !mostUsed.length && pinned.length > 0,
  };
}

/** Preserve the current visit's selection; usage can fill vacancies, never replace a visible tile. */
export function stableQuickControls(
  previous: readonly string[],
  ranked: HausAccessory[],
  eligible: HausAccessory[],
) {
  const byId = new Map(eligible.map((item) => [item.id, item]));
  const ids = [
    ...new Set([...previous.filter((id) => byId.has(id)), ...ranked.map((item) => item.id)]),
  ].slice(0, 4);
  return ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
}
