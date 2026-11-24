/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, CheckboxInput, HausButton, SelectInput, Text, TextInput } from '@haus/ui';
import { ShieldCheck } from 'lucide-react';
import { Dialog } from '@haus/ui/components';
import type { ServerSshInput, ServerTerminalEvent } from '../../../../shared/terminal';
import type { ServerRoom } from './server-rooms';

export function ServerSshAddDialog({
  rooms,
  onClose,
  onAdded,
}: {
  rooms: ServerRoom[];
  onClose: () => void;
  onAdded: (serverId: string, name: string, areaId: string) => void | Promise<void>;
}) {
  const [profile, setProfile] = useState<ServerSshInput>(() => ({
    serverId: `ssh:${crypto.randomUUID()}`,
    host: '',
    port: 22,
    username: '',
    environment: 'native',
    auth: 'password',
    rememberPassword: true,
  }));
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState(rooms[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<{ fingerprint: string; changed: boolean }>();
  const sessionId = useRef<string | undefined>(undefined);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const nameRef = useRef(name);
  nameRef.current = name;
  const areaIdRef = useRef(areaId);
  areaIdRef.current = areaId;
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const native = window.hausNative;
    if (!native?.onServerTerminal) return;
    return native.onServerTerminal((event: ServerTerminalEvent) => {
      if (event.sessionId !== sessionId.current) return;
      if (event.type === 'host-key') {
        setChallenge({ fingerprint: event.fingerprint, changed: event.changed });
        setBusy(false);
      } else if (event.type === 'status' && event.state === 'connected') {
        const current = profileRef.current;
        const displayName = nameRef.current.trim() || `${current.username}@${current.host}`;
        setBusy(false);
        setProfile((value) => ({ ...value, password: undefined }));
        void native
          .serverTerminalClose(event.sessionId)
          .then(() => onAddedRef.current(current.serverId, displayName, areaIdRef.current))
          .then(() => onCloseRef.current())
          .catch((reason) =>
            setError(
              reason instanceof Error ? reason.message : 'The SSH server could not be added.',
            ),
          );
      } else if (event.type === 'status' && event.state === 'disconnected') {
        setBusy(false);
        setError(event.message || 'Could not connect to this SSH server.');
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (sessionId.current) void window.hausNative?.serverTerminalClose(sessionId.current);
    },
    [],
  );

  const connect = async (trustFingerprint?: string) => {
    const native = window.hausNative;
    if (!native) {
      setError('SSH connections are available in the Haus desktop app.');
      return;
    }
    setError('');
    setChallenge(undefined);
    setBusy(true);
    const id = sessionId.current ?? crypto.randomUUID();
    sessionId.current = id;
    try {
      await native.serverTerminalOpen({
        sessionId: id,
        profile: profileRef.current,
        cols: 80,
        rows: 24,
        ...(trustFingerprint ? { trustFingerprint } : {}),
      });
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : 'Could not start the SSH connection.');
    }
  };

  const change = (patch: Partial<ServerSshInput>) =>
    setProfile((current) => ({ ...current, ...patch }));

  return (
    <Dialog
      title="Add an SSH server"
      className="server-pair-dialog server-ssh-add-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text semantic="p" className="registry-help">
        Connect over SSH to add this machine to your home. Credentials are kept in the system’s
        secure storage. Resource details appear only when the server reports them.
      </Text>
      <Box className="server-terminal-settings">
        <Text semantic="label">
          Name
          <TextInput
            value={name}
            onChange={setName}
            placeholder="Home server"
            maxLength={100}
            disabled={busy}
          />
        </Text>
        <Text semantic="label">
          Host
          <TextInput
            value={profile.host}
            onChange={(value) => change({ host: value })}
            placeholder="192.168.1.20 or server.home"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
          />
        </Text>
        <Text semantic="label" className="server-terminal-port">
          Port
          <TextInput
            inputType="number"
            min={1}
            max={65535}
            value={String(profile.port)}
            onChange={(value) => change({ port: Number(value) })}
            required
            disabled={busy}
          />
        </Text>
        <Text semantic="label">
          Username
          <TextInput
            value={profile.username}
            onChange={(value) => change({ username: value })}
            autoComplete="username"
            required
            disabled={busy}
          />
        </Text>
        <Text semantic="label">
          Authentication
          <SelectInput
            value={profile.auth}
            onChange={(value) => change({ auth: value as 'password' | 'agent' })}
            disabled={busy}
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
              onChange={(value) => change({ password: value || undefined })}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </Text>
        )}
        {rooms.length > 0 && (
          <Text semantic="label">
            Room
            <SelectInput
              value={areaId}
              onChange={setAreaId}
              disabled={busy}
              options={rooms.map((room) => ({ value: room.id, label: room.name }))}
            />
          </Text>
        )}
        <Text semantic="label" className="server-terminal-remember">
          <CheckboxInput
            checked={Boolean(profile.rememberPassword)}
            onChange={(checked) => change({ rememberPassword: checked })}
            disabled={busy}
          />
          Save credentials in secure storage
        </Text>
      </Box>
      {challenge && (
        <Box className="server-terminal-host-key">
          <ShieldCheck size={22} />
          <Box>
            <Text semantic="strong">
              {challenge.changed ? 'The server’s SSH key changed' : 'Verify this server'}
            </Text>
            <Text semantic="p">{challenge.fingerprint}</Text>
            <Text semantic="small">
              Compare this fingerprint with the server administrator before trusting it.
            </Text>
          </Box>
          <HausButton
            variant="secondary"
            isDisabled={busy}
            onPress={() => void connect(challenge.fingerprint)}
          >
            Trust and connect
          </HausButton>
        </Box>
      )}
      {error && (
        <Text semantic="p" className="server-terminal-error" role="alert">
          {error}
        </Text>
      )}
      {!challenge && (
        <Box className="registry-dialog-actions">
          <HausButton variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton
            variant="primary"
            isPending={busy}
            isDisabled={
              !profile.host ||
              !profile.username ||
              (profile.auth === 'password' && !profile.password)
            }
            onPress={() => void connect()}
          >
            Connect and add
          </HausButton>
        </Box>
      )}
      <Text semantic="p" className="server-scope-note">
        A plain SSH connection gives access to the terminal. Haus Hub is required for live
        processor, memory, disk and service measurements.
      </Text>
    </Dialog>
  );
}
