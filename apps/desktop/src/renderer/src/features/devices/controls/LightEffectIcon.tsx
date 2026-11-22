/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { CSSProperties } from 'react';
import {
  Activity,
  CircleOff,
  CloudLightning,
  CloudRain,
  Eye,
  Film,
  Flame,
  Gamepad2,
  Heart,
  Moon,
  Music,
  Orbit,
  PartyPopper,
  Rainbow,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Trees,
  WandSparkles,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { deviceSurfaceVars } from '../../../model/device-appearance';
import type {
  LightEffectIcon as LightEffectIconName,
  LightEffectOption,
} from '../../../model/light-profile';

/** Casts pure CSS custom properties from `deviceSurfaceVars` for React `style` props. */
export function deviceSurfaceStyle(
  accent: string,
  effect?: LightEffectOption,
  includeAccent = false,
): CSSProperties {
  return deviceSurfaceVars(accent, effect, includeAccent) as CSSProperties;
}

const EFFECT_ICONS: Readonly<Record<LightEffectIconName, LucideIcon>> = {
  off: CircleOff,
  flame: Flame,
  sparkles: Sparkles,
  rainbow: Rainbow,
  waves: Waves,
  sunset: Sunset,
  sunrise: Sunrise,
  moon: Moon,
  sun: Sun,
  star: Star,
  snowflake: Snowflake,
  'cloud-lightning': CloudLightning,
  'cloud-rain': CloudRain,
  trees: Trees,
  heart: Heart,
  music: Music,
  party: PartyPopper,
  zap: Zap,
  activity: Activity,
  orbit: Orbit,
  eye: Eye,
  film: Film,
  gamepad: Gamepad2,
  wand: WandSparkles,
};

export function LightEffectIcon({
  icon,
  size = 14,
  strokeWidth = 1.85,
  className,
}: {
  icon: LightEffectIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const Icon = EFFECT_ICONS[icon] ?? WandSparkles;
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
