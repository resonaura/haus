/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useId, useState } from 'react';
import { SelectInput, Text, TextInput } from '@haus/ui';
import type { HassEntity } from '../../model';
export function EntityPicker({
  entities,
  value,
  onChange,
  label = 'Accessory',
}: {
  entities: HassEntity[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const matches = entities.filter((item) =>
    `${item.attributes.friendly_name} ${item.entity_id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visible = matches.some((item) => item.entity_id === value)
    ? matches
    : [...entities.filter((item) => item.entity_id === value), ...matches];
  return (
    <Text semantic="label" className="management-field">
      <Text>{label}</Text>
      <TextInput
        inputType="search"
        value={query}
        onChange={setQuery}
        placeholder="Find an accessory…"
        ariaLabel={`Find ${label.toLowerCase()}`}
      />
      <SelectInput
        ariaLabel={label}
        id={id}
        value={value}
        options={[
          { value: '', label: 'Choose an accessory' },
          ...visible.map((item) => ({
            value: item.entity_id,
            label: String(item.attributes.friendly_name ?? item.entity_id),
          })),
        ]}
        onChange={onChange}
      />
    </Text>
  );
}
