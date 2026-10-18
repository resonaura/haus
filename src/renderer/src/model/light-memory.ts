import type { HassEntity } from './types';
import { lightProfile } from './light-profile';
import { lightColor } from './light-color';

export type LightMemory = Record<
  string,
  { attributes: Record<string, unknown>; updatedAt: number }
>;
export type HomeLightMemories = Record<string, LightMemory>;

/** Output only: never persist unrelated attributes, credentials or diagnostic payloads. */
function outputAttributes(value: Record<string, any>) {
  const result: Record<string, unknown> = {};
  for (const key of ['brightness', 'color_temp', 'color_temp_kelvin']) {
    const number = value[key];
    if (
      typeof number === 'number' &&
      Number.isFinite(number) &&
      number > 0 &&
      (key !== 'brightness' || number <= 255)
    )
      result[key] = number;
  }
  for (const [key, length] of [
    ['rgb_color', 3],
    ['hs_color', 2],
    ['xy_color', 2],
  ] as const) {
    const channels = value[key];
    if (
      Array.isArray(channels) &&
      channels.length >= length &&
      channels
        .slice(0, length)
        .every((channel) => typeof channel === 'number' && Number.isFinite(channel))
    )
      result[key] = channels.slice(0, length);
  }
  if (
    ['rgb', 'rgbw', 'rgbww', 'hs', 'xy', 'color_temp', 'brightness', 'white', 'onoff'].includes(
      value.color_mode,
    )
  )
    result.color_mode = value.color_mode;
  return result;
}

export function sanitizeLightMemory(value: unknown): LightMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([id, raw]) => {
        if (
          !/^light\.[a-z0-9_]+$/.test(id) ||
          !raw ||
          typeof raw !== 'object' ||
          Array.isArray(raw)
        )
          return [];
        const entry = raw as LightMemory[string];
        if (
          !Number.isFinite(entry.updatedAt) ||
          entry.updatedAt <= 0 ||
          !entry.attributes ||
          typeof entry.attributes !== 'object'
        )
          return [];
        const attributes = outputAttributes(entry.attributes);
        return Object.keys(attributes).length
          ? [[id, { attributes, updatedAt: entry.updatedAt }]]
          : [];
      })
      .sort(
        (a, b) => (b[1] as LightMemory[string]).updatedAt - (a[1] as LightMemory[string]).updatedAt,
      )
      .slice(0, 96),
  );
}

export function sanitizeHomeLightMemories(value: unknown): HomeLightMemories {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .flatMap(([home, memory]) =>
      Object.entries(sanitizeLightMemory(memory)).map(([id, entry]) => ({ home, id, entry })),
    )
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, 96);
  const result: HomeLightMemories = {};
  for (const { home, id, entry } of entries) (result[home] ??= {})[id] = entry;
  return result;
}

export class LightOutputMemory {
  private scope = '';
  private entries: LightMemory = {};
  private revision = 0;

  hydrate(scope: string, input: unknown) {
    if (scope !== this.scope) {
      this.scope = scope;
      this.entries = {};
      ++this.revision;
    }
    for (const [id, entry] of Object.entries(sanitizeLightMemory(input))) {
      if (!this.entries[id] || entry.updatedAt > this.entries[id].updatedAt) {
        this.entries[id] = entry;
        ++this.revision;
      }
    }
  }

  remember(entity: HassEntity) {
    if (!entity.entity_id.startsWith('light.') || entity.state !== 'on') return;
    const attributes = outputAttributes(entity.attributes);
    if (!Object.keys(attributes).some((key) => key !== 'color_mode')) return;
    const updatedAt = Date.parse(entity.last_updated ?? entity.last_changed) || Date.now();
    const existing = this.entries[entity.entity_id];
    const combined = { ...existing?.attributes, ...attributes };
    if (
      existing &&
      (existing.updatedAt > updatedAt ||
        JSON.stringify(existing.attributes) === JSON.stringify(combined))
    )
      return;
    this.entries[entity.entity_id] = { attributes: combined, updatedAt };
    ++this.revision;
  }

  restore(entity: HassEntity) {
    const result = {
      ...this.entries[entity.entity_id]?.attributes,
      ...outputAttributes(entity.attributes),
    };
    const profile = lightProfile(entity);
    if (!profile.brightness) delete result.brightness;
    if (!profile.color) for (const key of ['rgb_color', 'hs_color', 'xy_color']) delete result[key];
    if (!profile.temperature)
      for (const key of ['color_temp', 'color_temp_kelvin']) delete result[key];
    if (!profile.color && !profile.temperature) delete result.color_mode;
    return result;
  }

  needsHistory(entity: HassEntity) {
    if (!entity.entity_id.startsWith('light.') || entity.state === 'on') return false;
    const profile = lightProfile(entity);
    const restored = {
      ...entity,
      state: 'on',
      attributes: { ...entity.attributes, ...this.restore(entity) },
    };
    return (
      (profile.brightness && !restored.attributes.brightness) ||
      ((profile.color || profile.temperature) && !lightColor(restored))
    );
  }

  /** Partial on-reports should not briefly erase a previously confirmed output. */
  complete(entity: HassEntity): HassEntity {
    if (!entity.entity_id.startsWith('light.') || entity.state !== 'on') return entity;
    const fallback = this.restore(entity);
    const attributes = { ...entity.attributes };
    let changed = false;
    const hasReportedColor = Boolean(lightColor(entity));
    for (const [key, value] of Object.entries(fallback)) {
      if (attributes[key] != null || (key !== 'brightness' && hasReportedColor)) continue;
      attributes[key] = value;
      changed = true;
    }
    return changed ? { ...entity, attributes } : entity;
  }

  export(): LightMemory {
    return sanitizeLightMemory(this.entries);
  }
  get version() {
    return this.revision;
  }
}
