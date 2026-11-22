/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
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
    <form
      className="server-terminal-settings"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        Host
        <input
          value={profile.host}
          onChange={(event) => onChange({ host: event.target.value })}
          placeholder="192.168.1.10"
          autoComplete="off"
          required
        />
      </label>
      <label className="server-terminal-port">
        Port
        <input
          type="number"
          min="1"
          max="65535"
          value={profile.port}
          onChange={(event) => onChange({ port: Number(event.target.value) })}
          required
        />
      </label>
      <label>
        Username
        <input
          value={profile.username}
          onChange={(event) => onChange({ username: event.target.value })}
          autoComplete="username"
          required
        />
      </label>
      <label>
        Authentication
        <select
          value={profile.auth}
          onChange={(event) => onChange({ auth: event.target.value as 'password' | 'agent' })}
        >
          <option value="password">Password</option>
          <option value="agent">System SSH agent</option>
        </select>
      </label>
      {profile.auth === 'password' && (
        <label>
          Password
          <input
            type="password"
            value={profile.password ?? ''}
            placeholder={configured ? 'Saved in keychain' : 'SSH password'}
            onChange={(event) => onChange({ password: event.target.value || undefined })}
            autoComplete="current-password"
          />
        </label>
      )}
      {showWslEnvironment && (
        <label>
          Environment
          <select
            value={profile.environment}
            onChange={(event) => onChange({ environment: event.target.value as 'native' | 'wsl' })}
          >
            <option value="native">Windows</option>
            <option value="wsl">WSL</option>
          </select>
        </label>
      )}
      <label className="server-terminal-remember">
        <input
          type="checkbox"
          checked={profile.rememberPassword}
          onChange={(event) => onChange({ rememberPassword: event.target.checked })}
        />
        Save credentials in secure storage
      </label>
      <Button type="submit" variant="secondary" isDisabled={!loaded || connecting}>
        Connect
      </Button>
    </form>
  );
}
