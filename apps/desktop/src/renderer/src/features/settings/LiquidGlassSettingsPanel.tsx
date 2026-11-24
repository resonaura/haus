/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, LiquidGlassSettingsPanel as SharedLiquidGlassPanel } from '@haus/ui';
import type { LiquidGlassPreference } from '../../model/preferences';

export interface LiquidGlassSettingsPanelProps {
  readonly value?: LiquidGlassPreference;
  readonly onChange: (next: LiquidGlassPreference) => void;
}

export function LiquidGlassSettingsPanel({ value, onChange }: LiquidGlassSettingsPanelProps) {
  return (
    <Box className="liquid-glass-settings">
      <SharedLiquidGlassPanel value={value} onChange={(next) => onChange(next)} />
    </Box>
  );
}
