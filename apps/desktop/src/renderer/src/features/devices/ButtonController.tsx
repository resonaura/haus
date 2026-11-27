/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Text } from '@haus/ui';
import { ButtonRemoteModalPanel } from '@haus/ui/components';
import type { HausAccessory, Snapshot } from '../../model';
import { deviceDisplayName } from '../../model/device-name';

export function ButtonController({
  accessory,
  snapshot,
  demo,
}: {
  accessory: HausAccessory;
  snapshot: Snapshot;
  demo: boolean;
}) {
  const controls = [accessory.state, ...accessory.secondaryEntities]
    .filter((item) => item.entity_id.startsWith('event.'))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id, undefined, { numeric: true }));
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (demo || !window.hausNative || !accessory.deviceId) return;
    let active = true;
    const api = window.hausNative;
    const read = async () => {
      const results = await Promise.all([
        api.request<{ automation?: string[] }>({
          type: 'search/related',
          item_type: 'device',
          item_id: accessory.deviceId,
        }),
        ...controls.map((control) =>
          api.request<{ automation?: string[] }>({
            type: 'search/related',
            item_type: 'entity',
            item_id: control.entity_id,
          }),
        ),
      ]);
      if (active)
        setLinks(
          Object.fromEntries(
            results.map((result, index) => [
              index === 0 ? 'device' : controls[index - 1]!.entity_id,
              result.automation ?? [],
            ]),
          ),
        );
    };
    void read().catch(() => {
      if (active) setError('Linked automations are unavailable right now.');
    });
    return () => {
      active = false;
    };
  }, [accessory.deviceId, accessory.primaryEntityId, demo]);

  const automationName = (id: string) =>
    String(
      snapshot.states.find((item) => item.entity_id === id)?.attributes.friendly_name ??
        id.replace('automation.', '').replaceAll('_', ' '),
    );

  return (
    <>
      <ButtonRemoteModalPanel
        buttons={controls.map((control, index) => ({
          id: control.entity_id,
          label: deviceDisplayName(
            String(control.attributes.friendly_name ?? `Button ${index + 1}`),
            accessory.name,
            `Button ${index + 1}`,
          ),
          rotary: /rotary|dial/i.test(control.entity_id),
          lastAction:
            typeof control.attributes.event_type === 'string'
              ? control.attributes.event_type.replaceAll('_', ' ')
              : undefined,
          gestures: Array.isArray(control.attributes.event_types)
            ? control.attributes.event_types.map(String).map((t) => t.replaceAll('_', ' '))
            : undefined,
          linkedAutomations: (links[control.entity_id] ?? []).map(automationName),
        }))}
        linkedAutomations={(links.device ?? []).map(automationName)}
      />
      {error && (
        <Text semantic="p" role="status">
          {error}
        </Text>
      )}
    </>
  );
}
