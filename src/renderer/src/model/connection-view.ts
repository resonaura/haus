import type { Snapshot } from './types';

export interface SourceHealth {
  id: string;
  available: boolean;
  expiresAt: number;
}
/** Independent observers retain their original expiry; one disconnected channel cannot erase another's fresh proof. */
export function mergeSourceHealth(groups: readonly SourceHealth[][], now: number): SourceHealth[] {
  const sources = new Map<string, SourceHealth>();
  for (const group of groups)
    for (const source of group) {
      if (!source.available || source.expiresAt <= now) continue;
      if ((sources.get(source.id)?.expiresAt ?? 0) < source.expiresAt)
        sources.set(source.id, source);
    }
  return [...sources.values()];
}
/** Availability is a view of current dependencies, never a rewrite of HA's retained state. */
export function connectionView(
  snapshot: Snapshot,
  connected: boolean,
  sources: readonly SourceHealth[],
  aliases: readonly { id: string; aliases?: string[] }[],
  now: number,
): Snapshot {
  if (connected) return snapshot;
  const independent = new Set(
    sources
      .filter((source) => source.available && source.expiresAt > now)
      .flatMap((source) => [
        source.id,
        ...(aliases.find((camera) => camera.id === source.id)?.aliases ?? []),
      ]),
  );
  return {
    ...snapshot,
    states: snapshot.states.map((state) => {
      if (state.entity_id.startsWith('camera.') && state.state === 'off') return state;
      return {
        ...state,
        state:
          independent.has(state.entity_id) && state.entity_id.startsWith('camera.')
            ? 'idle'
            : 'unavailable',
      };
    }),
  };
}
