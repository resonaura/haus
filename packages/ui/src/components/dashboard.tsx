/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, insets, pct, px } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { Row, ScrollView, Stack, Text } from '../primitives/elements.js';
import { SCROLL_SHADOW_PRESETS } from '../renderers/scroll-shadow.js';
import { UiIcon } from './icon.js';

export function CompactDashboard({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Stack
      gapPx={0}
      style={{
        layout: { width: pct(100), height: pct(100) },
        material: new SolidMaterial(colorToken('canvas')),
      }}
    >
      <Row paddingPx={22} gapPx={10} justify="between">
        <Row gapPx={10} role="heading" ariaLevel={1}>
          <UiIcon name="house" size={22} />
          <Text tone="primary" size={22} weight={600}>
            {title}
          </Text>
        </Row>
        {actions}
      </Row>
      <ScrollView
        orientation="vertical"
        shadowSizePx={SCROLL_SHADOW_PRESETS.main}
        style={{
          layout: {
            flexGrow: 1,
            minHeight: px(0),
            direction: 'column',
            gap: px(8),
            padding: insets(0, 22, 22, 22),
          },
        }}
      >
        {children}
      </ScrollView>
    </Stack>
  );
}
