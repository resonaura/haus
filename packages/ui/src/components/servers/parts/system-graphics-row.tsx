/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  buildServiceGroupSummary,
  computeServiceUsageScore,
  formatBytes,
  type ServerGraphicsAdapterRecord,
  type ServerServiceGroupSummary,
  type ServerServiceManager,
  type ServerServiceRow,
} from '@haus/core/transport';
import { Stack, Text } from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import { ServerFactRow } from '../server-surfaces.js';

export function fallbackServiceGroups(
  services: readonly ServerServiceRow[],
  totalMemoryBytes: number | null,
): readonly ServerServiceGroupSummary[] {
  const specs: readonly { id: ServerServiceManager; name: string }[] = [
    { id: 'docker', name: 'Docker' },
    { id: 'pm2', name: 'PM2' },
    { id: 'systemServices', name: 'System Services' },
  ];
  const groups: ServerServiceGroupSummary[] = [];
  for (const spec of specs) {
    const matching = services.filter((item) => item.manager === spec.id);
    if (matching.length === 0) continue;
    groups.push(
      buildServiceGroupSummary({
        id: spec.id,
        name: spec.name,
        source: spec.id,
        measured: true,
        rows: matching,
      }),
    );
  }
  return groups.sort(
    (a, b) =>
      (computeServiceUsageScore(b.cpuPercent, b.memoryBytes, totalMemoryBytes) ?? -1) -
        (computeServiceUsageScore(a.cpuPercent, a.memoryBytes, totalMemoryBytes) ?? -1) ||
      (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) ||
      (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1),
  );
}

export function ServerSystemGraphicsRow({
  graphics,
}: {
  readonly graphics?: readonly ServerGraphicsAdapterRecord[];
}) {
  if (!graphics || graphics.length === 0) return null;
  return (
    <ServerFactRow
      label="Graphics"
      icon={<UiIcon name="gpu" size={13} />}
      value={
        <Stack gapPx={4} align="end">
          {graphics.map((gpu) => {
            const kindLabel = gpu.kind
              ? {
                  integrated: 'Integrated',
                  discrete: 'Discrete',
                  external: 'External',
                  software: 'Software',
                }[gpu.kind]
              : undefined;
            const memBytes = gpu.memoryBytes ?? gpu.memoryTotalBytes ?? null;
            const meta = [
              gpu.vendor,
              kindLabel,
              gpu.driver ? `Driver ${gpu.driver}` : null,
              memBytes !== null ? `${formatBytes(memBytes)} VRAM` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Stack key={gpu.id ?? gpu.name} gapPx={1} align="end">
                <Text size={12.5} weight={500}>
                  {gpu.name}
                </Text>
                {meta ? (
                  <Text size={10.5} tone="muted">
                    {meta}
                  </Text>
                ) : null}
              </Stack>
            );
          })}
        </Stack>
      }
    />
  );
}
