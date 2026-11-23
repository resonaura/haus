/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Text } from '@haus/ui';
import { Gpu } from 'lucide-react';
import { bytes } from './presentation';
import type { ServerHost } from './types';

export function ServerGraphics({ host, fresh }: { host: ServerHost | null; fresh: boolean }) {
  const gpus = host?.gpus;
  if (!gpus?.available || !gpus.adapters.length) return null;
  return (
    <Box className="server-graphics-fact">
      <Box semantic="dt">
        <Gpu size={14} />
        Graphics
        {!fresh && (
          <Text semantic="small" className="server-last-known">
            Last known
          </Text>
        )}
      </Box>
      <Box semantic="dd">
        <Box className="server-gpu-list">
          {gpus.adapters.map((gpu) => (
            <Box semantic="article" key={gpu.id} className="server-gpu-adapter">
              <Box>
                <Text semantic="strong">{gpu.name}</Text>
                <Text semantic="p">
                  {[
                    gpu.vendor,
                    gpu.kind
                      ? {
                          integrated: 'Integrated',
                          discrete: 'Discrete',
                          external: 'External',
                          software: 'Software',
                        }[gpu.kind]
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {(gpu.driver || gpu.memoryBytes !== null) && (
                  <Text semantic="small">
                    {[
                      gpu.driver ? `Driver ${gpu.driver}` : null,
                      gpu.memoryBytes !== null
                        ? `${bytes(gpu.memoryBytes)} dedicated memory`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
