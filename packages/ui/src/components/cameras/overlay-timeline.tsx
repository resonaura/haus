/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import { Box, Image, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface PortableCameraEventItem {
  readonly id: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly timeLabel: string;
  readonly durationLabel: string;
  readonly kinds: readonly string[];
  readonly status: string;
  readonly selected?: boolean;
  readonly thumbnailSrc?: string;
}

export function CameraOverlayTimeline({
  events,
  hasSelection,
  playing,
  selectedTimeClock,
  selectedDayClock,
  unavailableMessage,
  onTogglePlay,
  onBackToLive,
  onSelectEvent,
}: {
  readonly events: readonly PortableCameraEventItem[];
  readonly hasSelection: boolean;
  readonly playing?: boolean;
  readonly selectedTimeClock?: string;
  readonly selectedDayClock?: string;
  readonly unavailableMessage?: string;
  readonly onTogglePlay?: () => void;
  readonly onBackToLive: () => void;
  readonly onSelectEvent: (id: string) => void;
}) {
  return (
    <Stack align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
      {hasSelection && selectedTimeClock && (
        <Stack align="center" gapPx={1} style={{ pointerEvents: 'none' }}>
          <Text
            size={15}
            weight={700}
            style={{ typography: { size: 15, weight: 700, color: rgba(255, 255, 255, 0.98) } }}
          >
            {selectedTimeClock}
          </Text>
          {selectedDayClock && (
            <Text
              size={11}
              style={{ typography: { size: 11, color: rgba(255, 255, 255, 0.72) } }}
            >
              {selectedDayClock}
            </Text>
          )}
        </Stack>
      )}

      <Row
        align="center"
        gapPx={8}
        style={{
          layout: { width: pct(100), maxWidth: px(860), padding: insets(5, 8) },
          material: new GradientMaterial(
            [
              { offset: 0, color: rgba(24, 24, 24, 0.84) },
              { offset: 1, color: rgba(8, 8, 8, 0.78) },
            ],
            130,
          ),
          border: { width: 1, color: rgba(255, 255, 255, 0.12) },
          corners: corners(18),
        }}
      >
        {hasSelection && onTogglePlay && (
          <Pressable
            id="camera-overlay-play"
            ariaLabel={playing ? 'Pause recording' : 'Play recording'}
            onActivate={onTogglePlay}
            style={{
              layout: {
                width: px(32),
                height: px(36),
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
              corners: corners(10),
              states: { hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.1)) } },
            }}
          >
            <Box style={{ pointerEvents: 'none' }}>
              <UiIcon name={playing ? 'pause' : 'play'} size={15} color="#ffffff" />
            </Box>
          </Pressable>
        )}

        {events.length > 0 ? (
          <Box
            style={{
              layout: {
                flexGrow: 1,
                minWidth: px(0),
                position: 'relative',
                overflowX: 'scroll',
                padding: insets(2, 4),
              },
            }}
          >
            <Row align="center" gapPx={5}>
              {events.map((event) => (
                <Pressable
                  key={event.id}
                  id={`camera-strip-event-${event.id}`}
                  disabled={event.status !== 'ready'}
                  onActivate={() => onSelectEvent(event.id)}
                  style={{
                    layout: {
                      width: px(86),
                      height: px(38),
                      flexShrink: 0,
                      position: 'relative',
                      overflow: 'hidden',
                      justifyContent: 'end',
                      padding: insets(4, 5),
                    },
                    material: new SolidMaterial(rgba(25, 25, 28, 0.9)),
                    border: {
                      width: event.selected ? 2 : 1,
                      color: rgba(255, 255, 255, event.selected ? 0.95 : 0.16),
                    },
                    corners: corners(7),
                  }}
                >
                  {event.thumbnailSrc && (
                    <Box
                      ariaHidden
                      style={{
                        layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
                        pointerEvents: 'none',
                      }}
                    >
                      <Image
                        src={event.thumbnailSrc}
                        alt=""
                        ariaHidden
                        objectFit="cover"
                        style={{ layout: { width: pct(100), height: pct(100) } }}
                      />
                    </Box>
                  )}
                  <Box
                    ariaHidden
                    style={{
                      layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
                      pointerEvents: 'none',
                      material: new GradientMaterial(
                        [
                          { offset: 0.25, color: rgba(0, 0, 0, 0) },
                          { offset: 1, color: rgba(0, 0, 0, 0.84) },
                        ],
                        180,
                      ),
                    }}
                  />
                  <Text
                    size={8}
                    weight={700}
                    style={{
                      pointerEvents: 'none',
                      typography: { size: 8, weight: 700, color: rgba(255, 255, 255, 0.96) },
                    }}
                  >
                    {event.timeLabel}
                  </Text>
                </Pressable>
              ))}
            </Row>
            {hasSelection && (
              <Row
                justify="center"
                style={{
                  layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
                  pointerEvents: 'none',
                }}
              >
                <Box
                  style={{
                    layout: { width: px(2), height: pct(100) },
                    material: new SolidMaterial(rgba(255, 255, 255, 0.92)),
                    corners: corners(2),
                    pointerEvents: 'none',
                  }}
                />
              </Row>
            )}
          </Box>
        ) : (
          <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0), padding: insets(4, 6) } }}>
            <Text size={11} weight={600} style={{ typography: { color: rgba(255, 255, 255, 0.94) } }}>
              Your home has a memory.
            </Text>
            <Text size={9.5} style={{ typography: { color: rgba(255, 255, 255, 0.62) } }}>
              {unavailableMessage ?? 'No recordings captured on this day.'}
            </Text>
          </Stack>
        )}

        <Pressable
          id="camera-back-live"
          ariaPressed={!hasSelection}
          onActivate={onBackToLive}
          style={{
            layout: {
              minWidth: px(46),
              height: px(28),
              padding: insets(0, 10),
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            },
            corners: corners(10),
            material: new SolidMaterial(
              hasSelection ? rgba(255, 255, 255, 0.14) : rgba(255, 255, 255, 0.96),
            ),
          }}
        >
          <Text
            size={10}
            weight={600}
            style={{
              pointerEvents: 'none',
              typography: {
                size: 10,
                weight: 600,
                color: hasSelection ? rgba(255, 255, 255, 0.96) : rgba(23, 23, 23, 1),
              },
            }}
          >
            Live
          </Text>
        </Pressable>
      </Row>
    </Stack>
  );
}
