/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DeviceBadgeStatus } from '../categories/index.js';
import { corners, insets, rgba } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { Text } from '../primitives/elements.js';

export interface StatusBadgeProps {
  readonly status: DeviceBadgeStatus;
  readonly label?: string;
  readonly className?: string;
}

const badgeColors = {
  online: [16, 185, 129],
  offline: [107, 114, 128],
  active: [59, 130, 246],
  alert: [239, 68, 68],
  warning: [245, 158, 11],
  low_battery: [245, 158, 11],
  updating: [139, 92, 246],
} as const satisfies Record<DeviceBadgeStatus, readonly [number, number, number]>;

export function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const [red, green, blue] = badgeColors[status] ?? badgeColors.offline;
  return (
    <Text
      className={`haus-status-badge ${className}`.trim()}
      size={11}
      weight={600}
      style={{
        layout: { display: 'inline-flex', alignItems: 'center', padding: insets(2, 8) },
        corners: corners(9999, 'round'),
        material: new SolidMaterial(rgba(red, green, blue, 0.15)),
        border: { width: 1, color: rgba(red, green, blue, 0.3) },
        typography: {
          color: status === 'offline' ? rgba(156, 163, 175) : rgba(red, green, blue),
          lineHeight: 1.2,
        },
      }}
    >
      {(label ?? status.replace('_', ' ')).replace(/(^|\s)\p{L}/gu, (letter) =>
        letter.toUpperCase(),
      )}
    </Text>
  );
}
