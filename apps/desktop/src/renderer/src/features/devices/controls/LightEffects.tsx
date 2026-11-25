/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { LightEffectsPanel } from '@haus/ui/components';
import type { buildAction, HassEntity } from '../../../model';
import {
  lightActiveEffect,
  lightDisableEffect,
  lightEffectOptions,
} from '../../../model/light-profile';
import { triggerHaptic } from '../../../components/ui/haptics';

export function LightEffects({
  entity,
  capabilities,
  disabled,
  act,
}: {
  entity: HassEntity;
  capabilities: string[];
  disabled: boolean;
  act: (
    intent: Parameters<typeof buildAction>[1],
    value?: Parameters<typeof buildAction>[2],
  ) => void;
}) {
  if (!capabilities.includes('effect')) return null;
  return (
    <LightEffectsPanel
      options={lightEffectOptions(entity)}
      active={lightActiveEffect(entity)}
      stop={lightDisableEffect(entity)}
      disabled={disabled}
      onSelect={(value) => {
        triggerHaptic('alignment');
        act('effect', value);
      }}
    />
  );
}
