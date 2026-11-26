/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausDialog, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import {
  CameraStageBackdrop,
  CameraSurfaceTheme,
  CameraViewPicker,
  type CameraViewMode,
} from './chrome.js';
import { CameraToolbar, CameraToolButton } from './toolbar.js';
import { cameraGlass, cameraStageCorners } from './surfaces.js';

export function CameraModalView({
  title,
  roomName,
  statusTag,
  view,
  hasSelection,
  calendar,
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
  onTogglePlay,
  onToggleFullscreen,
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
  readonly calendar: ReactNode;
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
  readonly onTogglePlay?: () => void;
  readonly onToggleFullscreen?: () => void;
  readonly onTogglePtz: () => void;
  readonly onToggleMute: () => void;
  readonly onToggleFill: () => void;
  readonly onToggleSettings: () => void;
  readonly onDismissDrawers: () => void;
  readonly onClose: () => void;
}) {
  const dialog = (
    <HausDialog size="cover" chromeless title={title} backdrop="blur" onClose={onClose}>
      <Box
        style={{
          layout: { position: 'relative', width: pct(100), height: pct(100), overflow: 'hidden' },
          material: new SolidMaterial(rgba(8, 8, 8, 1)),
          corners: cameraStageCorners,
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

        <CameraStageBackdrop />

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
              pointerEvents: 'auto',
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
                  material: cameraGlass(0.58),
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
          <CameraViewPicker view={view} onChange={onSelectView} />

          {calendar}
        </Stack>

        {/* Layer 4C: Floating top-right toolbar + settings + close */}
        <Row
          align="center"
          gapPx={10}
          style={{ layout: { position: 'absolute', inset: { top: px(20), right: px(24) } } }}
        >
          <CameraToolbar
            fill={fill}
            muted={muted}
            muteDisabled={muteDisabled}
            playing={playing}
            onTogglePlay={hasSelection ? onTogglePlay : undefined}
            onToggleMute={onToggleMute}
            onToggleFill={onToggleFill}
            onToggleFullscreen={onToggleFullscreen}
            extras={
              !hasSelection && hasPtz ? (
                <CameraToolButton
                  id="camera-ptz-toggle"
                  icon="move"
                  label="Camera controls"
                  active={ptzOpen}
                  onPress={onTogglePtz}
                />
              ) : undefined
            }
          />
          <CameraToolButton
            id="camera-settings-toggle"
            icon="settings-2"
            label="Camera settings"
            circular
            active={settingsOpen}
            onPress={onToggleSettings}
          />
          <CameraToolButton
            id="dialog-close"
            icon="x"
            label="Close dialog"
            circular
            onPress={onClose}
          />
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
  return <CameraSurfaceTheme>{dialog}</CameraSurfaceTheme>;
}
