/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useId, useState } from 'react';
import { Box, Pressable, Text } from '@haus/ui';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { ServerIcon } from '../../components/icons/ServerIcon';
import { resolveServerIcon, serverIconOptions, type ServerIconId } from '../../model/server-icon';
import type { HomeServer } from './types';
import './styles/icon-picker.scss';

export function ServerIconPicker({
  server,
  value,
  onChange,
  disabled = false,
}: {
  server: HomeServer;
  value?: ServerIconId;
  onChange: (icon: ServerIconId | undefined) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();
  const labelId = useId();
  const automaticIcon = resolveServerIcon(server);
  const automaticLabel = serverIconOptions.find((option) => option.id === automaticIcon)?.label;
  const selectedLabel = value
    ? serverIconOptions.find((option) => option.id === value)?.label
    : `Automatic${automaticLabel ? ` · ${automaticLabel}` : ''}`;

  return (
    <Box className="server-icon-picker">
      <Text className="server-icon-picker-label" id={labelId}>
        Icon
      </Text>
      <Box className="server-icon-picker-heading">
        <Pressable
          className="server-icon-picker-trigger"
          ariaLabelledBy={labelId}
          ariaExpanded={expanded}
          ariaControls={optionsId}
          disabled={disabled}
          onPress={() => setExpanded((current) => !current)}
        >
          <Text className="server-icon-picker-preview">
            <ServerIcon server={server} icon={value} size={27} />
          </Text>
          <Text className="server-icon-picker-choice">{selectedLabel}</Text>
          <ChevronDown size={17} className={expanded ? 'is-expanded' : undefined} />
        </Pressable>
        {value && (
          <Pressable
            className="server-icon-picker-reset"
            disabled={disabled}
            onPress={() => onChange(undefined)}
          >
            <RotateCcw size={14} />
            <Text>Use automatic</Text>
          </Pressable>
        )}
      </Box>
      <Box
        id={optionsId}
        className="server-icon-picker-options"
        role="group"
        ariaLabelledBy={labelId}
        hidden={!expanded}
      >
        <Pressable
          className="server-icon-picker-option"
          ariaPressed={!value}
          disabled={disabled}
          onPress={() => onChange(undefined)}
        >
          <ServerIcon server={server} size={26} />
          <Text>Automatic</Text>
          {!value && <Check className="server-icon-picker-check" size={13} />}
        </Pressable>
        {serverIconOptions.map((option) => (
          <Pressable
            key={option.id}
            className="server-icon-picker-option"
            ariaPressed={value === option.id}
            disabled={disabled}
            onPress={() => onChange(option.id)}
          >
            <ServerIcon server={server} icon={option.id} size={26} />
            <Text>{option.label}</Text>
            {value === option.id && <Check className="server-icon-picker-check" size={13} />}
          </Pressable>
        ))}
      </Box>
      <Text semantic="p" className="server-icon-picker-note">
        Automatic follows the server identity and operating system.
      </Text>
    </Box>
  );
}
