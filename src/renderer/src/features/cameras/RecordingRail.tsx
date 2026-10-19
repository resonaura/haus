import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@heroui/react';
import { Film } from 'lucide-react';
import { SmoothImage } from '../../components/ui/SmoothImage';
import type { CameraEvent } from '../../model/camera-history';
export function RecordingRail({
  events,
  selectedId,
  onSelect,
  hasEarlier,
  loading,
  onEarlier,
}: {
  events: CameraEvent[];
  selectedId?: string;
  onSelect: (event: CameraEvent) => void;
  hasEarlier: boolean;
  loading: boolean;
  onEarlier: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: events.length + (hasEarlier ? 1 : 0),
    horizontal: true,
    getScrollElement: () => scroll.current,
    estimateSize: () => 149,
    overscan: 3,
    getItemKey: (index) => events[index]?.id ?? 'earlier',
  });
  return (
    <div className="recording-virtual-scroll" ref={scroll}>
      <div
        className="recording-events is-virtual"
        style={{ width: virtual.getTotalSize(), height: 150, position: 'relative' }}
      >
        {virtual.getVirtualItems().map((item) => {
          const event = events[item.index];
          return event ? (
            <button
              key={event.id}
              className={`recording-event ${selectedId === event.id ? 'is-selected' : ''}`}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `translateX(${item.start}px)`,
              }}
              aria-current={selectedId === event.id ? true : undefined}
              disabled={event.status !== 'ready'}
              onClick={() => onSelect(event)}
            >
              <div>
                {event.status === 'ready' ? (
                  <SmoothImage src={`haus-media://recordings/${event.id}/thumbnail`} alt="" />
                ) : (
                  <Film size={20} />
                )}
                <span>
                  {event.status === 'ready'
                    ? `${Math.round(event.duration)}s`
                    : event.status === 'recording'
                      ? 'Recording…'
                      : event.status === 'interrupted'
                        ? 'Interrupted'
                        : 'Unavailable'}
                </span>
              </div>
              <strong>
                {new Date(event.startAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </strong>
              <small>{event.kinds.join(' · ')}</small>
            </button>
          ) : (
            <Button
              key="earlier"
              variant="ghost"
              isDisabled={loading}
              onPress={onEarlier}
              style={{ position: 'absolute', left: item.start }}
            >
              Earlier moments
            </Button>
          );
        })}
      </div>
    </div>
  );
}
