/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Power } from 'lucide-react';
import { Button } from '@heroui/react';
import { buildAction, type HassEntity } from '../../model';
import { deviceDisplayName } from '../../model/device-name';
export function PowerStripControls({
  entities,
  name,
  onAction,
}: {
  entities: HassEntity[];
  name: string;
  onAction: (action: ReturnType<typeof buildAction>) => void;
}) {
  const switches = entities.filter((item) => item.entity_id.startsWith('switch.'));
  const ordered = [
    ...switches.filter((item) => item.attributes.haus_outlet_role !== 'master'),
    ...switches.filter((item) => item.attributes.haus_outlet_role === 'master'),
  ];
  return (
    <section className="power-strip-controls" aria-label="Individual outlets">
      {ordered.map((item) => {
        const isMaster = item.attributes.haus_outlet_role === 'master';
        const label = isMaster
          ? 'All Outlets'
          : deviceDisplayName(
              String(item.attributes.friendly_name ?? item.entity_id),
              name,
              'Outlet',
            );
        const active = item.state === 'on';
        return (
          <div className={`power-strip-outlet${isMaster ? ' is-master' : ''}`} key={item.entity_id}>
            <Button
              isIconOnly
              variant="ghost"
              aria-label={`${active ? 'Turn off' : 'Turn on'} ${label}`}
              aria-pressed={active}
              isDisabled={['unavailable', 'unknown'].includes(item.state)}
              onPress={() => onAction(buildAction(item, 'toggle'))}
            >
              <Power size={32} strokeWidth={1.5} />
            </Button>
            <strong>{label}</strong>
            <small>
              {['unavailable', 'unknown'].includes(item.state)
                ? 'No response'
                : active
                  ? 'On'
                  : 'Off'}
            </small>
          </div>
        );
      })}
    </section>
  );
}
