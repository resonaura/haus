export type Departure = { id: string; phase: 'present' | 'holding' | 'leaving'; until: number };
export const departureDuration = 420;

/** Per-visit presentation only: fresh reactivation cancels either stage, never extends an Off hold. */
export function reconcileDepartures(
  previous: Departure[],
  active: string[],
  available: string[],
  now: number,
): Departure[] {
  const on = new Set(active),
    retained = new Set(available);
  const next: Departure[] = previous.flatMap((entry): Departure[] => {
    if (on.delete(entry.id)) return [{ id: entry.id, phase: 'present', until: Infinity }];
    if (entry.phase === 'present')
      return [
        {
          ...entry,
          phase: retained.has(entry.id) ? 'holding' : 'leaving',
          until: now + (retained.has(entry.id) ? 850 : departureDuration),
        },
      ];
    if (entry.until > now) return [entry];
    return entry.phase === 'holding'
      ? [{ ...entry, phase: 'leaving', until: now + departureDuration }]
      : [];
  });
  return [
    ...next,
    ...Array.from(on, (id): Departure => ({ id, phase: 'present', until: Infinity })),
  ];
}
