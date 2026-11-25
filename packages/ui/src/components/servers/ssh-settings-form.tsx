/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ServerSshProfileInput } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import {
  HausButton,
  HausSwitch,
  SelectInput,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';

export type { ServerSshProfileInput };

export interface SshSettingsFormProps {
  readonly profile: ServerSshProfileInput;
  readonly configured: boolean;
  readonly showWslEnvironment: boolean;
  readonly loaded: boolean;
  readonly connecting: boolean;
  readonly className?: string;
  readonly onChange: (patch: Partial<ServerSshProfileInput>) => void;
  readonly onSubmit: () => void;
}

const inputStyle: UiStyleSpec = {
  layout: { width: pct(100), height: px(34), padding: insets(0, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(9),
  typography: { size: 12.5, color: colorToken('textPrimary') },
};

export function SshSettingsForm({
  profile,
  configured,
  showWslEnvironment,
  loaded,
  connecting,
  className = 'server-terminal-settings',
  onChange,
  onSubmit,
}: SshSettingsFormProps) {
  return (
    <Stack gapPx={12} className={className} style={{ layout: { width: pct(100) } }}>
      <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600} semantic="label">
          Host
        </Text>
        <TextInput
          id="ssh-settings-host"
          ariaLabel="Host"
          value={profile.host}
          placeholder="192.168.1.10"
          autoComplete="off"
          required
          style={inputStyle}
          onChange={(host) => onChange({ host })}
          onSubmit={onSubmit}
        />
      </Stack>

      <Stack gapPx={4} className="server-terminal-port" style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600} semantic="label">
          Port
        </Text>
        <TextInput
          id="ssh-settings-port"
          ariaLabel="Port"
          inputType="number"
          min={1}
          max={65535}
          value={String(profile.port)}
          required
          style={inputStyle}
          onChange={(value) => {
            if (!value.trim()) return;
            const parsed = Number(value);
            if (Number.isFinite(parsed)) onChange({ port: parsed });
          }}
        />
      </Stack>

      <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600} semantic="label">
          Username
        </Text>
        <TextInput
          id="ssh-settings-username"
          ariaLabel="Username"
          value={profile.username}
          autoComplete="username"
          required
          style={inputStyle}
          onChange={(username) => onChange({ username })}
          onSubmit={onSubmit}
        />
      </Stack>

      <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
        <Text size={12} weight={600} semantic="label">
          Authentication
        </Text>
        <SelectInput
          id="ssh-settings-auth"
          ariaLabel="Authentication"
          value={profile.auth}
          onChange={(value) => onChange({ auth: value === 'agent' ? 'agent' : 'password' })}
          options={[
            { value: 'password', label: 'Password' },
            { value: 'agent', label: 'System SSH agent' },
          ]}
        />
      </Stack>

      {profile.auth === 'password' && (
        <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
          <Text size={12} weight={600} semantic="label">
            Password
          </Text>
          <TextInput
            id="ssh-settings-password"
            ariaLabel="Password"
            inputType="password"
            value={profile.password ?? ''}
            placeholder={configured ? 'Saved in keychain' : 'SSH password'}
            autoComplete="current-password"
            style={inputStyle}
            onChange={(value) => onChange({ password: value || undefined })}
            onSubmit={onSubmit}
          />
        </Stack>
      )}

      {showWslEnvironment && (
        <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
          <Text size={12} weight={600} semantic="label">
            Environment
          </Text>
          <SelectInput
            id="ssh-settings-env"
            ariaLabel="Environment"
            value={profile.environment}
            onChange={(value) => onChange({ environment: value === 'wsl' ? 'wsl' : 'native' })}
            options={[
              { value: 'native', label: 'Windows' },
              { value: 'wsl', label: 'WSL' },
            ]}
          />
        </Stack>
      )}

      <HausSwitch
        id="ssh-settings-remember"
        className="server-terminal-remember"
        checked={Boolean(profile.rememberPassword)}
        label="Save credentials in secure storage"
        onChange={(rememberPassword) => onChange({ rememberPassword })}
      />

      <HausButton
        id="ssh-settings-connect"
        variant="secondary"
        disabled={!loaded || connecting}
        onPress={onSubmit}
      >
        <Text size={12.5} weight={600}>
          Connect
        </Text>
      </HausButton>
    </Stack>
  );
}
