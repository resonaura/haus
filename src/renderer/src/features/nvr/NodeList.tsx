import { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@heroui/react';
import { HardDrive, Pause, Play, Trash2 } from 'lucide-react';
import { size, type NvrNode } from './types';
export function NodeList({
  nodes,
  admin,
  busy,
  onToggle,
  onRemove,
}: {
  nodes: NvrNode[];
  admin: boolean;
  busy: boolean;
  onToggle: (node: NvrNode) => void;
  onRemove: (node: NvrNode) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(190);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setRowHeight(element.clientWidth < 560 ? 226 : 190);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const virtual = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 2,
    getItemKey: (i) => nodes[i].id,
  });
  useEffect(() => virtual.measure(), [rowHeight, virtual]);
  return (
    <div
      className="nvr-nodes-scroll"
      ref={scroll}
      style={{ height: Math.min(570, nodes.length * rowHeight) }}
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const node = nodes[item.index],
            status = node.remote;
          return (
            <article
              key={node.id}
              className="nvr-node"
              style={{
                position: 'absolute',
                width: '100%',
                transform: `translateY(${item.start}px)`,
                height: rowHeight - 12,
              }}
            >
              <div className="nvr-node-heading">
                <span className="settings-icon">
                  <HardDrive size={23} />
                </span>
                <div>
                  <h3 title={node.name}>{node.name}</h3>
                  <p>
                    {!node.enabled
                      ? 'Paused'
                      : node.online
                        ? 'Connected'
                        : 'Offline · copies resume when it returns'}
                  </p>
                </div>
                {admin && (
                  <div className="nvr-node-actions">
                    <Button
                      isIconOnly
                      variant="ghost"
                      aria-label={node.enabled ? `Pause ${node.name}` : `Resume ${node.name}`}
                      isDisabled={busy}
                      onPress={() => onToggle(node)}
                    >
                      {node.enabled ? <Pause size={16} /> : <Play size={16} />}
                    </Button>
                    <Button
                      isIconOnly
                      variant="ghost"
                      aria-label={`Disconnect ${node.name}`}
                      isDisabled={busy}
                      onPress={() => onRemove(node)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                )}
              </div>
              <div className="nvr-node-metrics">
                <span>
                  {node.roles.includes('storage') ? 'Storage' : ''}
                  {node.roles.length === 2 ? ' · ' : ''}
                  {node.roles.includes('stream') ? 'Streaming' : ''}
                </span>
                <span>{node.backupCopies} backup copies</span>
                {status && (
                  <>
                    <span>
                      {size(status.storage.usedBytes)} / {size(status.storage.maxBytes)}
                    </span>
                    <span>
                      {status.streams.active} / {status.streams.max} streams
                    </span>
                  </>
                )}
              </div>
              {status && (
                <meter
                  min={0}
                  max={status.storage.maxBytes || 1}
                  value={status.storage.usedBytes}
                  aria-label={`${node.name} storage used`}
                />
              )}
              <p className="nvr-node-address">{node.error || node.url}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
