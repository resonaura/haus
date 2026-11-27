/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import {
  Grid,
  HausButton,
  HausSegmentedControl,
  HausSlider,
  HausSwitch,
  Row,
  SelectInput,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';

function ShowcaseCard({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Stack
      gapPx={14}
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      style={{
        layout: { width: pct(100), padding: insets(18), position: 'relative', overflow: 'hidden' },
        material: new SolidMaterial(colorToken('card')),
        border: { width: 1, color: colorToken('borderSubtle') },
        corners: corners(22),
      }}
    >
      <Stack gapPx={2}>
        <Text size={14} weight={600}>
          {title}
        </Text>
        <Text size={11.5} tone="muted">
          {subtitle}
        </Text>
      </Stack>
      {children}
      <GlassRim preset="card" radiusPx={21} opacity={0.46} />
    </Stack>
  );
}

export function StoryboardControlsShowcase() {
  const [swSm, setSwSm] = useState(true);
  const [swMd, setSwMd] = useState(true);
  const [swLg, setSwLg] = useState(true);
  const [swWarm, setSwWarm] = useState(true);
  const [swOff, setSwOff] = useState(false);

  const [vol, setVol] = useState(30);
  const [bright, setBright] = useState(72);
  const [kelvin, setKelvin] = useState(2900);

  const [seg, setSeg] = useState<'auto' | 'heat' | 'cool' | 'off'>('auto');
  const [roomOpt, setRoomOpt] = useState('bedroom');
  const [sampleText, setSampleText] = useState('Evening Atmosphere');

  return (
    <Grid columns={2} gapPx={14}>
      <ShowcaseCard
        title="Switches · Pill Track + Capsule Thumb"
        subtitle="Haus monochrome accent with high-contrast elongated capsule thumb"
      >
        <Row gapPx={18} align="center" wrap>
          <HausSwitch id="sb-switch-sm" size="sm" checked={swSm} label="Small" onChange={setSwSm} />
          <HausSwitch
            id="sb-switch-md"
            size="md"
            checked={swMd}
            label="Enable notifications"
            onChange={setSwMd}
          />
          <HausSwitch id="sb-switch-lg" size="lg" checked={swLg} label="Large" onChange={setSwLg} />
        </Row>
        <Row gapPx={18} align="center" wrap>
          <HausSwitch
            id="sb-switch-off"
            size="md"
            checked={swOff}
            label="Unchecked"
            onChange={setSwOff}
          />
          <HausSwitch
            id="sb-switch-warm"
            size="md"
            checked={swWarm}
            accentColor={rgba(255, 179, 71, 1)}
            label="Lamp tint"
            onChange={setSwWarm}
          />
          <HausSwitch id="sb-switch-disabled" size="md" checked disabled label="Disabled" />
        </Row>
      </ShowcaseCard>

      <ShowcaseCard
        title="Sliders · Capsule Nestled in Active Pill"
        subtitle="22px / 26px full-pill groove with Haus accent fill wrapping the thumb"
      >
        <HausSlider
          id="sb-slider-volume"
          label="Volume"
          valueLabel={String(vol)}
          value={vol}
          min={0}
          max={100}
          onChange={setVol}
        />
        <HausSlider
          id="sb-slider-brightness"
          label="Light output"
          valueLabel={`${bright}%`}
          value={bright}
          min={0}
          max={100}
          size="lg"
          accentColor={rgba(255, 186, 92, 1)}
          onChange={setBright}
        />
        <HausSlider
          id="sb-slider-kelvin"
          label="White warmth"
          valueLabel={`${kelvin} K`}
          value={kelvin}
          min={2000}
          max={6500}
          step={50}
          accentColor={rgba(137, 221, 255, 1)}
          onChange={setKelvin}
        />
      </ShowcaseCard>

      <ShowcaseCard
        title="Buttons & Tactile Variants"
        subtitle="Superellipse surfaces without vertical hover-lift jitter"
      >
        <Row gapPx={8} wrap>
          <HausButton id="sb-btn-primary" variant="primary" size="sm">
            Primary
          </HausButton>
          <HausButton id="sb-btn-secondary" variant="secondary" size="sm">
            Secondary
          </HausButton>
          <HausButton id="sb-btn-outline" variant="outline" size="sm">
            Outline
          </HausButton>
          <HausButton id="sb-btn-ghost" variant="ghost" size="sm">
            Ghost
          </HausButton>
          <HausButton id="sb-btn-glass" variant="glass" size="sm">
            Liquid Glass
          </HausButton>
          <HausButton id="sb-btn-danger-soft" variant="danger-soft" size="sm">
            Danger Soft
          </HausButton>
          <HausButton id="sb-btn-danger" variant="danger" size="sm">
            Danger
          </HausButton>
        </Row>
        <HausSegmentedControl
          id="sb-segmented"
          aria-label="Climate mode preview"
          value={seg}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'heat', label: 'Heat' },
            { value: 'cool', label: 'Cool' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={setSeg}
        />
      </ShowcaseCard>

      <ShowcaseCard
        title="Inputs & Pickers"
        subtitle="Consistent field heights, borders, and focus rings across hosts"
      >
        <TextInput
          id="sb-text-input"
          ariaLabel="Scene title"
          value={sampleText}
          placeholder="Scene title"
          onChange={setSampleText}
          style={{
            layout: { width: pct(100), height: px(36), padding: insets(6, 12) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        />
        <SelectInput
          id="sb-select-input"
          ariaLabel="Room assignment"
          value={roomOpt}
          options={[
            { value: 'bedroom', label: 'Bedroom' },
            { value: 'living', label: 'Living Room' },
            { value: 'studio', label: 'Studio' },
          ]}
          onChange={setRoomOpt}
        />
      </ShowcaseCard>
    </Grid>
  );
}
