/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, HausButton as Button, HausPopover, Heading, Text } from '@haus/ui';
import { Check, X } from 'lucide-react';
import type { HassEntity, HausAccessory } from '../../model';
import { describeAccessory } from '../../model/presentation';
import { AccessoryTile } from '../devices/AccessoryTile';
import {
  describeSceneTarget,
  missingSceneTargetAccessory,
  missingSceneTargetColor,
  missingSceneTargetName,
  scenePreviewAccessory,
} from './scene-target-helpers';

export function SceneTargetTile({
  id,
  name,
  room,
  entity,
  accessory,
  setting,
  adding,
  included,
  selected,
  onToggle,
  onQuickToggle,
  onOpenChange,
  children,
}: {
  id: string;
  name: string;
  room: string;
  entity?: HassEntity;
  accessory?: HausAccessory;
  setting: unknown;
  adding: boolean;
  included: boolean;
  selected: boolean;
  onToggle: () => void;
  onQuickToggle: () => void;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const tileRef = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<'right' | 'bottom'>('bottom');
  useLayoutEffect(() => {
    if (!selected) return;
    const position = () => {
      const rect = tileRef.current?.getBoundingClientRect();
      setPlacement(
        rect && Math.max(rect.left, window.innerWidth - rect.right) >= 368 ? 'right' : 'bottom',
      );
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [selected]);

  const missing = !entity;
  const tileAccessory = missing
    ? missingSceneTargetAccessory(id, setting)
    : scenePreviewAccessory(id, entity, accessory, setting, adding ? included : true);
  const displayName = missing ? missingSceneTargetName(id) : name;
  const missingColor = missing ? missingSceneTargetColor(id, setting) : undefined;
  const stateText = missing
    ? describeSceneTarget(id, undefined, setting)
    : adding
      ? included
        ? describeSceneTarget(id, entity, setting)
        : describeAccessory(tileAccessory)
      : describeSceneTarget(id, entity, setting);

  const tile = (
    <AccessoryTile
      tileRef={tileRef}
      accessory={tileAccessory}
      room={room}
      title={displayName}
      subtitle={missing ? 'Unavailable' : undefined}
      stateText={stateText}
      draggable={false}
      className={`scene-accessory-tile ${missing ? 'is-missing-target' : ''}`}
      selected={!adding && selected}
      included={adding ? included : undefined}
      showStatusDot={!adding && !(missing && missingColor)}
      showMore={!adding}
      quickDisabled={adding ? false : missing}
      iconActionLabel={
        adding
          ? `${included ? 'Remove' : 'Include'} ${displayName}`
          : missing
            ? `${displayName} is unavailable`
            : `Toggle ${displayName} in scene`
      }
      bodyAriaPressed={adding ? included : undefined}
      bodyAriaExpanded={!adding ? selected : undefined}
      topRight={
        adding ? (
          <Text className="scene-target-selection" ariaHidden>
            {included && <Check size={11} />}
          </Text>
        ) : missing && missingColor ? (
          <Text
            semantic="swatch"
            className="light-color-swatch scene-missing-swatch"
            surfaceTokens={{ background: missingColor }}
            title="Saved light color"
          />
        ) : undefined
      }
      onQuick={adding ? onToggle : onQuickToggle}
      onOpen={adding ? onToggle : () => onOpenChange(!selected)}
      onContextMenu={
        adding
          ? undefined
          : (event) => {
              event.preventDefault();
              onOpenChange(true);
            }
      }
    />
  );

  if (adding) return tile;

  return (
    <HausPopover
      open={selected}
      onOpenChange={onOpenChange}
      placement={placement}
      className="scene-target-popover"
      trigger={tile}
    >
      <Box className="scene-target-panel">
        <Box semantic="header">
          <Heading level={3}>{displayName}</Heading>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="Close accessory settings"
            onPress={() => onOpenChange(false)}
          >
            <X size={17} />
          </Button>
        </Box>
        {children}
      </Box>
    </HausPopover>
  );
}
