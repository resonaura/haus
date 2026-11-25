/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { BackdropMaterial, GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausUiThemeScope,
  Pressable,
  ProgressiveBlur,
  Row,
  Text,
} from '../../primitives/index.js';
import { cameraStageBlurStyle, cameraStageCorners } from './surfaces.js';

export type CameraViewMode = 'live' | 'events';

export function CameraSurfaceTheme({ children }: { readonly children: ReactNode }) {
  return <HausUiThemeScope mode="dark">{children}</HausUiThemeScope>;
}

const cameraViews = [
  { value: 'live', label: 'Live' },
  { value: 'events', label: 'Events' },
] as const;

export function CameraViewPicker({
  view,
  className,
  onChange,
}: {
  readonly view: CameraViewMode;
  readonly className?: string;
  readonly onChange: (mode: CameraViewMode) => void;
}) {
  return (
    <Row
      id="camera-modal-tabs"
      role="group"
      ariaLabel="Camera view"
      className={className}
      gapPx={4}
      style={{
        layout: { padding: insets(4) },
        pointerEvents: 'auto',
        material: new BackdropMaterial(
          { blurRadius: 20, tintColor: rgba(22, 22, 22, 0.44) },
          { fallbackColor: rgba(20, 20, 22, 0.96) },
        ),
        border: { width: 1, color: rgba(255, 255, 255, 0.07) },
        corners: corners(20),
      }}
    >
      {cameraViews.map(({ value, label }) => {
        const active = view === value;
        return (
          <Pressable
            key={value}
            id={`camera-view-${value}`}
            ariaPressed={active}
            onActivate={() => onChange(value)}
            style={{
              layout: {
                minWidth: px(90),
                height: px(32),
                padding: insets(0, 14),
                alignItems: 'center',
                justifyContent: 'center',
              },
              corners: corners(16),
              material: new SolidMaterial(rgba(255, 255, 255, active ? 0.08 : 0)),
              transitionMs: 180,
              states: {
                hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.12)) },
                pressed: { transform: { scale: 0.95 } },
              },
            }}
          >
            <Text
              style={{
                pointerEvents: 'none',
                typography: {
                  size: 11,
                  weight: 600,
                  color: rgba(255, 255, 255, active ? 1 : 0.65),
                },
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

export function CameraStageBackdrop() {
  return (
    <>
      <ProgressiveBlur maxRadius={12} style={cameraStageBlurStyle} />
      <Box
        ariaHidden
        style={{
          layout: {
            position: 'absolute',
            inset: { left: px(0), right: px(0), bottom: px(0) },
            height: pct(35),
            maxHeight: px(220),
          },
          pointerEvents: 'none',
          corners: { ...cameraStageCorners, topLeft: 0, topRight: 0 },
          material: new GradientMaterial(
            [
              { offset: 0, color: rgba(0, 0, 0, 0) },
              { offset: 1, color: rgba(0, 0, 0, 0.56) },
            ],
            180,
          ),
        }}
      />
    </>
  );
}
