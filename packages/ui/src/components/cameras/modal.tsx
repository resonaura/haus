/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import { Box, HausDialog, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export type CameraViewMode = 'live' | 'events';

export function CameraModalView({
  title,
  roomName,
  statusTag,
  view,
  hasSelection,
  dayLabel,
  canGoNext,
  playing,
  muted,
  muteDisabled,
  fill,
  hasPtz,
  ptzOpen,
  settingsOpen,
  viewport,
  overlayTimeline,
  eventsSheet,
  ptzPanel,
  settingsPanel,
  onSelectView,
  onPrevDay,
  onNextDay,
  onTogglePlay,
  onTogglePtz,
  onToggleMute,
  onToggleFill,
  onToggleSettings,
  onDismissDrawers,
  onClose,
}: {
  readonly title: string;
  readonly roomName?: string;
  readonly statusTag?: string;
  readonly view: CameraViewMode;
  readonly hasSelection: boolean;
  readonly dayLabel: string;
  readonly canGoNext: boolean;
  readonly playing?: boolean;
  readonly muted?: boolean;
  readonly muteDisabled?: boolean;
  readonly fill: boolean;
  readonly hasPtz: boolean;
  readonly ptzOpen: boolean;
  readonly settingsOpen: boolean;
  readonly viewport: ReactNode;
  readonly overlayTimeline: ReactNode;
  readonly eventsSheet: ReactNode;
  readonly ptzPanel?: ReactNode;
  readonly settingsPanel: ReactNode;
  readonly onSelectView: (view: CameraViewMode) => void;
  readonly onPrevDay: () => void;
  readonly onNextDay: () => void;
  readonly onTogglePlay?: () => void;
  readonly onTogglePtz: () => void;
  readonly onToggleMute: () => void;
  readonly onToggleFill: () => void;
  readonly onToggleSettings: () => void;
  readonly onDismissDrawers: () => void;
  readonly onClose: () => void;
}) {
  const toolButton = (
    id: string,
    icon: UiIconName,
    label: string,
    onPress: () => void,
    active = false,
    disabled = false,
  ) => (
    <Pressable
      key={id}
      id={id}
      ariaLabel={label}
      ariaPressed={active}
      disabled={disabled}
      onActivate={onPress}
      style={{
        layout: { width: px(32), height: px(32), alignItems: 'center', justifyContent: 'center' },
        corners: corners(12),
        material: new SolidMaterial(active ? rgba(255, 255, 255, 0.16) : rgba(0, 0, 0, 0)),
        opacity: disabled ? 0.35 : 1,
        states: disabled
          ? undefined
          : { hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.12)) } },
      }}
    >
      <Box style={{ pointerEvents: 'none' }}>
        <UiIcon name={icon} size={17} color="#ffffff" />
      </Box>
    </Pressable>
  );

  const circleButton = (
    id: string,
    icon: UiIconName,
    label: string,
    onPress: () => void,
    active = false,
  ) => (
    <Pressable
      id={id}
      ariaLabel={label}
      ariaPressed={active}
      onActivate={onPress}
      style={{
        layout: { width: px(38), height: px(38), alignItems: 'center', justifyContent: 'center' },
        corners: corners(999),
        material: new SolidMaterial(active ? rgba(36, 36, 40, 0.88) : rgba(20, 20, 20, 0.76)),
        border: { width: 1, color: rgba(255, 255, 255, active ? 0.36 : 0.14) },
        states: { hover: { material: new SolidMaterial(rgba(40, 40, 44, 0.85)) } },
      }}
    >
      <Box style={{ pointerEvents: 'none' }}>
        <UiIcon name={icon} size={17} color="#ffffff" />
      </Box>
    </Pressable>
  );

  return (
    <HausDialog size="cover" chromeless title={title} backdrop="blur" onClose={onClose}>
      <Box
        style={{
          layout: { position: 'relative', width: pct(100), height: pct(100), overflow: 'hidden' },
          material: new SolidMaterial(rgba(8, 8, 8, 1)),
        }}
      >
        {/* Layer 1: Full-bleed video / snapshot stage */}
        <Box
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
          }}
        >
          {view === 'events' && !hasSelection ? (
            <Stack
              align="center"
              gapPx={10}
              style={{ layout: { width: pct(100), padding: { top: px(150) } } }}
            >
              <UiIcon name="video" size={32} color="rgba(255, 255, 255, 0.42)" />
              <Text size={12.5} style={{ typography: { color: rgba(255, 255, 255, 0.48) } }}>
                Choose a recorded moment
              </Text>
            </Stack>
          ) : (
            viewport
          )}
        </Box>

        {/* Bottom scrim gradient */}
        <Box
          ariaHidden
          style={{
            layout: {
              position: 'absolute',
              inset: { left: px(0), right: px(0), bottom: px(0) },
              height: px(200),
            },
            pointerEvents: 'none',
            material: new GradientMaterial(
              [
                { offset: 0, color: rgba(0, 0, 0, 0) },
                { offset: 1, color: rgba(0, 0, 0, 0.56) },
              ],
              180,
            ),
          }}
        />

        {/* Layer 2: Bottom timeline overlay OR expanded Events sheet */}
        {view === 'live' ? (
          <Box
            style={{
              layout: {
                position: 'absolute',
                inset: { bottom: px(22), left: px(24), right: px(24) },
              },
            }}
          >
            {overlayTimeline}
          </Box>
        ) : (
          <Box
            style={{
              layout: {
                position: 'absolute',
                inset: { bottom: px(18), left: px(20), right: px(20) },
                maxHeight: pct(46),
                minHeight: px(0),
                overflowY: 'scroll',
              },
            }}
          >
            {eventsSheet}
          </Box>
        )}

        {/* Layer 3: Click-outside drawer dismiss below header & floating popovers */}
        {(ptzOpen || settingsOpen) && (
          <Pressable
            id="camera-drawer-backdrop"
            ariaLabel="Close floating camera panel"
            onActivate={onDismissDrawers}
            style={{
              layout: {
                position: 'absolute',
                inset: insets(0),
                width: pct(100),
                height: pct(100),
              },
            }}
          />
        )}

        {/* Layer 4A: Floating top-left camera title + status tag */}
        <Stack
          gapPx={4}
          style={{
            layout: { position: 'absolute', inset: { top: px(20), left: px(24) } },
            pointerEvents: 'none',
          }}
        >
          {roomName && (
            <Text size={10} style={{ typography: { size: 10, color: rgba(255, 255, 255, 0.65) } }}>
              {roomName}
            </Text>
          )}
          <Text
            size={21}
            weight={600}
            style={{ typography: { size: 21, weight: 600, color: rgba(255, 255, 255, 0.98) } }}
          >
            {title}
          </Text>
          {statusTag && (
            <Row style={{ pointerEvents: 'none', layout: { margin: { top: px(6) } } }}>
              <Box
                style={{
                  layout: { padding: insets(4, 9) },
                  material: new SolidMaterial(rgba(20, 20, 20, 0.66)),
                  border: { width: 1, color: rgba(255, 255, 255, 0.14) },
                  corners: corners(8),
                }}
              >
                <Text
                  size={10}
                  weight={600}
                  style={{
                    typography: {
                      size: 10,
                      weight: 600,
                      letterSpacing: 0.7,
                      color: rgba(244, 244, 246, 0.94),
                    },
                  }}
                >
                  {statusTag}
                </Text>
              </Box>
            </Row>
          )}
        </Stack>

        {/* Layer 4B: Floating top-center Live/Events pill + Date stepper */}
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { position: 'absolute', inset: { top: px(20), left: px(240), right: px(240) } },
          }}
        >
          <Row
            id="camera-modal-tabs"
            gapPx={4}
            style={{
              layout: { padding: insets(4) },
              material: new SolidMaterial(rgba(22, 22, 22, 0.72)),
              border: { width: 1, color: rgba(255, 255, 255, 0.12) },
              corners: corners(20),
            }}
          >
            {(['live', 'events'] as const).map((mode) => {
              const active = view === mode;
              return (
                <Pressable
                  key={mode}
                  id={`camera-view-${mode}`}
                  ariaPressed={active}
                  onActivate={() => onSelectView(mode)}
                  style={{
                    layout: {
                      minWidth: px(84),
                      height: px(30),
                      padding: insets(0, 14),
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    corners: corners(16),
                    material: new SolidMaterial(
                      active ? rgba(255, 255, 255, 0.14) : rgba(0, 0, 0, 0),
                    ),
                  }}
                >
                  <Text
                    size={11}
                    weight={600}
                    style={{
                      pointerEvents: 'none',
                      typography: {
                        size: 11,
                        weight: 600,
                        color: active ? rgba(255, 255, 255, 0.98) : rgba(255, 255, 255, 0.65),
                      },
                    }}
                  >
                    {mode === 'live' ? 'Live' : 'Events'}
                  </Text>
                </Pressable>
              );
            })}
          </Row>

          <Row
            align="center"
            gapPx={4}
            style={{
              layout: { padding: insets(3, 6) },
              material: new SolidMaterial(rgba(20, 20, 20, 0.68)),
              border: { width: 1, color: rgba(255, 255, 255, 0.1) },
              corners: corners(14),
            }}
          >
            <Pressable
              id="camera-day-prev"
              ariaLabel="Previous day"
              onActivate={onPrevDay}
              style={{
                layout: { width: px(24), height: px(24), alignItems: 'center', justifyContent: 'center' },
                corners: corners(8),
              }}
            >
              <Box style={{ pointerEvents: 'none' }}>
                <UiIcon name="chevron-left" size={14} color="#ffffff" />
              </Box>
            </Pressable>
            <Row align="center" gapPx={6} style={{ layout: { padding: insets(0, 6) } }}>
              <Text
                size={11.5}
                weight={500}
                style={{ typography: { size: 11.5, color: rgba(255, 255, 255, 0.94) } }}
              >
                {dayLabel}
              </Text>
              <UiIcon name="calendar" size={13} color="rgba(255, 255, 255, 0.78)" />
            </Row>
            <Pressable
              id="camera-day-next"
              ariaLabel="Next day"
              disabled={!canGoNext}
              onActivate={onNextDay}
              style={{
                layout: { width: px(24), height: px(24), alignItems: 'center', justifyContent: 'center' },
                corners: corners(8),
                opacity: canGoNext ? 1 : 0.35,
              }}
            >
              <Box style={{ pointerEvents: 'none' }}>
                <UiIcon name="chevron-right" size={14} color="#ffffff" />
              </Box>
            </Pressable>
          </Row>
        </Stack>

        {/* Layer 4C: Floating top-right toolbar + settings + close */}
        <Row
          align="center"
          gapPx={10}
          style={{ layout: { position: 'absolute', inset: { top: px(20), right: px(24) } } }}
        >
          <Row
            align="center"
            gapPx={2}
            style={{
              layout: { padding: insets(3) },
              material: new SolidMaterial(rgba(20, 20, 20, 0.72)),
              border: { width: 1, color: rgba(255, 255, 255, 0.1) },
              corners: corners(16),
            }}
          >
            {hasSelection &&
              onTogglePlay &&
              toolButton(
                'camera-toolbar-play',
                playing ? 'pause' : 'play',
                playing ? 'Pause recording' : 'Play recording',
                onTogglePlay,
              )}
            {!hasSelection &&
              hasPtz &&
              toolButton('camera-ptz-toggle', 'move', 'Camera controls', onTogglePtz, ptzOpen)}
            {toolButton(
              'camera-mute-toggle',
              muted || muteDisabled ? 'volume-x' : 'volume-2',
              muted ? 'Unmute camera' : 'Mute camera',
              onToggleMute,
              false,
              muteDisabled,
            )}
            {toolButton(
              'camera-fill-toggle',
              fill ? 'shrink' : 'scan',
              fill ? 'Fit video inside viewer' : 'Fill viewer with video',
              onToggleFill,
              fill,
            )}
          </Row>
          {circleButton('camera-settings-toggle', 'settings-2', 'Camera settings', onToggleSettings, settingsOpen)}
          {circleButton('dialog-close', 'x', 'Close dialog', onClose)}
        </Row>

        {/* Layer 5: Floating PTZ & Settings popovers */}
        {ptzOpen && ptzPanel && (
          <Box
            style={{
              layout: { position: 'absolute', inset: { top: px(68), right: px(122) } },
            }}
          >
            {ptzPanel}
          </Box>
        )}

        {settingsOpen && (
          <Box
            style={{
              layout: {
                position: 'absolute',
                inset: { top: px(72), right: px(24), bottom: px(96) },
                width: px(350),
                padding: insets(20),
                overflowY: 'scroll',
                minHeight: px(0),
              },
              material: new SolidMaterial(rgba(21, 21, 21, 0.97)),
              border: { width: 1, color: rgba(255, 255, 255, 0.12) },
              corners: corners(24),
            }}
          >
            {settingsPanel}
          </Box>
        )}
      </Box>
    </HausDialog>
  );
}
