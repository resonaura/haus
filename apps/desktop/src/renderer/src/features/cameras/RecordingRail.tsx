/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, HausButton, Pressable, px, Text } from '@haus/ui';
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
    <Box className="recording-virtual-scroll" boxRef={scroll}>
      <Box
        className="recording-events is-virtual"
        style={{
          layout: { width: px(virtual.getTotalSize()), height: px(150), position: 'relative' },
        }}
      >
        {virtual.getVirtualItems().map((item) => {
          const event = events[item.index];
          return event ? (
            <Pressable
              key={event.id}
              className={`recording-event ${selectedId === event.id ? 'is-selected' : ''}`}
              surfaceTokens={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `translateX(${item.start}px)`,
              }}
              ariaCurrent={selectedId === event.id ? true : undefined}
              disabled={event.status !== 'ready'}
              onPress={() => onSelect(event)}
            >
              <Box>
                {event.status === 'ready' ? (
                  <SmoothImage src={`haus-media://recordings/${event.id}/thumbnail`} alt="" />
                ) : (
                  <Film size={20} />
                )}
                <Text>
                  {event.status === 'ready'
                    ? `${Math.round(event.duration)}s`
                    : event.status === 'recording'
                      ? 'Recording…'
                      : event.status === 'interrupted'
                        ? 'Interrupted'
                        : 'Unavailable'}
                </Text>
              </Box>
              <Text semantic="strong">
                {new Date(event.startAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              <Text semantic="small">{event.kinds.join(' · ')}</Text>
            </Pressable>
          ) : (
            <HausButton
              key="earlier"
              variant="ghost"
              isDisabled={loading}
              onPress={onEarlier}
              style={{ layout: { position: 'absolute', inset: { left: px(item.start) } } }}
            >
              Earlier moments
            </HausButton>
          );
        })}
      </Box>
    </Box>
  );
}
