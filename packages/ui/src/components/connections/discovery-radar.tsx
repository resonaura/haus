/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { OnboardingDiscoveredFlow } from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
} from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  GlassRim,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../primitives/index.js';
import { BrandIcon, ManagementGlassCard, ManagementStatusPill } from '../brand/index.js';
import { UiIcon } from '../icon.js';

const RADAR_DISC_SIZE = 206;

const RADAR_BLIP_POSITIONS: readonly { readonly leftPct: number; readonly topPct: number }[] = [
  { leftPct: 73, topPct: 24 },
  { leftPct: 22, topPct: 30 },
  { leftPct: 76, topPct: 68 },
  { leftPct: 24, topPct: 72 },
  { leftPct: 50, topPct: 16 },
  { leftPct: 50, topPct: 84 },
];

const RADAR_ECHO_POSITIONS: readonly { readonly leftPct: number; readonly topPct: number }[] = [
  { leftPct: 70, topPct: 30 },
  { leftPct: 28, topPct: 66 },
  { leftPct: 62, topPct: 72 },
];

function RadarRing({
  sizePx,
  borderOpacity,
}: {
  readonly sizePx: number;
  readonly borderOpacity: number;
}) {
  const offset = Math.round((RADAR_DISC_SIZE - sizePx) / 2);
  return (
    <Box
      ariaHidden
      style={{
        layout: {
          position: 'absolute',
          inset: { top: px(offset), left: px(offset) },
          width: px(sizePx),
          height: px(sizePx),
        },
        border: { width: 1, color: mixColor(transparentColor, colorToken('ink'), borderOpacity) },
        corners: corners(999, 'round'),
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * Shared Electron-matched live Discovery Radar + "Discovered nearby" quick-setup
 * panel with refined monochrome glass cards (`<GlassRim />`) and clickable `<BrandIcon />` blips.
 */
export function DiscoveryRadarPanel({
  discovered,
  loading = false,
  onRescan,
  onSelectDiscovered,
}: {
  readonly discovered: readonly OnboardingDiscoveredFlow[];
  readonly loading?: boolean;
  readonly onRescan: () => void;
  readonly onSelectDiscovered: (item: OnboardingDiscoveredFlow) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const radarItems = discovered.slice(0, RADAR_BLIP_POSITIONS.length);
  const discBg = mixColor(transparentColor, colorToken('ink'), 0.03);
  const sweepTint = dark ? rgba(52, 211, 153, 0.16) : rgba(16, 185, 129, 0.14);
  const axisColor = mixColor(transparentColor, colorToken('ink'), dark ? 0.08 : 0.07);
  const statusDotColor = rgba(52, 211, 153, 1);

  return (
    <ManagementGlassCard
      radius={24}
      padding={insets(18)}
      style={{ layout: { width: pct(100) } }}
      ariaLabel="Nearby discovered devices"
    >
      <Row align="start" gapPx={20} wrap style={{ layout: { width: pct(100) } }}>
        <Stack
          align="center"
          gapPx={10}
          style={{ layout: { width: px(228), flexShrink: 0, alignItems: 'center' } }}
        >
          <Box
            ariaHidden={radarItems.length === 0}
            style={{
              layout: {
                position: 'relative',
                width: px(RADAR_DISC_SIZE),
                height: px(RADAR_DISC_SIZE),
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              },
              material: new GradientMaterial(
                [
                  { offset: 0, color: sweepTint },
                  { offset: 0.58, color: discBg },
                  { offset: 1, color: discBg },
                ],
                0,
                'radial',
                undefined,
                { centerX: 0.5, centerY: 0.5, shape: 'circle' },
              ),
              border: {
                width: 1,
                color: mixColor(transparentColor, colorToken('ink'), dark ? 0.14 : 0.12),
              },
              corners: corners(999, 'round'),
            }}
          >
            <RadarRing sizePx={164} borderOpacity={dark ? 0.12 : 0.1} />
            <RadarRing sizePx={116} borderOpacity={dark ? 0.1 : 0.09} />
            <RadarRing sizePx={68} borderOpacity={dark ? 0.11 : 0.09} />

            <Box
              ariaHidden
              style={{
                layout: {
                  position: 'absolute',
                  inset: { top: px(RADAR_DISC_SIZE / 2), left: px(12), right: px(12) },
                  height: px(1),
                },
                material: new SolidMaterial(axisColor),
                pointerEvents: 'none',
              }}
            />
            <Box
              ariaHidden
              style={{
                layout: {
                  position: 'absolute',
                  inset: { left: px(RADAR_DISC_SIZE / 2), top: px(12), bottom: px(12) },
                  width: px(1),
                },
                material: new SolidMaterial(axisColor),
                pointerEvents: 'none',
              }}
            />

            <Box
              ariaHidden
              motion={{
                animate: { scale: [0.65, 1.35], opacity: [0.42, 0] },
                durationMs: 2800,
                ease: 'easeOut',
                repeat: 'Infinity',
              }}
              style={{
                layout: {
                  position: 'absolute',
                  inset: { top: px(43), left: px(43) },
                  width: px(120),
                  height: px(120),
                },
                border: { width: 1, color: rgba(52, 211, 153, 0.45) },
                corners: corners(999, 'round'),
                pointerEvents: 'none',
              }}
            />

            <Box
              style={{
                layout: {
                  width: px(34),
                  height: px(34),
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2,
                },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(999, 'round'),
              }}
            >
              <UiIcon name="radar" size={16} />
            </Box>

            {radarItems.length > 0
              ? radarItems.map((item, idx) => {
                  const pos = RADAR_BLIP_POSITIONS[idx]!;
                  const leftPx = Math.round((RADAR_DISC_SIZE * pos.leftPct) / 100) - 18;
                  const topPx = Math.round((RADAR_DISC_SIZE * pos.topPct) / 100) - 18;
                  return (
                    <Pressable
                      key={item.flowId}
                      id={`radar-blip-${item.flowId}`}
                      ariaLabel={`Set up ${item.label}`}
                      onActivate={() => onSelectDiscovered(item)}
                      style={{
                        layout: {
                          position: 'absolute',
                          inset: { left: px(leftPx), top: px(topPx) },
                          width: px(36),
                          height: px(36),
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'visible',
                          zIndex: 3,
                        },
                        material: new SolidMaterial(transparentColor),
                        border: { width: 0, style: 'none', color: transparentColor },
                      }}
                    >
                      <Box
                        ariaHidden
                        motion={{
                          animate: { scale: [0.92, 1.24], opacity: [0.55, 0] },
                          durationMs: 2400,
                          delayMs: idx * 350,
                          ease: 'easeOut',
                          repeat: 'Infinity',
                        }}
                        style={{
                          layout: {
                            position: 'absolute',
                            inset: insets(-4),
                            width: px(44),
                            height: px(44),
                          },
                          border: {
                            width: 1.5,
                            color: rgba(52, 211, 153, 0.38),
                          },
                          corners: corners(12),
                          pointerEvents: 'none',
                        }}
                      />
                      <BrandIcon
                        kind="integration"
                        id={item.domain}
                        size={34}
                        hint={{ name: item.title }}
                      />
                    </Pressable>
                  );
                })
              : RADAR_ECHO_POSITIONS.map((pos, idx) => {
                  const leftPx = Math.round((RADAR_DISC_SIZE * pos.leftPct) / 100) - 4;
                  const topPx = Math.round((RADAR_DISC_SIZE * pos.topPct) / 100) - 4;
                  return (
                    <Box
                      key={`echo-${idx}`}
                      ariaHidden
                      style={{
                        layout: {
                          position: 'absolute',
                          inset: { left: px(leftPx), top: px(topPx) },
                          width: px(8),
                          height: px(8),
                        },
                        material: new SolidMaterial(rgba(52, 211, 153, 0.55)),
                        corners: corners(999, 'round'),
                        pointerEvents: 'none',
                      }}
                    />
                  );
                })}
            <GlassRim preset="circle" radiusPx={RADAR_DISC_SIZE / 2} opacity={0.42} />
          </Box>

          <Row align="center" gapPx={7}>
            <Box
              ariaHidden
              style={{
                layout: { width: px(7), height: px(7), flexShrink: 0 },
                material: new SolidMaterial(statusDotColor),
                corners: corners(999, 'round'),
              }}
            />
            <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, align: 'center' } }}>
              {discovered.length > 0
                ? `${discovered.length} ${discovered.length === 1 ? 'device' : 'devices'} broadcasting nearby`
                : 'Scanning mDNS, Matter, BLE & HomeKit…'}
            </Text>
          </Row>
        </Stack>

        <Stack gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(250) } }}>
          <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
            <Row align="center" gapPx={8}>
              <Heading level={3} size={14.5} weight={600}>
                Discovered nearby
              </Heading>
              <ManagementStatusPill
                label={String(discovered.length)}
                tone={discovered.length > 0 ? 'success' : 'neutral'}
              />
            </Row>
            <HausButton
              id="add-device-rescan"
              variant="outline"
              size="sm"
              disabled={loading}
              onPress={onRescan}
            >
              <UiIcon name="refresh-cw" size={12.5} />
              <Text size={12}>{loading ? 'Scanning…' : 'Rescan'}</Text>
            </HausButton>
          </Row>

          {discovered.length > 0 ? (
            <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
              {discovered.map((item) => (
                <ManagementGlassCard
                  key={item.flowId}
                  radius={16}
                  padding={insets(10, 12)}
                  interactive
                  style={{ layout: { width: pct(100) } }}
                >
                  <Row
                    align="center"
                    justify="between"
                    gapPx={12}
                    style={{ layout: { width: pct(100) } }}
                  >
                    <Row
                      align="center"
                      gapPx={10}
                      style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                    >
                      <BrandIcon
                        kind="integration"
                        id={item.domain}
                        size={40}
                        hint={{
                          name: item.title,
                          ...(item.source ? { category: item.source } : {}),
                        }}
                      />
                      <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                        <Row align="center" gapPx={6} wrap>
                          <Text
                            size={13}
                            weight={600}
                            style={{
                              typography: { size: 13, weight: 600, maxLines: 1, truncate: true },
                            }}
                          >
                            {item.label}
                          </Text>
                          <ManagementStatusPill label={item.sourceLabel} tone="neutral" />
                        </Row>
                        <Text
                          size={11.5}
                          tone="muted"
                          style={{ typography: { size: 11.5, maxLines: 1, truncate: true } }}
                        >
                          {item.title}
                        </Text>
                      </Stack>
                    </Row>
                    <HausButton
                      id={`add-device-discovered-${item.flowId}`}
                      variant="primary"
                      size="sm"
                      onPress={() => onSelectDiscovered(item)}
                    >
                      <Text
                        size={12}
                        style={{
                          typography: {
                            size: 12,
                            weight: 600,
                            color: colorToken('accentForeground'),
                          },
                        }}
                      >
                        Set up
                      </Text>
                    </HausButton>
                  </Row>
                </ManagementGlassCard>
              ))}
            </Stack>
          ) : (
            <Stack
              gapPx={4}
              style={{
                layout: {
                  width: pct(100),
                  padding: insets(16),
                },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              <Text size={13} weight={600}>
                {loading ? 'Listening for nearby devices…' : 'No unconfigured broadcasts waiting'}
              </Text>
              <Text size={12} tone="muted" style={{ typography: { size: 12, lineHeight: 1.45 } }}>
                Power on any Matter, HomeKit, Bluetooth, mDNS, or MQTT device and it will appear on
                the radar, or choose a setup method below.
              </Text>
            </Stack>
          )}
        </Stack>
      </Row>
    </ManagementGlassCard>
  );
}
