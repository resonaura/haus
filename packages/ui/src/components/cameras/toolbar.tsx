/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode, Ref } from 'react';
import { corners, insets, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Pressable, Row } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';
import { cameraGlass } from './surfaces.js';

export function CameraToolButton({
  id,
  icon,
  label,
  active = false,
  disabled = false,
  circular = false,
  className,
  buttonRef,
  onPress,
}: {
  readonly id?: string;
  readonly icon: UiIconName;
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly circular?: boolean;
  readonly className?: string;
  readonly buttonRef?: Ref<unknown>;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      id={id}
      className={className}
      pressableRef={buttonRef}
      ariaLabel={label}
      ariaPressed={active}
      disabled={disabled}
      onActivate={onPress}
      style={{
        layout: {
          display: 'flex',
          width: px(circular ? 38 : 32),
          height: px(circular ? 38 : 32),
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
        corners: corners(circular ? 999 : 12),
        material: circular
          ? cameraGlass(active ? 0.76 : 0.5)
          : new SolidMaterial(rgba(255, 255, 255, active ? 0.16 : 0)),
        border: { width: circular ? 0.5 : 0, color: rgba(255, 255, 255, active ? 0.36 : 0.12) },
        opacity: disabled ? 0.35 : 1,
        transitionMs: 180,
        states: {
          hover: {
            material: circular ? cameraGlass(0.75) : new SolidMaterial(rgba(255, 255, 255, 0.12)),
          },
          pressed: { transform: { scale: 0.95 } },
        },
      }}
    >
      <Box style={{ pointerEvents: 'none' }}>
        <UiIcon name={icon} size={19} color="#ffffff" />
      </Box>
    </Pressable>
  );
}

export function CameraToolbar({
  className,
  fill,
  muted,
  muteDisabled,
  muteLabel,
  playing,
  extras,
  fullscreen,
  onTogglePlay,
  onToggleMute,
  onToggleFill,
  onToggleFullscreen,
}: {
  readonly className?: string;
  readonly fill: boolean;
  readonly muted?: boolean;
  readonly muteDisabled?: boolean;
  readonly muteLabel?: string;
  readonly playing?: boolean;
  readonly extras?: ReactNode;
  readonly fullscreen?: boolean;
  readonly onTogglePlay?: () => void;
  readonly onToggleMute: () => void;
  readonly onToggleFill: () => void;
  readonly onToggleFullscreen?: () => void;
}) {
  return (
    <Row
      className={className}
      gapPx={0}
      style={{
        layout: { padding: insets(3), flexShrink: 0 },
        material: cameraGlass(0.5),
        border: { width: 0.5, color: rgba(255, 255, 255, 0.05) },
        corners: corners(16),
      }}
    >
      {onTogglePlay && (
        <CameraToolButton
          id="camera-toolbar-play"
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause recording' : 'Play recording'}
          onPress={onTogglePlay}
        />
      )}
      {extras}
      <CameraToolButton
        id="camera-mute-toggle"
        icon={muted || muteDisabled ? 'volume-x' : 'volume-2'}
        label={muteLabel ?? (muted ? 'Unmute camera' : 'Mute camera')}
        disabled={muteDisabled}
        onPress={onToggleMute}
      />
      <CameraToolButton
        id="camera-fill-toggle"
        icon={fill ? 'shrink' : 'scan'}
        label={fill ? 'Fit video inside viewer' : 'Fill viewer with video'}
        active={fill}
        onPress={onToggleFill}
      />
      {onToggleFullscreen && (
        <CameraToolButton
          id="camera-fullscreen-toggle"
          icon={fullscreen ? 'minimize' : 'expand'}
          label={fullscreen ? 'Exit full screen' : 'Full screen camera'}
          onPress={onToggleFullscreen}
        />
      )}
    </Row>
  );
}
