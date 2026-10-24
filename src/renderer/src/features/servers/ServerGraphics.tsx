import { Gpu } from 'lucide-react';
import { bytes } from './presentation';
import type { ServerHost } from './types';

export function ServerGraphics({ host, fresh }: { host: ServerHost | null; fresh: boolean }) {
  const gpus = host?.gpus;
  if (!gpus?.available || !gpus.adapters.length) return null;
  return (
    <section className="server-panel server-graphics">
      <h3>
        <Gpu size={18} />
        Graphics{!fresh && <small className="server-last-known">Last known</small>}
      </h3>
      <div className="server-gpu-grid">
        {gpus.adapters.map((gpu) => (
          <article key={gpu.id} className="server-gpu-adapter">
            <span className="server-gpu-icon">
              <Gpu size={24} />
            </span>
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
                    gpu.memoryBytes !== null ? `${bytes(gpu.memoryBytes)} dedicated memory` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
