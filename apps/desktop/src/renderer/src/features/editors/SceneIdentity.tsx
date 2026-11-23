/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, Pressable, Text, TextInput } from '@haus/ui';
import { SceneIcon } from '../../components/icons/Icon';
const choices = [
  ['mdi:sparkles', 'Custom'],
  ['mdi:weather-night', 'Night'],
  ['mdi:white-balance-sunny', 'Bright'],
  ['mdi:sofa', 'Relax'],
  ['mdi:movie-open', 'Movie'],
  ['mdi:book-open-variant', 'Read'],
  ['mdi:home', 'Home'],
];
export function SceneIdentity({
  name,
  icon,
  onChange,
}: {
  name: string;
  icon?: string;
  onChange: (patch: { name?: string; icon?: string }) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <Box className="scene-identity">
      <Box className="scene-name-row">
        <Pressable
          type="button"
          className="scene-identity-icon"
          ariaLabel="Choose scene icon"
          ariaExpanded={choosing}
          onPress={() => setChoosing(!choosing)}
        >
          <SceneIcon name={name} icon={icon} />
        </Pressable>
        <Text semantic="label">
          <Text>Scene name</Text>
          <TextInput
            required
            placeholder="A good evening"
            value={name}
            onChange={(nextName) => onChange({ name: nextName })}
          />
        </Text>
      </Box>
      {choosing && (
        <Box className="scene-icon-options" ariaLabel="Scene icons">
          {choices.map(([value, label]) => (
            <Pressable
              type="button"
              key={value}
              ariaPressed={icon === value}
              ariaLabel={label}
              onPress={() => {
                onChange({ icon: value });
                setChoosing(false);
              }}
            >
              <SceneIcon name={label} icon={value} />
            </Pressable>
          ))}
        </Box>
      )}
    </Box>
  );
}
