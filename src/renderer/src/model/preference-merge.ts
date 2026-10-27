const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sets = new Set([
  'favorites',
  'hiddenApp',
  'hiddenHome',
  'unhiddenApp',
  'disabledLightGroups',
]);

/** Replay local intent against fresh remote state, preserving unrelated changes inside a field. */
export function mergePreference(
  key: string,
  before: unknown,
  after: unknown,
  remote: unknown,
): unknown {
  if (equal(before, after)) return remote;
  if (sets.has(key) && Array.isArray(before) && Array.isArray(after) && Array.isArray(remote)) {
    const removed = new Set(before.filter((id) => !after.includes(id)));
    return [
      ...new Set([
        ...remote.filter((id) => !removed.has(id)),
        ...after.filter((id) => !before.includes(id)),
      ]),
    ];
  }
  if (record(before) && record(after) && record(remote)) {
    const merged = { ...remote };
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (
        ['__proto__', 'constructor', 'prototype'].includes(name) ||
        equal(before[name], after[name])
      )
        continue;
      if (!(name in after)) delete merged[name];
      else merged[name] = mergePreference('', before[name], after[name], remote[name]);
    }
    return merged;
  }
  return after;
}
