/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { memo } from 'react';
import { DeviceTile } from '@haus/ui/components';
import { REACT_NATIVE_CONTENT_HOST } from '@haus/ui/native';
import { HausUiProvider } from '@haus/ui/primitives';
import type { MobileHomeItem } from './mobile-dashboard.js';

export const HomeDeviceRow = memo(function HomeDeviceRow({
  item,
  dark,
}: {
  item: MobileHomeItem;
  dark: boolean;
}) {
  return (
    <HausUiProvider contentHost={REACT_NATIVE_CONTENT_HOST} mode={dark ? 'dark' : 'light'}>
      <DeviceTile {...item} compact iconName={item.kind === 'scene' ? 'clapperboard' : undefined} />
    </HausUiProvider>
  );
});
