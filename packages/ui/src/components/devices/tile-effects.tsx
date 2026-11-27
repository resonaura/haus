/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LightEffectMotion, LightEffectOption } from '@haus/core/device';
import {
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
  type ColorValue,
} from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import type { UiMotionSpec } from '../../ir/motion.js';
import type { UiStyleSpec } from '../../ir/node.js';
import { useHausUi } from '../../primitives/context.js';
import { Box, Pressable, Text } from '../../primitives/elements.js';
import {
  buildTileIconOrbStyle,
  buildWashTransitionMotion,
  effectMotionFor,
  getDeviceTileTokens,
  orbEffectMotion,
  parseCssColor,
  WASH_ACTIVATE_MS,
  WASH_DEACTIVATE_MS,
} from './tile-theme.js';

function effectRadialLayer(
  centerX: number,
  centerY: number,
  color: ColorValue,
  alpha: number,
  endOffset: number,
  shape: 'ellipse' | 'circle' = 'ellipse',
  radius?: number,
) {
  return (
    <Box
      ariaHidden
      style={{
        layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
        corners: corners(25),
        pointerEvents: 'none',
        material: new GradientMaterial(
          [
            { offset: 0, color: mixColor(transparentColor, color, alpha) },
            { offset: endOffset, color: transparentColor },
          ],
          0,
          'radial',
          undefined,
          {
            centerX,
            centerY,
            shape,
            ...(radius !== undefined ? { radiusX: radius, radiusY: radius } : {}),
          },
        ),
      }}
    />
  );
}

function effectWashContent(
  effect: LightEffectOption,
  fallbackColor: ColorValue,
  washAlpha: number,
): ReactNode {
  const c1 = parseCssColor(effect.palette[0]) ?? fallbackColor;
  const c2 = parseCssColor(effect.palette[1]) ?? c1;
  const c3 = parseCssColor(effect.palette[2]) ?? c2;

  switch (effect.motion) {
    case 'flicker':
      return (
        <>
          <Box
            ariaHidden
            style={{
              layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
              corners: corners(25),
              pointerEvents: 'none',
              material: new GradientMaterial(
                [
                  { offset: 0, color: mixColor(transparentColor, c1, washAlpha + 0.12) },
                  { offset: 0.52, color: mixColor(transparentColor, c2, 0.14) },
                  { offset: 0.88, color: transparentColor },
                ],
                0,
                'radial',
                undefined,
                { centerX: 0.14, centerY: 0.12, shape: 'ellipse' },
              ),
            }}
          />
          {effectRadialLayer(0.85, 0.92, c3, 0.14, 0.65)}
        </>
      );
    case 'pulse':
      return (
        <>
          <Box
            ariaHidden
            style={{
              layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
              corners: corners(25),
              pointerEvents: 'none',
              material: new GradientMaterial(
                [
                  { offset: 0, color: mixColor(transparentColor, c1, washAlpha + 0.1) },
                  { offset: 0.58, color: mixColor(transparentColor, c2, 0.11) },
                  { offset: 0.94, color: transparentColor },
                ],
                0,
                'radial',
                undefined,
                { centerX: 0.12, centerY: 0.1, shape: 'ellipse' },
              ),
            }}
          />
          {effectRadialLayer(0.88, 0.85, c3, 0.11, 0.68)}
        </>
      );
    case 'rainbow':
    case 'aurora':
      return (
        <>
          {effectRadialLayer(0.24, 0.28, c1, washAlpha + 0.1, 0.56)}
          {effectRadialLayer(0.74, 0.38, c2, washAlpha + 0.08, 0.58)}
          {effectRadialLayer(0.52, 0.82, c3, washAlpha + 0.08, 0.6)}
        </>
      );
    case 'wave':
      return (
        <>
          {effectRadialLayer(0.2, 0.24, c1, washAlpha + 0.11, 0.6)}
          {effectRadialLayer(0.78, 0.72, c2, washAlpha + 0.09, 0.62)}
        </>
      );
    case 'sparkle':
      return (
        <>
          {effectRadialLayer(0.18, 0.2, c1, washAlpha + 0.14, 0.52, 'circle', 0.45)}
          {effectRadialLayer(0.76, 0.3, c2, washAlpha + 0.08, 0.44, 'circle', 0.38)}
          {effectRadialLayer(0.52, 0.8, c3, washAlpha + 0.1, 0.55, 'circle', 0.48)}
        </>
      );
    case 'beat':
      return (
        <>
          {effectRadialLayer(0.18, 0.18, c1, washAlpha + 0.14, 0.62)}
          {effectRadialLayer(0.82, 0.82, c2, washAlpha + 0.11, 0.66)}
        </>
      );
    default:
      return null;
  }
}

type WashPhase = 'idle-off' | 'activating' | 'steady-on' | 'deactivating';

const WASH_CLIP_STYLE: UiStyleSpec = {
  layout: {
    position: 'absolute',
    inset: insets(0),
    width: pct(100),
    height: pct(100),
    overflow: 'hidden',
  },
  corners: corners(25),
  pointerEvents: 'none',
};

export function DeviceTileWash({
  active,
  deviceColor,
  effect,
}: {
  readonly active: boolean;
  readonly deviceColor: ColorValue;
  readonly effect?: LightEffectOption;
}) {
  const { theme, viewport } = useHausUi();
  const tokens = getDeviceTileTokens(theme.mode);
  const [prevActive, setPrevActive] = useState(active);
  const [phase, setPhase] = useState<WashPhase>(() => (active ? 'steady-on' : 'idle-off'));
  const [seq, setSeq] = useState(0);
  const [outputColor, setOutputColor] = useState(deviceColor);
  const currentKey = JSON.stringify(deviceColor);
  const retainedKey = JSON.stringify(outputColor);
  if (active && currentKey !== retainedKey) {
    setOutputColor(deviceColor);
  }
  if (active !== prevActive) {
    setPrevActive(active);
    setSeq((n) => n + 1);
    setPhase(
      viewport.reducedMotion
        ? active
          ? 'steady-on'
          : 'idle-off'
        : active
          ? 'activating'
          : 'deactivating',
    );
  }

  useEffect(() => {
    if (phase !== 'activating' && phase !== 'deactivating') return;
    const ms = (phase === 'activating' ? WASH_ACTIVATE_MS : WASH_DEACTIVATE_MS) + 24;
    const timer = setTimeout(() => {
      setPhase((current) => {
        if (current === 'activating') return 'steady-on';
        if (current === 'deactivating') return 'idle-off';
        return current;
      });
    }, ms);
    return () => clearTimeout(timer);
  }, [phase, seq]);

  const activeColor = active ? deviceColor : outputColor;
  const washMaterial = useMemo(
    () =>
      new GradientMaterial(
        [
          { offset: 0, color: mixColor(transparentColor, activeColor, tokens.deviceWash) },
          { offset: 0.58, color: mixColor(transparentColor, activeColor, 0.06) },
          { offset: 1, color: transparentColor },
        ],
        0,
        'radial',
        undefined,
        { centerX: 0, centerY: 0, shape: 'ellipse' },
      ),
    [activeColor, tokens.deviceWash],
  );

  // Idle OFF culling: zero scene-graph nodes, zero gradients, and zero GPU cost when off at rest.
  if (phase === 'idle-off' && !active) {
    return null;
  }

  const dynamicEffect = active && effect && !effect.isStatic && effect.motion !== 'none';
  if (dynamicEffect) {
    return (
      <Box ariaHidden className="device-tile-wash" style={WASH_CLIP_STYLE}>
        <Box
          key={`fx-${effect.motion}`}
          ariaHidden
          motion={effectMotionFor(effect.motion, viewport.reducedTransparency)}
          style={{
            layout: {
              position: 'absolute',
              inset: insets(0),
              width: pct(100),
              height: pct(100),
            },
            corners: corners(25),
            pointerEvents: 'none',
          }}
        >
          {effectWashContent(effect, activeColor, tokens.deviceWash)}
        </Box>
      </Box>
    );
  }

  // Steady ON fast-path: single unblurred node (blur: 0, no motion controller) during resting scroll.
  if (phase === 'steady-on') {
    return (
      <Box
        ariaHidden
        className="device-tile-wash"
        style={{
          ...WASH_CLIP_STYLE,
          material: washMaterial,
        }}
      />
    );
  }

  const transitionMotion = buildWashTransitionMotion(
    phase === 'activating',
    viewport.reducedTransparency,
  );

  return (
    <Box ariaHidden className="device-tile-wash" style={WASH_CLIP_STYLE}>
      <Box
        ariaHidden
        className="device-tile-wash-inner"
        motion={transitionMotion}
        style={{
          layout: {
            position: 'absolute',
            inset: insets(0),
            width: pct(100),
            height: pct(100),
          },
          corners: corners(25),
          pointerEvents: 'none',
          material: washMaterial,
        }}
      />
    </Box>
  );
}

export function DeviceTileIconOrb({
  id,
  active,
  deviceColor,
  effectMotion,
  ariaLabel,
  disabled,
  onQuick,
  renderIcon,
}: {
  readonly id?: string;
  readonly active: boolean;
  readonly deviceColor: ColorValue;
  readonly effectMotion?: LightEffectMotion;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onQuick?: () => void;
  readonly renderIcon: (color: ColorValue) => ReactNode;
}) {
  const { theme } = useHausUi();
  const [prevActive, setPrevActive] = useState(active);
  const [awakenCount, setAwakenCount] = useState(0);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) setAwakenCount((c) => c + 1);
  }

  const { spec, iconColor } = buildTileIconOrbStyle(theme.mode, active, deviceColor);
  const orbContainerStyle: UiStyleSpec = {
    layout: {
      position: 'relative',
      width: px(32),
      height: px(32),
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    material: new SolidMaterial(transparentColor),
    border: { width: 0, style: 'none', color: transparentColor },
    typography: { color: iconColor },
    corners: corners(999, 'round'),
    transitionMs: 280,
    states: {
      pressed: { transform: { scale: 0.92 } },
    },
  };
  const awakenMotion: UiMotionSpec | undefined =
    awakenCount > 0 && active
      ? {
          initial: { scale: 0.78 },
          animate: { scale: [0.78, 1.12, 1] },
          times: [0, 0.5, 1],
          durationMs: 520,
          ease: [0.16, 1, 0.3, 1],
        }
      : undefined;
  const ambientOrbMotion = active ? orbEffectMotion(effectMotion) : undefined;

  const orbSurface = (
    <Box
      ariaHidden
      motion={ambientOrbMotion}
      style={{
        ...spec,
        layout: {
          position: 'absolute',
          inset: insets(0),
          width: pct(100),
          height: pct(100),
        },
        corners: corners(999, 'round'),
        transitionMs: 280,
        pointerEvents: 'none',
      }}
    />
  );

  const content = (
    <Box
      key={`orb-${awakenCount}`}
      ariaHidden
      motion={awakenMotion}
      style={{
        layout: { alignItems: 'center', justifyContent: 'center' },
        pointerEvents: 'none',
      }}
    >
      {renderIcon(iconColor)}
    </Box>
  );

  if (onQuick) {
    return (
      <Pressable
        id={id}
        className="accessory-icon"
        ariaLabel={ariaLabel}
        disabled={disabled}
        onActivate={onQuick}
        style={orbContainerStyle}
      >
        {orbSurface}
        {content}
      </Pressable>
    );
  }
  return (
    <Box id={id} className="accessory-icon" style={{ ...orbContainerStyle, pointerEvents: 'none' }}>
      {orbSurface}
      {content}
    </Box>
  );
}

export function DeviceTileStateText({
  state,
  stateKey,
  style,
}: {
  readonly state: string;
  readonly stateKey?: string;
  readonly style?: UiStyleSpec;
}) {
  const effectiveKey = stateKey ?? state;
  const [prevKey, setPrevKey] = useState(effectiveKey);
  const [animSeq, setAnimSeq] = useState(0);
  if (effectiveKey !== prevKey) {
    setPrevKey(effectiveKey);
    setAnimSeq((c) => c + 1);
  }
  const arriveMotion: UiMotionSpec | undefined =
    animSeq > 0
      ? {
          initial: { opacity: 0.2, y: 3 },
          animate: { opacity: [0.2, 1], y: [3, 0] },
          durationMs: 320,
          ease: 'easeOut',
        }
      : undefined;

  return (
    <Box key={`st-${animSeq}`} motion={arriveMotion} style={{ layout: { maxWidth: pct(92) } }}>
      <Text className="device-state-text" style={style}>
        {state}
      </Text>
    </Box>
  );
}
