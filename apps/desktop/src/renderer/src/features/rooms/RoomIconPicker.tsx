/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@haus/ui';
import { roomIconFor, roomIconOptions } from '../../components/icons/Icon';

export function RoomIconPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value?: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const Icon = roomIconFor(name, value);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <Box className="room-icon-picker" boxRef={root}>
      <Pressable
        pressableRef={trigger}
        type="button"
        className="room-icon-picker-trigger device-group-icon"
        ariaLabel={`Change ${name} icon`}
        ariaExpanded={open}
        ariaHasPopup="menu"
        title={`Change ${name} icon`}
        onPress={() => setOpen((current) => !current)}
      >
        <Icon size={18} strokeWidth={1.7} />
      </Pressable>
      {open && (
        <Box
          className="room-icon-picker-menu"
          role="menu"
          ariaLabel={`${name} room icons`}
          onKeyDown={(event) => {
            const container =
              event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
            if (!container) return;
            const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const offset =
              event.key === 'ArrowDown'
                ? 2
                : event.key === 'ArrowUp'
                  ? -2
                  : event.key === 'ArrowRight'
                    ? 1
                    : event.key === 'ArrowLeft'
                      ? -1
                      : 0;
            if (offset || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + offset + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          {roomIconOptions.map(({ id, label, icon: OptionIcon }) => (
            <Pressable
              type="button"
              key={id}
              role="menuitemradio"
              ariaChecked={(value ?? 'auto') === id}
              ariaLabel={label}
              title={label}
              onPress={() => {
                onChange(id);
                close();
              }}
            >
              <OptionIcon size={18} strokeWidth={1.7} />
              <Text>{label}</Text>
            </Pressable>
          ))}
        </Box>
      )}
    </Box>
  );
}
