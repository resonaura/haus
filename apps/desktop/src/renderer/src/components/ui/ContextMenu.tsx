/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, type HostKeyEvent } from '@haus/ui';
import { ChevronRight } from 'lucide-react';
import type { ContextMenuItem } from '../../../../shared/native';

type Props = {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onAction: (id: string) => void;
  onClose: () => void;
};

/** Web fallback for the native menu, including nested keyboard navigation. */
export function ContextMenu({ items, x, y, onAction, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <>
      <Box
        className="native-context-menu-backdrop"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <Box
        boxRef={root}
        stopPropagation
        className={`native-context-menu ${x > window.innerWidth - 420 ? 'opens-left' : ''}`}
        surfaceTokens={{ left: x, top: y }}
      >
        <MenuItems items={items} onAction={onAction} onClose={onClose} />
      </Box>
    </>
  );
}

function MenuItems({
  items,
  onAction,
  onClose,
  onBack,
}: Pick<Props, 'items' | 'onAction' | 'onClose'> & { onBack?: () => void }) {
  const [openId, setOpenId] = useState<string>();
  const menu = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: HostKeyEvent) => {
    const targetEl = event.target instanceof HTMLElement ? event.target : null;
    const currentEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!targetEl || !currentEl) return;
    if (targetEl.closest('[role="menu"]') !== currentEl) return;
    const buttons = [
      ...currentEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    ].filter((button) => button.closest('[role="menu"]') === currentEl);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      buttons[next]?.focus();
    }
    if (event.key === 'ArrowRight') {
      const button = buttons[index];
      if (button?.getAttribute('aria-haspopup') === 'menu') {
        event.preventDefault();
        button.click();
      }
    }
    if (event.key === 'ArrowLeft' && onBack) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key === 'Tab') onClose();
  };
  useEffect(() => {
    if (onBack) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [onBack]);
  return (
    <Box role="menu" boxRef={menu} onKeyDown={onKeyDown}>
      {items.map((item, index) =>
        item.type === 'separator' ? (
          <Box
            key={`separator-${index}`}
            role="separator"
            className="native-context-menu-separator"
          />
        ) : (
          <Box
            key={item.id}
            className={item.type === 'submenu' ? 'native-context-menu-parent' : undefined}
            onPointerEnter={() =>
              setOpenId(item.type === 'submenu' && item.enabled !== false ? item.id : undefined)
            }
          >
            <Pressable
              type="button"
              role="menuitem"
              className="native-context-menu-item"
              disabled={item.enabled === false}
              ariaHasPopup={item.type === 'submenu' ? 'menu' : undefined}
              ariaExpanded={item.type === 'submenu' ? openId === item.id : undefined}
              onPress={() =>
                item.type === 'submenu'
                  ? setOpenId(openId === item.id ? undefined : item.id)
                  : onAction(item.id)
              }
            >
              {item.label}
              {item.type === 'submenu' && <ChevronRight size={13} />}
            </Pressable>
            {item.type === 'submenu' && openId === item.id && (
              <Box className="native-context-menu native-context-submenu">
                <MenuItems
                  items={item.items ?? []}
                  onAction={onAction}
                  onClose={onClose}
                  onBack={() => {
                    setOpenId(undefined);
                    menu.current
                      ?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
                      ?.focus();
                  }}
                />
              </Box>
            )}
          </Box>
        ),
      )}
    </Box>
  );
}
