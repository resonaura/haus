/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DetectedSetupCode } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausSwitch,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

const FIELD_INPUT_STYLE = {
  layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
  material: new SolidMaterial(colorToken('surfaceSecondary')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(10),
  typography: { size: 13, color: colorToken('textPrimary') },
} as const;

export function CommissioningCodeStep({
  rawCode,
  detected,
  demo,
  busy,
  borderColor,
  onCodeChange,
  onStart,
}: {
  readonly rawCode: string;
  readonly detected: DetectedSetupCode;
  readonly demo: boolean;
  readonly busy: boolean;
  readonly borderColor: ReturnType<typeof colorToken>;
  readonly onCodeChange: (code: string) => void;
  readonly onStart: () => void;
}) {
  return (
    <>
      <Text size={12.5} tone="muted">
        Enter a Matter QR payload, 11-digit Matter manual code, 8-digit HomeKit PIN, Improv, or
        vendor setup code.
      </Text>
      <Stack gapPx={6}>
        <Text size={12} weight={600}>
          Setup code or PIN
        </Text>
        <TextInput
          id="commissioning-code-input"
          ariaLabel="Setup code or PIN"
          autoFocus
          value={rawCode}
          placeholder="e.g. MT:Y.K9042C00KA0648G00 or 482-91-635"
          disabled={busy}
          onChange={onCodeChange}
          onSubmit={() => {
            if (detected.valid && !busy) onStart();
          }}
          style={{
            ...FIELD_INPUT_STYLE,
            layout: { width: pct(100), minHeight: px(40), padding: insets(8, 12) },
            corners: corners(12),
            typography: { fontFamily: 'mono', size: 13, color: colorToken('textPrimary') },
          }}
        />
      </Stack>

      {demo && (
        <Row align="center" gapPx={8} wrap>
          <Text size={11.5} tone="muted">
            Quick test:
          </Text>
          <HausButton
            id="commissioning-demo-pin"
            variant="secondary"
            size="sm"
            onPress={() => onCodeChange('482-91-635')}
          >
            <Text size={11.5}>HomeKit PIN</Text>
          </HausButton>
          <HausButton
            id="commissioning-demo-matter"
            variant="secondary"
            size="sm"
            onPress={() => onCodeChange('MT:Y.K9042C00KA0648G00')}
          >
            <Text size={11.5}>Matter QR</Text>
          </HausButton>
        </Row>
      )}

      <Stack
        gapPx={6}
        style={{
          layout: { width: pct(100), padding: insets(12, 14) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: borderColor },
          corners: corners(12),
        }}
      >
        <Row align="center" gapPx={8}>
          <UiIcon
            name={detected.valid ? 'check-circle' : 'key-round'}
            size={15}
            color={detected.valid ? '#34d399' : undefined}
          />
          <Text size={13} weight={600}>
            {detected.label}
          </Text>
        </Row>
        <Text size={12} tone="muted">
          {detected.description}
        </Text>
        {detected.honestLimitation && (
          <Text size={12} tone="accent">
            {detected.honestLimitation}
          </Text>
        )}
      </Stack>
    </>
  );
}

export function CommissioningCredentialsStep({
  ssid,
  password,
  showPassword,
  threadDataset,
  requiresThread,
  saveForReuse,
  busy,
  onChangeSsid,
  onChangePassword,
  onToggleShowPassword,
  onChangeThreadDataset,
  onChangeSaveForReuse,
}: {
  readonly ssid: string;
  readonly password: string;
  readonly showPassword: boolean;
  readonly threadDataset: string;
  readonly requiresThread: boolean;
  readonly saveForReuse: boolean;
  readonly busy: boolean;
  readonly onChangeSsid: (v: string) => void;
  readonly onChangePassword: (v: string) => void;
  readonly onToggleShowPassword: () => void;
  readonly onChangeThreadDataset: (v: string) => void;
  readonly onChangeSaveForReuse: (v: boolean) => void;
}) {
  return (
    <Stack gapPx={12}>
      <Text size={12.5} tone="muted">
        Provide Wi-Fi credentials to provision this accessory onto your local network.
      </Text>
      <Stack gapPx={6}>
        <Text size={12} weight={600}>
          Wi-Fi SSID
        </Text>
        <TextInput
          id="commissioning-wifi-ssid"
          value={ssid}
          placeholder="Home network name"
          disabled={busy}
          onChange={onChangeSsid}
          style={FIELD_INPUT_STYLE}
        />
      </Stack>
      <Stack gapPx={6}>
        <Row justify="between" align="center">
          <Text size={12} weight={600}>
            Wi-Fi password
          </Text>
          <HausButton variant="ghost" size="sm" onPress={onToggleShowPassword}>
            <UiIcon name={showPassword ? 'eye-off' : 'eye'} size={13} />
            <Text size={11.5}>{showPassword ? 'Hide' : 'Show'}</Text>
          </HausButton>
        </Row>
        <TextInput
          id="commissioning-wifi-password"
          inputType={showPassword ? 'text' : 'password'}
          value={password}
          placeholder="Optional if open network"
          disabled={busy}
          onChange={onChangePassword}
          style={FIELD_INPUT_STYLE}
        />
      </Stack>
      {requiresThread && (
        <Stack gapPx={6}>
          <Text size={12} weight={600}>
            Thread active operational dataset (hex)
          </Text>
          <TextInput
            id="commissioning-thread-dataset"
            value={threadDataset}
            placeholder="Optional TLV hex dataset"
            disabled={busy}
            onChange={onChangeThreadDataset}
            style={{
              ...FIELD_INPUT_STYLE,
              typography: { fontFamily: 'mono', size: 12.5, color: colorToken('textPrimary') },
            }}
          />
        </Stack>
      )}
      <Row justify="between" align="center">
        <Text size={12.5}>Save credentials encrypted for future devices</Text>
        <HausSwitch
          id="commissioning-save-creds"
          isSelected={saveForReuse}
          isDisabled={busy}
          onChange={onChangeSaveForReuse}
        />
      </Row>
    </Stack>
  );
}
