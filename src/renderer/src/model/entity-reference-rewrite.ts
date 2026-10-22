export type ReferenceHit = { path: string; value: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function referencePattern(entityId: string) {
  if (!/^[a-z_]+[.][a-z0-9_]+$/.test(entityId))
    throw new Error('Invalid Home Assistant entity ID.');
  const escaped = entityId.replaceAll('.', '[.]');
  return new RegExp(`(?<![a-zA-Z0-9_])${escaped}(?![a-zA-Z0-9_])`, 'g');
}

export function entityReferenceHits(value: unknown, entityId: string): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const matches = (text: string) => referencePattern(entityId).test(text);
  const visit = (item: unknown, path: string) => {
    if (typeof item === 'string' && matches(item)) hits.push({ path, value: item });
    else if (Array.isArray(item)) item.forEach((child, index) => visit(child, `${path}[${index}]`));
    else if (isObject(item))
      for (const [key, child] of Object.entries(item)) {
        if (key === entityId) hits.push({ path: `${path}[${JSON.stringify(key)}]`, value: key });
        visit(child, path ? `${path}.${key}` : key);
      }
  };
  visit(value, '$');
  return hits;
}

export function rewriteEntityReferences<T>(value: T, oldId: string, newId: string): T {
  if (typeof value === 'string') return value.replace(referencePattern(oldId), () => newId) as T;
  if (Array.isArray(value))
    return value.map((child) => rewriteEntityReferences(child, oldId, newId)) as T;
  if (isObject(value)) {
    if (oldId !== newId && Object.hasOwn(value, oldId) && Object.hasOwn(value, newId))
      throw new Error(
        `Both ${oldId} and ${newId} exist in this config. Resolve their settings before migrating.`,
      );
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key === oldId ? newId : key,
        rewriteEntityReferences(child, oldId, newId),
      ]),
    ) as T;
  }
  return value;
}
