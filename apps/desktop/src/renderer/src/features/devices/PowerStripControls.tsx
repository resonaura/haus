/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { presentPowerOutlets } from '@haus/ha/view/device-relationships';
import { PowerStripPanel } from '@haus/ui/components';
import { buildAction, type HassEntity } from '../../model';
export function PowerStripControls({
  entities,
  name,
  onAction,
}: {
  entities: HassEntity[];
  name: string;
  onAction: (action: ReturnType<typeof buildAction>) => void;
}) {
  const outlets = presentPowerOutlets(entities, name);
  return (
    <PowerStripPanel
      outlets={outlets}
      onToggle={(id) => {
        const outlet = outlets.find((item) => item.id === id);
        if (outlet?.available) onAction(buildAction(outlet.entity, 'toggle'));
      }}
    />
  );
}
