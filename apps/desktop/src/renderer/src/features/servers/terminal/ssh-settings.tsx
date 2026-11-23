/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { CheckboxInput, HausButton, HausForm, SelectInput, Text, TextInput } from '@haus/ui';
import type { ServerSshInput } from '../../../../../shared/terminal';

export interface SshSettingsFormProps {
  readonly profile: ServerSshInput;
  readonly configured: boolean;
  readonly showWslEnvironment: boolean;
  readonly loaded: boolean;
  readonly connecting: boolean;
  readonly onChange: (patch: Partial<ServerSshInput>) => void;
  readonly onSubmit: () => void;
}

export function SshSettingsForm({
  profile,
  configured,
  showWslEnvironment,
  loaded,
  connecting,
  onChange,
  onSubmit,
}: SshSettingsFormProps) {
  return (
    <HausForm className="server-terminal-settings" onSubmit={onSubmit}>
      <Text semantic="label">
        Host
        <TextInput
          value={profile.host}
          onChange={(host) => onChange({ host })}
          placeholder="192.168.1.10"
          autoComplete="off"
          required
        />
      </Text>
      <Text semantic="label" className="server-terminal-port">
        Port
        <TextInput
          inputType="number"
          min={1}
          max={65535}
          value={String(profile.port)}
          onChange={(value) => onChange({ port: Number(value) })}
          required
        />
      </Text>
      <Text semantic="label">
        Username
        <TextInput
          value={profile.username}
          onChange={(username) => onChange({ username })}
          autoComplete="username"
          required
        />
      </Text>
      <Text semantic="label">
        Authentication
        <SelectInput
          value={profile.auth}
          onChange={(value) => onChange({ auth: value as 'password' | 'agent' })}
          options={[
            { value: 'password', label: 'Password' },
            { value: 'agent', label: 'System SSH agent' },
          ]}
        />
      </Text>
      {profile.auth === 'password' && (
        <Text semantic="label">
          Password
          <TextInput
            inputType="password"
            value={profile.password ?? ''}
            placeholder={configured ? 'Saved in keychain' : 'SSH password'}
            onChange={(value) => onChange({ password: value || undefined })}
            autoComplete="current-password"
          />
        </Text>
      )}
      {showWslEnvironment && (
        <Text semantic="label">
          Environment
          <SelectInput
            value={profile.environment}
            onChange={(value) => onChange({ environment: value as 'native' | 'wsl' })}
            options={[
              { value: 'native', label: 'Windows' },
              { value: 'wsl', label: 'WSL' },
            ]}
          />
        </Text>
      )}
      <Text semantic="label" className="server-terminal-remember">
        <CheckboxInput
          checked={Boolean(profile.rememberPassword)}
          onChange={(rememberPassword) => onChange({ rememberPassword })}
        />
        Save credentials in secure storage
      </Text>
      <HausButton type="submit" variant="secondary" isDisabled={!loaded || connecting}>
        Connect
      </HausButton>
    </HausForm>
  );
}
