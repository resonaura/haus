/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface ScenePresetPalette {
  readonly colors: string[];
  readonly dark?: boolean;
}

const STOCK_SCENE_PALETTES: ReadonlyArray<{
  readonly match: RegExp;
  readonly colors: readonly string[];
  readonly dark?: boolean;
}> = [
  { match: /\barctic\s*aurora\b/i, colors: ['#00d2ff', '#2ce69b', '#6b5bff', '#1f8fff'] },
  { match: /\btropical\s*twilight\b/i, colors: ['#ff6b4a', '#c94bff', '#5b6dff', '#ffb347'] },
  { match: /\bsavanna\s*sunset\b/i, colors: ['#ff5e3a', '#ff9500', '#ffcc4d', '#e84362'] },
  { match: /\bspring\s*blossom\b/i, colors: ['#ff8fb8', '#d88cff', '#ffe0a3', '#ffb3c6'] },
  { match: /\btokyo\b/i, colors: ['#ff2e93', '#7a3cff', '#00d4ff', '#ff6b35'] },
  { match: /\bgalaxy\b|\bnebula\b/i, colors: ['#6c3bff', '#c83cff', '#2b7fff', '#ff4fa3'] },
  { match: /\bmiami\b|\bpalm\s*beach\b/i, colors: ['#ff4da6', '#00d9c0', '#ff8c42', '#8c52ff'] },
  { match: /\bcancun\b|\brio\b|\bibiza\b/i, colors: ['#ff3b6b', '#ffb800', '#00cfa8', '#ff6f3c'] },
  { match: /\bchinatown\b/i, colors: ['#ff2e3b', '#ff9e2c', '#ffd15c'] },
  { match: /\bhonolulu\b|\bsunset\b/i, colors: ['#ff6238', '#ff9a3c', '#ffd06b', '#d94862'] },
  { match: /\bosaka\b|\bkyoto\b|\bsoho\b/i, colors: ['#ff7eb6', '#9b6bff', '#ffc285'] },
  { match: /\blake\s*placid\b|\bmountain\s*breeze\b|\blake\s*mist\b/i, colors: ['#5cb8ff', '#8be0ff', '#a8c7ff'] },
  { match: /\bocean\s*dawn\b|\bfrosty\s*dawn\b|\bsunrise\b|\bwake/i, colors: ['#ffad66', '#ffd996', '#7ec8ff'] },
  { match: /\bemerald\s*isle\b|\bforest\b/i, colors: ['#22c55e', '#10b981', '#84cc16'] },
  { match: /\bamber\s*bloom\b|\bgolden\s*pond\b|\bautumn\s*gold\b/i, colors: ['#ff9429', '#ffb84d', '#e66c2c'] },
  { match: /\bpainted\s*sky\b/i, colors: ['#ff6e7f', '#bfe9ff', '#c471ed'] },
  { match: /\bwinter\s*beauty\b/i, colors: ['#8ec5fc', '#e0c3fc', '#ffd6a5'] },
  { match: /\bnetflix\b|\bmovie\b|\bcinema\b/i, colors: ['#e50914', '#b81d24', '#ff5a36'] },
  { match: /\bfireplace\b|\bcandle\b|\bcozy\b|\bvintage\b/i, colors: ['#ff7b29', '#ffa647', '#ff5722'] },
  { match: /\bparty\b|\bdisco\b/i, colors: ['#ff2e93', '#00e5ff', '#ffbe0b', '#8338ec'] },
  { match: /\bromance\b|\blove\b/i, colors: ['#ff3d7f', '#ff758f', '#c9184a'] },
  { match: /\benergize\b/i, colors: ['#cde8ff', '#dcf0ff'] },
  { match: /\bconcentrate\b/i, colors: ['#e6f2ff', '#f2f7ff'] },
  { match: /\bread\b/i, colors: ['#ffd699', '#ffe1b3'] },
  { match: /\brelax\b|\brest\b/i, colors: ['#ffad5c', '#ffc078'] },
  { match: /\bbright\b|\bdaylight\b/i, colors: ['#ffe4b5', '#ffedd1'] },
  { match: /\bdimmed\b/i, colors: ['#ffb969', '#e89b48'] },
  { match: /\bnight\s*light\b|\bgood\s*night\b|\bbedtime\b/i, colors: ['#ff8a3d', '#b85d28'], dark: true },
  { match: /\boff\b|\ball\s*off\b/i, colors: [], dark: true },
];

const AMBIENT_FALLBACK_SETS: ReadonlyArray<readonly string[]> = [
  ['#ffad5c', '#ffd28a', '#ff8547'],
  ['#ff7eb6', '#9b6bff', '#5cb8ff'],
  ['#00d2ff', '#3be8b0', '#6b66ff'],
  ['#ff6b4a', '#ffb347', '#e84362'],
];

export function resolveNamedScenePalette(
  title: string,
  entityId: string,
  isHueScene: boolean,
): ScenePresetPalette | undefined {
  for (const preset of STOCK_SCENE_PALETTES) {
    if (preset.match.test(title) || preset.match.test(entityId)) {
      if (isHueScene || preset.colors.length > 1 || preset.dark) {
        return { colors: [...preset.colors], dark: preset.dark };
      }
    }
  }
  if (!isHueScene) return undefined;
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return { colors: [...AMBIENT_FALLBACK_SETS[hash % AMBIENT_FALLBACK_SETS.length]!] };
}
