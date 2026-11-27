/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import {
  sanitizeServerIcon,
  type ServerIdentityPatch,
  type ServerRoomOption,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { insets, pct, px } from '../../ir/geometry.js';
import {
  Grid,
  HausButton,
  Heading,
  Row,
  SelectInput,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { Dialog } from '../dialog.js';
import { UiIcon } from '../icon.js';
import { ServerIconPicker } from './server-icons.js';
import { ServerGlassPanel } from './server-surfaces.js';

/**
 * 100% Electron-matched Server Settings tab:
 * - "At home" identity editor (familiar name, room assignment, automatic/custom OS/distro icon picker)
 * - Connection management (Pause/Resume connection & Disconnect confirmation)
 */
export function ServerSettingsTab({
  server,
  rooms = [],
  busy = false,
  onSaveIdentity,
  onToggleEnabled,
  onRemoveServer,
}: {
  readonly server: ServerSummaryRecord;
  readonly rooms?: readonly ServerRoomOption[];
  readonly busy?: boolean;
  readonly onSaveIdentity?: (patch: ServerIdentityPatch) => void | Promise<void>;
  readonly onToggleEnabled?: () => void;
  readonly onRemoveServer?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(server.name);
  const [areaId, setAreaId] = useState(server.roomId ?? '');
  const [icon, setIcon] = useState(() => sanitizeServerIcon(server.icon));
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  const identityChanged =
    name.trim() !== server.name ||
    areaId !== (server.roomId ?? '') ||
    icon !== sanitizeServerIcon(server.icon);

  const canManageConnection =
    server.kind === 'nvr' || (server.kind === 'hub' && !server.local) || server.kind === 'ssh';

  const submitIdentity = () => {
    if (!onSaveIdentity || savingIdentity || !name.trim() || !identityChanged) return;
    setSavingIdentity(true);
    setIdentityError('');
    setSavedNotice(false);
    void Promise.resolve()
      .then(() =>
        onSaveIdentity({
          name: name.trim(),
          areaId: areaId || undefined,
          icon: icon || undefined,
          favorite: server.favorite,
        }),
      )
      .then(() => setSavedNotice(true))
      .catch(() => setIdentityError('Your server details could not be saved. Try again.'))
      .finally(() => setSavingIdentity(false));
  };

  const confirmRemove = () => {
    if (!onRemoveServer || disconnecting) return;
    setDisconnecting(true);
    setDisconnectError('');
    void Promise.resolve()
      .then(() => onRemoveServer())
      .then(() => setConfirmDisconnect(false))
      .catch((err: unknown) => {
        setDisconnectError(
          err instanceof Error ? err.message : 'This server could not be disconnected.',
        );
      })
      .finally(() => setDisconnecting(false));
  };

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      {onSaveIdentity && (
        <ServerGlassPanel padding={insets(24)} radius={24}>
          <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
            <Stack gapPx={4}>
              <Heading level={3} size={16} weight={600}>
                At home
              </Heading>
              <Text size={12} tone="muted">
                Choose a familiar name, room and icon for this server.
              </Text>
            </Stack>

            <Grid columns={2} minColumnWidthPx={220} gapPx={14}>
              <Stack gapPx={6}>
                <Text size={12} weight={500}>
                  Name
                </Text>
                <TextInput
                  id="server-identity-name"
                  ariaLabel="Server name"
                  value={name}
                  maxLength={100}
                  disabled={savingIdentity}
                  onChange={(val) => {
                    setName(val);
                    setSavedNotice(false);
                  }}
                  onSubmit={submitIdentity}
                />
              </Stack>

              <Stack gapPx={6}>
                <Text size={12} weight={500}>
                  Room
                </Text>
                <SelectInput
                  id="server-identity-room"
                  ariaLabel="Server room"
                  value={areaId}
                  disabled={savingIdentity}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...rooms.map((room) => ({ value: room.id, label: room.name })),
                  ]}
                  onChange={(val: string) => {
                    setAreaId(val);
                    setSavedNotice(false);
                  }}
                />
              </Stack>
            </Grid>

            <ServerIconPicker
              server={server}
              value={icon}
              disabled={savingIdentity}
              onChange={(next) => {
                setIcon(next);
                setSavedNotice(false);
              }}
            />

            {identityError && (
              <Text size={12} tone="critical" role="alert">
                {identityError}
              </Text>
            )}

            <Row align="center" justify="end" gapPx={10}>
              {savedNotice && !identityChanged && (
                <Row align="center" gapPx={5}>
                  <UiIcon name="check" size={14} />
                  <Text size={12} tone="muted">
                    Saved
                  </Text>
                </Row>
              )}
              <HausButton
                id="server-identity-save"
                variant={identityChanged ? 'primary' : 'secondary'}
                size="sm"
                disabled={savingIdentity || !identityChanged || !name.trim()}
                onPress={submitIdentity}
              >
                <Text size={12}>{savingIdentity ? 'Saving…' : 'Save details'}</Text>
              </HausButton>
            </Row>
          </Stack>
        </ServerGlassPanel>
      )}

      {canManageConnection && (onToggleEnabled || onRemoveServer) && (
        <ServerGlassPanel padding={insets(24)} radius={24}>
          <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
            <Stack gapPx={4}>
              <Heading level={3} size={16} weight={600}>
                Connection
              </Heading>
              <Text size={12} tone="muted">
                {server.kind === 'nvr' || server.kind === 'hub' || server.managedId
                  ? 'Pause this Haus connection, or remove it from your home. The server’s other services keep running.'
                  : 'Remove this SSH connection from your home. The server and its files are not changed.'}
              </Text>
            </Stack>

            <Row align="center" gapPx={10} wrap>
              {onToggleEnabled &&
                (server.kind === 'nvr' || server.kind === 'hub' || Boolean(server.managedId)) && (
                  <HausButton
                    id="server-connection-toggle"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onPress={onToggleEnabled}
                  >
                    <Row align="center" gapPx={6}>
                      <UiIcon name={server.enabled ? 'pause' : 'play'} size={14} />
                      <Text size={12}>
                        {server.enabled ? 'Pause connection' : 'Resume connection'}
                      </Text>
                    </Row>
                  </HausButton>
                )}

              {onRemoveServer && (
                <HausButton
                  id="server-connection-disconnect"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onPress={() => {
                    setDisconnectError('');
                    setConfirmDisconnect(true);
                  }}
                >
                  <Row align="center" gapPx={6}>
                    <UiIcon name="unplug" size={14} />
                    <Text size={12}>Disconnect</Text>
                  </Row>
                </HausButton>
              )}
            </Row>
          </Stack>
        </ServerGlassPanel>
      )}

      {confirmDisconnect && (
        <Dialog
          title={`Disconnect ${server.name}?`}
          onClose={() => {
            if (!disconnecting) setConfirmDisconnect(false);
          }}
        >
          <Stack gapPx={14} style={{ layout: { minWidth: px(320) } }}>
            <Text size={12.5} tone="muted" style={{ typography: { lineHeight: 1.5 } }}>
              Haus stops connecting to this server and removes it from your home’s server list. The
              server itself and its files keep running unchanged.
            </Text>
            {disconnectError && (
              <Text size={12} tone="critical" role="alert">
                {disconnectError}
              </Text>
            )}
            <Row align="center" justify="end" gapPx={8}>
              <HausButton
                variant="ghost"
                size="sm"
                disabled={disconnecting}
                onPress={() => setConfirmDisconnect(false)}
              >
                <Text size={12}>Keep connected</Text>
              </HausButton>
              <HausButton
                variant="danger"
                size="sm"
                disabled={disconnecting}
                onPress={confirmRemove}
              >
                <Text size={12}>{disconnecting ? 'Disconnecting…' : 'Disconnect server'}</Text>
              </HausButton>
            </Row>
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
}
