/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Image, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { PortableCameraEventItem } from './overlay-timeline.js';

const EVENT_FILTERS = [
  { value: 'all', label: 'All events' },
  { value: 'motion', label: 'Motion' },
  { value: 'person', label: 'Person' },
  { value: 'pet', label: 'Pet' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'doorbell', label: 'Doorbell' },
  { value: 'manual', label: 'Manual recording' },
] as const;

interface RulerSegment {
  readonly key: string;
  readonly grow: number;
  readonly kind: 'gap' | 'event' | 'selected';
  readonly event?: PortableCameraEventItem;
}

function buildRulerSegments(
  from: number,
  to: number,
  events: readonly PortableCameraEventItem[],
): RulerSegment[] {
  const span = Math.max(1, to - from);
  const ready = events
    .filter((item) => item.status === 'ready' && item.endAt > from && item.startAt < to)
    .sort((a, b) => a.startAt - b.startAt);
  const segments: RulerSegment[] = [];
  let cursor = from;
  for (const ev of ready) {
    const start = Math.max(cursor, ev.startAt);
    const end = Math.min(to, Math.max(start, ev.endAt));
    if (start > cursor) {
      segments.push({
        key: `gap-${cursor}`,
        grow: Math.max(1, Math.round(((start - cursor) / span) * 1000)),
        kind: 'gap',
      });
    }
    const eventGrow = Math.max(8, Math.round(((end - start) / span) * 1000));
    segments.push({
      key: `ev-${ev.id}`,
      grow: eventGrow,
      kind: ev.selected ? 'selected' : 'event',
      event: ev,
    });
    cursor = Math.max(cursor, end);
  }
  if (cursor < to) {
    segments.push({
      key: `gap-tail-${cursor}`,
      grow: Math.max(1, Math.round(((to - cursor) / span) * 1000)),
      kind: 'gap',
    });
  }
  return segments;
}

export function CameraEventsSheet({
  dayLabel,
  dayRange,
  selectedKind,
  events,
  loading,
  error,
  unavailableMessage,
  recordingBusy,
  canRecord,
  selectedEvent,
  onSelectKind,
  onRecordNow,
  onOpenSettings,
  onSelectEvent,
}: {
  readonly dayLabel: string;
  readonly dayRange: { readonly from: number; readonly to: number };
  readonly selectedKind: string;
  readonly events: readonly PortableCameraEventItem[];
  readonly loading: boolean;
  readonly error?: string;
  readonly unavailableMessage?: string;
  readonly recordingBusy?: boolean;
  readonly canRecord?: boolean;
  readonly selectedEvent?: PortableCameraEventItem;
  readonly onSelectKind: (kind: string) => void;
  readonly onRecordNow?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onSelectEvent: (id: string) => void;
}) {
  const segments = buildRulerSegments(dayRange.from, dayRange.to, events);

  return (
    <Stack
      gapPx={10}
      style={{
        layout: { width: pct(100), padding: insets(16, 18) },
        material: new SolidMaterial(rgba(17, 17, 17, 0.9)),
        border: { width: 1, color: rgba(255, 255, 255, 0.12) },
        corners: corners(22),
      }}
    >
      <Row justify="between" align="center" gapPx={8}>
        <Stack gapPx={2}>
          <Text size={13.5} weight={600} style={{ typography: { color: rgba(255, 255, 255, 0.96) } }}>
            History
          </Text>
          <Text size={10.5} style={{ typography: { color: rgba(255, 255, 255, 0.62) } }}>
            {selectedEvent
              ? `${dayLabel} · ${selectedEvent.kinds.join(' · ')}`
              : 'Recordings stay on your home server.'}
          </Text>
        </Stack>
        {selectedEvent && (
          <Row align="center" gapPx={5}>
            <UiIcon name="clock-3" size={13} color="rgba(255, 255, 255, 0.72)" />
            <Text size={11} style={{ typography: { color: rgba(255, 255, 255, 0.9) } }}>
              {`${selectedEvent.timeLabel} · ${selectedEvent.durationLabel}`}
            </Text>
          </Row>
        )}
      </Row>

      {unavailableMessage ? (
        <Stack gapPx={4} style={{ layout: { padding: insets(8, 0) } }}>
          <Text size={13} weight={600} style={{ typography: { color: rgba(255, 255, 255, 0.94) } }}>
            Your home has a memory.
          </Text>
          <Text size={11} style={{ typography: { color: rgba(255, 255, 255, 0.62) } }}>
            {unavailableMessage}
          </Text>
        </Stack>
      ) : loading ? (
        <Text size={11.5} style={{ typography: { color: rgba(255, 255, 255, 0.68) } }}>
          Loading recordings…
        </Text>
      ) : error ? (
        <Text size={11.5} tone="critical">
          {error}
        </Text>
      ) : (
        <>
          {events.length > 0 && (
            <Stack gapPx={4}>
              <Row
                style={{
                  layout: { width: pct(100), height: px(20), overflow: 'hidden', padding: insets(2, 0) },
                  material: new SolidMaterial(rgba(255, 255, 255, 0.07)),
                  corners: corners(6),
                }}
              >
                {segments.map((seg) =>
                  seg.kind === 'gap' ? (
                    <Box key={seg.key} style={{ layout: { flexGrow: seg.grow, height: pct(100) } }} />
                  ) : (
                    <Pressable
                      key={seg.key}
                      ariaLabel={seg.event ? `Select ${seg.event.timeLabel}` : undefined}
                      onActivate={() => seg.event && onSelectEvent(seg.event.id)}
                      style={{
                        layout: { flexGrow: seg.grow, height: pct(100) },
                        material: new SolidMaterial(
                          seg.kind === 'selected'
                            ? rgba(255, 255, 255, 0.96)
                            : rgba(255, 255, 255, 0.42),
                        ),
                        corners: corners(2),
                      }}
                    />
                  ),
                )}
              </Row>
              <Row justify="between" style={{ layout: { width: pct(100) } }}>
                {['00:00', '06:00', '12:00', '18:00', '24:00'].map((mark) => (
                  <Text
                    key={mark}
                    size={8.5}
                    style={{ typography: { size: 8.5, color: rgba(255, 255, 255, 0.48) } }}
                  >
                    {mark}
                  </Text>
                ))}
              </Row>
            </Stack>
          )}

          <Box style={{ layout: { width: pct(100), overflowX: 'scroll' } }}>
            <Row gapPx={6}>
              {EVENT_FILTERS.map((opt) => {
                const active = selectedKind === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    id={`camera-kind-${opt.value}`}
                    ariaPressed={active}
                    onActivate={() => onSelectKind(opt.value)}
                    style={{
                      layout: { padding: insets(6, 11), flexShrink: 0 },
                      corners: corners(20),
                      material: new SolidMaterial(
                        active ? rgba(255, 255, 255, 0.16) : rgba(255, 255, 255, 0.05),
                      ),
                      border: {
                        width: 1,
                        color: rgba(255, 255, 255, active ? 0.24 : 0.08),
                      },
                    }}
                  >
                    <Text
                      size={10.5}
                      weight={active ? 600 : 500}
                      style={{
                        pointerEvents: 'none',
                        typography: {
                          size: 10.5,
                          weight: active ? 600 : 500,
                          color: rgba(255, 255, 255, active ? 0.98 : 0.68),
                        },
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </Box>

          {events.length === 0 ? (
            <Text size={11.5} style={{ typography: { color: rgba(255, 255, 255, 0.62) } }}>
              {`No events on ${dayLabel}.`}
            </Text>
          ) : (
            <Box style={{ layout: { width: pct(100), overflowX: 'scroll' } }}>
              <Row gapPx={10}>
                {events.map((event) => {
                  const ready = event.status === 'ready';
                  return (
                    <Pressable
                      key={event.id}
                      id={`camera-event-${event.id}`}
                      disabled={!ready}
                      onActivate={() => onSelectEvent(event.id)}
                      style={{
                        layout: { width: px(123), flexShrink: 0, gap: px(5) },
                        opacity: ready ? 1 : 0.6,
                      }}
                    >
                      <Box
                        style={{
                          layout: {
                            width: px(123),
                            height: px(68),
                            position: 'relative',
                            overflow: 'hidden',
                            justifyContent: 'end',
                            alignItems: 'end',
                            padding: insets(4, 6),
                          },
                          material: new SolidMaterial(rgba(26, 26, 30, 1)),
                          corners: corners(11),
                          border: {
                            width: event.selected ? 2 : 1,
                            color: rgba(255, 255, 255, event.selected ? 0.96 : 0.14),
                          },
                          pointerEvents: 'none',
                        }}
                      >
                        {event.thumbnailSrc && (
                          <Box
                            ariaHidden
                            style={{
                              layout: {
                                position: 'absolute',
                                inset: insets(0),
                                width: pct(100),
                                height: pct(100),
                              },
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
                          style={{
                            layout: { padding: insets(2, 5) },
                            material: new SolidMaterial(rgba(0, 0, 0, 0.68)),
                            corners: corners(5),
                            pointerEvents: 'none',
                          }}
                        >
                          <Text
                            size={9}
                            weight={600}
                            style={{
                              pointerEvents: 'none',
                              typography: { size: 9, color: rgba(255, 255, 255, 0.96) },
                            }}
                          >
                            {ready ? event.durationLabel : event.status}
                          </Text>
                        </Box>
                      </Box>
                      <Text
                        size={11}
                        weight={600}
                        style={{
                          pointerEvents: 'none',
                          typography: { size: 11, weight: 600, color: rgba(255, 255, 255, 0.96) },
                        }}
                      >
                        {event.timeLabel}
                      </Text>
                      <Text
                        size={10}
                        style={{
                          pointerEvents: 'none',
                          typography: { size: 10, color: rgba(255, 255, 255, 0.6) },
                        }}
                      >
                        {event.kinds.length > 0 ? event.kinds.join(' · ') : 'Recording'}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            </Box>
          )}
        </>
      )}

      {(canRecord || onOpenSettings) && (
        <Row gapPx={8} align="center" wrap>
          {canRecord && onRecordNow && (
            <Pressable
              id="camera-record-now"
              disabled={recordingBusy}
              onActivate={onRecordNow}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(6),
                  padding: insets(7, 12),
                },
                corners: corners(10),
                material: new SolidMaterial(rgba(255, 255, 255, 0.09)),
                border: { width: 1, color: rgba(255, 255, 255, 0.14) },
              }}
            >
              <Row align="center" gapPx={6} style={{ pointerEvents: 'none' }}>
                <UiIcon name="film" size={14} color="#ffffff" />
                <Text size={11} weight={600} style={{ typography: { color: rgba(255, 255, 255, 0.96) } }}>
                  {recordingBusy ? 'Recording…' : 'Record a moment'}
                </Text>
              </Row>
            </Pressable>
          )}
          {onOpenSettings && (
            <Pressable
              id="camera-open-settings-inline"
              onActivate={onOpenSettings}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(6),
                  padding: insets(7, 12),
                },
                corners: corners(10),
                material: new SolidMaterial(rgba(255, 255, 255, 0.05)),
              }}
            >
              <Row align="center" gapPx={6} style={{ pointerEvents: 'none' }}>
                <UiIcon name="settings-2" size={14} color="rgba(255, 255, 255, 0.84)" />
                <Text size={11} style={{ typography: { color: rgba(255, 255, 255, 0.88) } }}>
                  Detectors & recording
                </Text>
              </Row>
            </Pressable>
          )}
        </Row>
      )}
    </Stack>
  );
}
