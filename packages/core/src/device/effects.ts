/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Semantic icon token resolved by each UI platform (Desktop Lucide, Mobile icons, etc.). */
export type LightEffectIcon =
  | 'off'
  | 'flame'
  | 'sparkles'
  | 'rainbow'
  | 'waves'
  | 'sunset'
  | 'sunrise'
  | 'moon'
  | 'sun'
  | 'star'
  | 'snowflake'
  | 'cloud-lightning'
  | 'cloud-rain'
  | 'trees'
  | 'heart'
  | 'music'
  | 'party'
  | 'zap'
  | 'activity'
  | 'orbit'
  | 'eye'
  | 'film'
  | 'gamepad'
  | 'wand';

/** Unified ambient lighting animation family rendered on tiles and light controllers. */
export type LightEffectMotion =
  'none' | 'flicker' | 'pulse' | 'rainbow' | 'aurora' | 'wave' | 'sparkle' | 'beat';

export interface LightEffectVisual {
  readonly id: string;
  readonly icon: LightEffectIcon;
  readonly motion: LightEffectMotion;
  readonly palette: readonly [string, string, string];
  readonly isStatic: boolean;
}

export interface LightEffectOption extends LightEffectVisual {
  /** Exact raw effect string sent to the device/HA service call. */
  readonly value: string;
  /** Human-readable display label. */
  readonly label: string;
}

const STATIC_EFFECT_PRIORITY = [
  'off',
  'none',
  'no effect',
  'solid',
  'static',
  'normal',
  'default',
  'custom',
  'manual',
  'fixed',
  'clear',
  'stop',
  'disable',
  'disabled',
] as const;

const STATIC_EFFECT_SET: ReadonlySet<string> = new Set(STATIC_EFFECT_PRIORITY);

const PRESERVE_ACRONYMS = new Set(['rgb', 'rgbw', 'rgbww', 'tv', 'sos', 'uv', 'led', 'bpm', 'dj']);

interface EffectArchetype {
  readonly id: string;
  readonly pattern: RegExp;
  readonly icon: LightEffectIcon;
  readonly motion: LightEffectMotion;
  readonly palette: readonly [string, string, string];
}

const EFFECT_ARCHETYPES: readonly EffectArchetype[] = [
  {
    id: 'candle',
    pattern: /(?:^|[^a-zа-яё])(candle|candlelight|свеч)/i,
    icon: 'flame',
    motion: 'flicker',
    palette: ['#ff9d3b', '#ff6e1a', '#ffd080'],
  },
  {
    id: 'fire',
    pattern:
      /(?:^|[^a-zа-яё])(fire(?:place|pit|light)?(?![a-zа-яё])|flame|hearth|lava|ember|magma|bonfire|campfire|inferno|volcano|огон|огн|камин|плам)/i,
    icon: 'flame',
    motion: 'flicker',
    palette: ['#ff5722', '#ff9800', '#ff2a00'],
  },
  {
    id: 'aurora',
    pattern: /(?:^|[^a-zа-яё])(aurora|borealis|northern|сияни)/i,
    icon: 'sparkles',
    motion: 'aurora',
    palette: ['#2ce6a8', '#38b6ff', '#8b5cf6'],
  },
  {
    id: 'cosmos',
    pattern: /(?:^|[^a-zа-яё])(cosmos|galaxy|nebula|universe|space|astronaut|космос)/i,
    icon: 'orbit',
    motion: 'aurora',
    palette: ['#6366f1', '#a855f7', '#38bdf8'],
  },
  {
    id: 'rainbow',
    pattern:
      /(?:^|[^a-zа-яё])(rainbow|prism|spectrum|color\s*loop|colorloop|color\s*cycle|hue\s*shift|pride|multicolor|радуг)/i,
    icon: 'rainbow',
    motion: 'rainbow',
    palette: ['#ff5e7e', '#ffbe3b', '#38bdf8'],
  },
  {
    id: 'storm',
    pattern: /(?:^|[^a-zа-яё])(thunder|lightning|storm|tempest|гроз|молни)/i,
    icon: 'cloud-lightning',
    motion: 'beat',
    palette: ['#7dd3fc', '#c4b5fd', '#e0f2fe'],
  },
  {
    id: 'rain',
    pattern: /(?:^|[^a-zа-яё])(rain|drizzle|shower|дожд)/i,
    icon: 'cloud-rain',
    motion: 'wave',
    palette: ['#38bdf8', '#60a5fa', '#818cf8'],
  },
  {
    id: 'ocean',
    pattern:
      /(?:^|[^a-zа-яё])(ocean|underwater|water|waves?(?![a-zа-яё])|sea(?![a-zа-яё])|lagoon|aqua|ripple|flow(?:ing)?(?![a-zа-яё])|river|stream|surf|tide(?![a-zа-яё])|океан|волн|вод)/i,
    icon: 'waves',
    motion: 'wave',
    palette: ['#0ea5e9', '#14b8a6', '#38bdf8'],
  },
  {
    id: 'sunrise',
    pattern: /(?:^|[^a-zа-яё])(sunrise|dawn|morning|wake|рассвет)/i,
    icon: 'sunrise',
    motion: 'pulse',
    palette: ['#ff9a56', '#ffd166', '#ff6b6b'],
  },
  {
    id: 'sunset',
    pattern: /(?:^|[^a-zа-яё])(sunset|dusk|twilight|sundown|evening|закат)/i,
    icon: 'sunset',
    motion: 'pulse',
    palette: ['#ff6b4a', '#e85d9e', '#ffb347'],
  },
  {
    id: 'snow',
    pattern:
      /(?:^|[^a-zа-яё])(snow|winter|frost|ice(?![a-zа-яё])|icy(?![a-zа-яё])|glacier|blizzard|arctic|снег|зим)/i,
    icon: 'snowflake',
    motion: 'sparkle',
    palette: ['#bae6fd', '#e0f2fe', '#93c5fd'],
  },
  {
    id: 'forest',
    pattern:
      /(?:^|[^a-zа-яё])(forest|jungle|nature|spring|meadow|foliage|leaf|leaves|tropical|garden|лес|природ)/i,
    icon: 'trees',
    motion: 'pulse',
    palette: ['#22c55e', '#84cc16', '#10b981'],
  },
  {
    id: 'party',
    pattern:
      /(?:^|[^a-zа-яё])(party|disco|club|rave|carnival|festival|firework|celebrat|christmas|halloween|вечерин|диско|салют)/i,
    icon: 'party',
    motion: 'beat',
    palette: ['#ec4899', '#8b5cf6', '#06b6d4'],
  },
  {
    id: 'music',
    pattern:
      /(?:^|[^a-zа-яё])(music|rhythm|sound|beat(?![a-zа-яё])|dance|audio|dj(?![a-zа-яё])|музык|ритм)/i,
    icon: 'music',
    motion: 'beat',
    palette: ['#a855f7', '#ec4899', '#38bdf8'],
  },
  {
    id: 'strobe',
    pattern:
      /(?:^|[^a-zа-яё])(strobe|flash|police|alarm|emergency|alert|sos(?![a-zа-яё])|siren|blink|вспышк|строб)/i,
    icon: 'zap',
    motion: 'beat',
    palette: ['#f43f5e', '#3b82f6', '#fbbf24'],
  },
  {
    id: 'romance',
    pattern:
      /(?:^|[^a-zа-яё])(heart|romanc|love|valentine|rose|blossom|sakura|peach|сердц|романт)/i,
    icon: 'heart',
    motion: 'pulse',
    palette: ['#fb7185', '#f472b6', '#fda4af'],
  },
  {
    id: 'night',
    pattern: /(?:^|[^a-zа-яё])(night|moon|sleep|bedtime|lullaby|midnight|ноч|лун|сон)/i,
    icon: 'moon',
    motion: 'pulse',
    palette: ['#6366f1', '#4f46e5', '#93c5fd'],
  },
  {
    id: 'sparkle',
    pattern:
      /(?:^|[^a-zа-яё])(star|twinkl|sparkl|glisten|glitter|fairy|firefl|opal|shimmer|enchant|magic|звезд|искр|мерц)/i,
    icon: 'star',
    motion: 'sparkle',
    palette: ['#fde68a', '#f9a8d4', '#93c5fd'],
  },
  {
    id: 'sun',
    pattern: /(?:^|[^a-zа-яё])(sunbeam|sunny|sunlight|solar|daylight|summer|golden|солнц)/i,
    icon: 'sun',
    motion: 'pulse',
    palette: ['#fbbf24', '#fcd34d', '#fb923c'],
  },
  {
    id: 'breathe',
    pattern:
      /(?:^|[^a-zа-яё])(breath|pulse|fade|smooth|relax|calm|zen|meditat|cozy|warm|дыхан|пульс)/i,
    icon: 'activity',
    motion: 'pulse',
    palette: ['#f59e0b', '#fbbf24', '#f97316'],
  },
  {
    id: 'cinema',
    pattern: /(?:^|[^a-zа-яё])(movie|cinema|theater|theatre|ambilight|tv(?![a-zа-яё])|кино)/i,
    icon: 'film',
    motion: 'aurora',
    palette: ['#60a5fa', '#818cf8', '#c084fc'],
  },
  {
    id: 'gaming',
    pattern: /(?:^|[^a-zа-яё])(game|gaming|cyber|neon|synth|игр|неон)/i,
    icon: 'gamepad',
    motion: 'aurora',
    palette: ['#06b6d4', '#d946ef', '#8b5cf6'],
  },
  {
    id: 'focus',
    pattern:
      /(?:^|[^a-zа-яё])(read(?:ing)?(?![a-zа-яё])|focus|concentrat|study|work(?![a-zа-яё])|energiz|чтен)/i,
    icon: 'eye',
    motion: 'pulse',
    palette: ['#fde68a', '#e0f2fe', '#fef3c7'],
  },
  {
    id: 'chase',
    pattern:
      /(?:^|[^a-zа-яё])(cycle|chase|sweep|scanner|meteor|comet|wipe|running|marquee|orbit|spin|circus|juggle|sinelon)/i,
    icon: 'orbit',
    motion: 'wave',
    palette: ['#38bdf8', '#a78bfa', '#f472b6'],
  },
];

const STATIC_VISUAL: LightEffectVisual = {
  id: 'off',
  icon: 'off',
  motion: 'none',
  palette: ['#9ca3af', '#9ca3af', '#9ca3af'],
  isStatic: true,
};

const FALLBACK_VISUAL: LightEffectVisual = {
  id: 'effect',
  icon: 'wand',
  motion: 'pulse',
  palette: ['#a78bfa', '#60a5fa', '#f472b6'],
  isStatic: false,
};

function normalizeEffectKey(name: string): string {
  return name
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** True when a light effect value represents static/disabled output rather than an active effect. */
export function isStaticLightEffect(effect: unknown): boolean {
  if (typeof effect !== 'string') return true;
  const normalized = normalizeEffectKey(effect);
  return !normalized || STATIC_EFFECT_SET.has(normalized);
}

/** True when a light effect value represents a live dynamic effect. */
export function isActiveLightEffect(effect: unknown): effect is string {
  return typeof effect === 'string' && !isStaticLightEffect(effect);
}

/** Returns the active effect string only when the light is on (if state is provided) and non-static. */
export function normalizeActiveLightEffect(
  effect: unknown,
  lightState?: string,
): string | undefined {
  if (lightState !== undefined && lightState !== 'on') return undefined;
  if (!isActiveLightEffect(effect)) return undefined;
  return effect.trim();
}

/** Formats raw provider effect IDs (e.g. `color_loop`, `candle`, `TV Sync`) into clean labels. */
export function formatLightEffectLabel(raw: string): string {
  const spaced = raw
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!spaced) return raw;
  return spaced
    .split(' ')
    .map((word) => {
      const lower = word.toLocaleLowerCase();
      if (PRESERVE_ACRONYMS.has(lower)) return lower.toUpperCase();
      if (word !== lower && word !== word.toUpperCase()) return word;
      return `${word.charAt(0).toLocaleUpperCase()}${lower.slice(1)}`;
    })
    .join(' ');
}

/** Classifies any provider effect name into its unified icon, animation motion, and palette. */
export function describeLightEffect(effect: string): LightEffectVisual {
  if (isStaticLightEffect(effect)) return STATIC_VISUAL;
  const normalized = normalizeEffectKey(effect);
  for (const archetype of EFFECT_ARCHETYPES) {
    if (archetype.pattern.test(normalized)) {
      return {
        id: archetype.id,
        icon: archetype.icon,
        motion: archetype.motion,
        palette: archetype.palette,
        isStatic: false,
      };
    }
  }
  return FALLBACK_VISUAL;
}

/** Builds deduplicated, classified effect options preserving the device's advertised ordering. */
export function buildLightEffectOptions(
  effectList: readonly string[] | undefined,
): LightEffectOption[] {
  if (!effectList?.length) return [];
  const seen = new Set<string>();
  const options: LightEffectOption[] = [];
  for (const raw of effectList) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(raw)) continue;
    seen.add(raw);
    const visual = describeLightEffect(raw);
    options.push({
      ...visual,
      value: raw,
      label: formatLightEffectLabel(raw),
    });
  }
  return options;
}

/** Finds the device's native disable/static effect value (e.g. 'off', 'none', 'Solid', 'Custom'). */
export function findDisableEffectOption(
  effectList: readonly string[] | undefined,
): string | undefined {
  if (!effectList?.length) return undefined;
  let best: { value: string; rank: number } | undefined;
  for (const raw of effectList) {
    if (typeof raw !== 'string') continue;
    const rank = STATIC_EFFECT_PRIORITY.indexOf(
      normalizeEffectKey(raw) as (typeof STATIC_EFFECT_PRIORITY)[number],
    );
    if (rank !== -1 && (!best || rank < best.rank)) {
      best = { value: raw, rank };
    }
  }
  return best?.value;
}
