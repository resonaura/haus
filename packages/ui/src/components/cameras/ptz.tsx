/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface CameraPtzControlAvailability {
  readonly up?: boolean;
  readonly down?: boolean;
  readonly left?: boolean;
  readonly right?: boolean;
  readonly zoomIn?: boolean;
  readonly zoomOut?: boolean;
  readonly stop?: boolean;
  readonly home?: boolean;
}

const PTZ_LABELS: Readonly<
  Record<keyof CameraPtzControlAvailability, { readonly id: string; readonly icon: UiIconName; readonly label: string }>
> = {
  up: { id: 'up', icon: 'chevron-up', label: 'Tilt up' },
  down: { id: 'down', icon: 'chevron-down', label: 'Tilt down' },
  left: { id: 'left', icon: 'chevron-left', label: 'Pan left' },
  right: { id: 'right', icon: 'chevron-right', label: 'Pan right' },
  zoomIn: { id: 'zoom-in', icon: 'zoom-in', label: 'Zoom in' },
  zoomOut: { id: 'zoom-out', icon: 'zoom-out', label: 'Zoom out' },
  stop: { id: 'stop', icon: 'square', label: 'Stop movement' },
  home: { id: 'home', icon: 'house', label: 'Go to home position' },
};

export function CameraPtzPanel({
  controls,
  disabled,
  onPress,
}: {
  readonly controls: CameraPtzControlAvailability;
  readonly disabled: boolean;
  readonly onPress: (control: keyof CameraPtzControlAvailability) => void;
}) {
  const hasAny =
    controls.up ||
    controls.down ||
    controls.left ||
    controls.right ||
    controls.zoomIn ||
    controls.zoomOut;
  if (!hasAny) return null;

  const padButton = (
    key: keyof CameraPtzControlAvailability,
    sizePx: number,
    radiusPx: number,
    emphasis = false,
  ) => {
    const enabled = controls[key];
    const spec = PTZ_LABELS[key];
    return (
      <Pressable
        key={key}
        id={`camera-ptz-${spec.id}`}
        ariaLabel={spec.label}
        disabled={disabled || !enabled}
        onActivate={() => onPress(key)}
        style={{
          layout: {
            width: px(sizePx),
            height: px(sizePx),
            alignItems: 'center',
            justifyContent: 'center',
          },
          corners: corners(radiusPx),
          material: new SolidMaterial(rgba(255, 255, 255, emphasis ? 0.14 : 0.08)),
          border: { width: 1, color: rgba(255, 255, 255, 0.12) },
          opacity: disabled || !enabled ? 0.28 : 1,
          states:
            disabled || !enabled
              ? undefined
              : { hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.16)) } },
        }}
      >
        <Box style={{ pointerEvents: 'none' }}>
          <UiIcon name={spec.icon} size={sizePx <= 32 ? 14 : 16} color="rgba(255, 255, 255, 0.94)" />
        </Box>
      </Pressable>
    );
  };

  const spacer = <Box style={{ layout: { width: px(42), height: px(42) } }} />;

  return (
    <Stack
      gapPx={11}
      style={{
        layout: { width: px(208), padding: insets(13) },
        material: new SolidMaterial(rgba(20, 20, 20, 0.88)),
        border: { width: 1, color: rgba(255, 255, 255, 0.14) },
        corners: corners(21),
      }}
    >
      <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600} style={{ typography: { color: rgba(255, 255, 255, 0.82) } }}>
          Camera position
        </Text>
        {controls.home && padButton('home', 30, 11)}
      </Row>

      <Stack align="center" gapPx={5}>
        <Row justify="center" gapPx={5}>
          {spacer}
          {padButton('up', 42, 15)}
          {spacer}
        </Row>
        <Row justify="center" gapPx={5}>
          {padButton('left', 42, 15)}
          {controls.stop ? (
            padButton('stop', 42, 15, true)
          ) : (
            <Row
              align="center"
              justify="center"
              style={{ layout: { width: px(42), height: px(42) } }}
            >
              <Text size={14} style={{ typography: { color: rgba(255, 255, 255, 0.35) } }}>
                ·
              </Text>
            </Row>
          )}
          {padButton('right', 42, 15)}
        </Row>
        <Row justify="center" gapPx={5}>
          {spacer}
          {padButton('down', 42, 15)}
          {spacer}
        </Row>
      </Stack>

      {(controls.zoomOut || controls.zoomIn) && (
        <>
          <Box
            style={{
              layout: { width: pct(100), height: px(1) },
              material: new SolidMaterial(rgba(255, 255, 255, 0.1)),
            }}
          />
          <Row justify="center" gapPx={8}>
            {padButton('zoomOut', 36, 13)}
            {padButton('zoomIn', 36, 13)}
          </Row>
        </>
      )}
    </Stack>
  );
}
