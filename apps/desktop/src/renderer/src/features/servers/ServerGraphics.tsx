/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Gpu } from 'lucide-react';
import { bytes } from './presentation';
import type { ServerHost } from './types';

export function ServerGraphics({ host, fresh }: { host: ServerHost | null; fresh: boolean }) {
  const gpus = host?.gpus;
  if (!gpus?.available || !gpus.adapters.length) return null;
  return (
    <div className="server-graphics-fact">
      <dt>
        <Gpu size={14} />
        Graphics{!fresh && <small className="server-last-known">Last known</small>}
      </dt>
      <dd>
        <div className="server-gpu-list">
          {gpus.adapters.map((gpu) => (
            <article key={gpu.id} className="server-gpu-adapter">
              <div>
                <strong>{gpu.name}</strong>
                <p>
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
                </p>
                {(gpu.driver || gpu.memoryBytes !== null) && (
                  <small>
                    {[
                      gpu.driver ? `Driver ${gpu.driver}` : null,
                      gpu.memoryBytes !== null
                        ? `${bytes(gpu.memoryBytes)} dedicated memory`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                )}
              </div>
            </article>
          ))}
        </div>
      </dd>
    </div>
  );
}
