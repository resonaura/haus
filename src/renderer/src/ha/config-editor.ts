import type { HausNative } from '../../../shared/native';
export type EditableKind = 'scene' | 'automation';
export type EditableConfig = Record<string, any>;
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const configPath = (kind: EditableKind, id: string) => {
  if (!/^[a-z0-9_-]{1,128}$/i.test(id))
    throw new Error('This item is not stored in an editable Home Assistant file.');
  return `config/${kind}/config/${id}`;
};
export const readConfig = (api: Pick<HausNative, 'management'>, kind: EditableKind, id: string) =>
  api.management<EditableConfig>({ method: 'GET', path: configPath(kind, id) });
export async function saveConfig(
  api: Pick<HausNative, 'management'>,
  kind: EditableKind,
  id: string,
  config: EditableConfig,
  original?: EditableConfig,
) {
  if (typeof config[kind === 'scene' ? 'name' : 'alias'] !== 'string')
    throw new Error('Give this item a name.');
  const name = String(kind === 'scene' ? config.name : config.alias).trim();
  if (!name) throw new Error('Give this item a name.');
  if (
    kind === 'scene' &&
    (!config.entities ||
      typeof config.entities !== 'object' ||
      Array.isArray(config.entities) ||
      !Object.keys(config.entities).length)
  )
    throw new Error('Add at least one accessory to the scene.');
  if (
    kind === 'automation' &&
    !config.use_blueprint &&
    [config.triggers ?? config.trigger, config.actions ?? config.action].some(
      (value) => value === undefined || value === null || (Array.isArray(value) && !value.length),
    )
  )
    throw new Error('Add a trigger and an action.');
  if (original) {
    const current = await readConfig(api, kind, id);
    if (canonical(current) !== canonical(original))
      throw new Error(
        'This configuration changed in Home Assistant. Close and reopen it before saving so those changes are preserved.',
      );
  }
  await api.management({
    method: 'POST',
    path: configPath(kind, id),
    data: { ...config, [kind === 'scene' ? 'name' : 'alias']: name },
  });
}
