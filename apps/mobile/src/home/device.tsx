/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { memo } from 'react';
import type { HausAction } from '@haus/ha/types';
import { DeviceTile, parseCssColor } from '@haus/ui/components';
import { REACT_NATIVE_CONTENT_HOST } from '@haus/ui/native';
import { HausUiProvider } from '@haus/ui/primitives';
import type { MobileHomeItem } from './mobile-dashboard.js';

export const HomeDeviceRow = memo(function HomeDeviceRow({
  item,
  dark,
  disabled = false,
  onTriggerActions,
}: {
  item: MobileHomeItem;
  dark: boolean;
  disabled?: boolean;
  onTriggerActions?: (actions: readonly HausAction[]) => void;
}) {
  const actions = item.quickActions;
  const canQuick = !disabled && item.available && Boolean(actions?.length);
  const trigger =
    canQuick && actions && onTriggerActions ? () => onTriggerActions(actions) : undefined;
  return (
    <HausUiProvider contentHost={REACT_NATIVE_CONTENT_HOST} mode={dark ? 'dark' : 'light'}>
      <DeviceTile
        {...item}
        compact
        accent={parseCssColor(item.accentCss)}
        iconName={item.kind === 'scene' ? 'clapperboard' : undefined}
        quickDisabled={!canQuick}
        onQuick={trigger}
        onOpen={item.kind === 'scene' ? trigger : undefined}
      />
    </HausUiProvider>
  );
});
