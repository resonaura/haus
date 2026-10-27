import type { Snapshot } from './types';

export interface SourceHealth {
  id: string;
  available: boolean;
  expiresAt: number;
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
