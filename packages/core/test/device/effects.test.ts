/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  buildLightEffectOptions,
  describeLightEffect,
  findDisableEffectOption,
  formatLightEffectLabel,
  isActiveLightEffect,
  isStaticLightEffect,
  normalizeActiveLightEffect,
} from '../../src/device/effects.js';

describe('centralized light effects', () => {
  it('distinguishes static/disabled effect values from active dynamic effects', () => {
    for (const value of [
      'off',
      'OFF',
      'none',
      'Solid',
      'static',
      'Custom',
      'no_effect',
      '',
      null,
      undefined,
    ]) {
      expect(isStaticLightEffect(value)).toBe(true);
      expect(isActiveLightEffect(value)).toBe(false);
    }
    expect(isActiveLightEffect('candle')).toBe(true);
    expect(isActiveLightEffect('Fire')).toBe(true);
    expect(isActiveLightEffect('Northern Lights')).toBe(true);

    expect(normalizeActiveLightEffect('fire', 'on')).toBe('fire');
    expect(normalizeActiveLightEffect('fire', 'off')).toBeUndefined();
    expect(normalizeActiveLightEffect('fire', 'unavailable')).toBeUndefined();
    expect(normalizeActiveLightEffect('none', 'on')).toBeUndefined();
  });

  it.each([
    ['fire', 'flame', 'flicker'],
    ['fireplace', 'flame', 'flicker'],
    ['candle', 'flame', 'flicker'],
    ['Камин', 'flame', 'flicker'],
    ['aurora', 'sparkles', 'aurora'],
    ['Northern Lights', 'sparkles', 'aurora'],
    ['cosmos', 'orbit', 'aurora'],
    ['prism', 'rainbow', 'rainbow'],
    ['color_loop', 'rainbow', 'rainbow'],
    ['Rainbow', 'rainbow', 'rainbow'],
    ['underwater', 'waves', 'wave'],
    ['Flowing', 'waves', 'wave'],
    ['Ocean Wave', 'waves', 'wave'],
    ['thunderstorm', 'cloud-lightning', 'beat'],
    ['Rain', 'cloud-rain', 'wave'],
    ['Sunrise', 'sunrise', 'pulse'],
    ['Sunset', 'sunset', 'pulse'],
    ['Snowfall', 'snowflake', 'sparkle'],
    ['Forest', 'trees', 'pulse'],
    ['Fireworks', 'party', 'beat'],
    ['Party', 'party', 'beat'],
    ['Music Rhythm', 'music', 'beat'],
    ['Police', 'zap', 'beat'],
    ['Romance', 'heart', 'pulse'],
    ['Night Mode', 'moon', 'pulse'],
    ['Firefly', 'star', 'sparkle'],
    ['Glisten', 'star', 'sparkle'],
    ['Opal', 'star', 'sparkle'],
    ['Sunbeam', 'sun', 'pulse'],
    ['Breathing', 'activity', 'pulse'],
    ['TV Sync', 'film', 'aurora'],
    ['Cyberpunk Neon', 'gamepad', 'aurora'],
    ['Reading', 'eye', 'pulse'],
    ['Meteor Chase', 'orbit', 'wave'],
    ['CustomFx42', 'wand', 'pulse'],
  ])('auto-matches %s -> icon=%s motion=%s', (name, expectedIcon, expectedMotion) => {
    const visual = describeLightEffect(name);
    expect(visual.isStatic).toBe(false);
    expect(visual.icon).toBe(expectedIcon);
    expect(visual.motion).toBe(expectedMotion);
    expect(visual.palette).toHaveLength(3);
  });

  it('avoids false substring matches on common words', () => {
    expect(describeLightEffect('Fireworks').id).toBe('party');
    expect(describeLightEffect('Firefly').id).toBe('sparkle');
    expect(describeLightEffect('Police').id).toBe('strobe');
    expect(describeLightEffect('Seasonal').id).toBe('effect');
    expect(describeLightEffect('Flower').id).toBe('effect');
  });

  it('formats labels cleanly while preserving acronyms and builds deduplicated options', () => {
    expect(formatLightEffectLabel('color_loop')).toBe('Color Loop');
    expect(formatLightEffectLabel('rgb_cycle')).toBe('RGB Cycle');
    expect(formatLightEffectLabel('tv_sync')).toBe('TV Sync');
    expect(formatLightEffectLabel('candle')).toBe('Candle');

    const options = buildLightEffectOptions(['off', 'candle', 'fire', 'candle', 'prism', '']);
    expect(options.map((opt) => [opt.value, opt.label, opt.isStatic])).toEqual([
      ['off', 'Off', true],
      ['candle', 'Candle', false],
      ['fire', 'Fire', false],
      ['prism', 'Prism', false],
    ]);
  });

  it('selects the preferred native disable option from device effect lists', () => {
    expect(findDisableEffectOption(['fire', 'off', 'candle'])).toBe('off');
    expect(findDisableEffectOption(['Solid', 'Rainbow', 'Fire'])).toBe('Solid');
    expect(findDisableEffectOption(['Custom', 'Rainbow', 'Breathing'])).toBe('Custom');
    expect(findDisableEffectOption(['Rainbow', 'Fire'])).toBeUndefined();
  });
});
