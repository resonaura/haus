/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Heading, Text } from '@haus/ui';
import { DatabaseBackup, KeyRound } from 'lucide-react';
import { serverRequest, type ClusterStatus } from './server-api';
import { bytes } from './presentation';
import { serverErrorMessage } from './server-errors';

export function ServerBackups({
  cluster,
  admin,
  busy,
  act,
}: {
  cluster: Omit<ClusterStatus, 'backups'> & { backups?: ClusterStatus['backups'] };
  admin: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const backups = cluster.backups;
  const backupBusy = backups?.busy === true;
  const backupError = backups?.error;
  const items = Array.isArray(backups?.items) ? backups.items : [];
  return (
    <Box semantic="section" className="server-panel server-backups">
      <Box className="server-section-heading">
        <Box>
          <Heading level={3}>
            <DatabaseBackup size={19} />
            Home recovery
          </Heading>
          <Text semantic="p">
            Home-wide encrypted backups of your Haus Hub configuration, shared with connected NVR
            storage servers.
          </Text>
        </Box>
      </Box>
      <Text semantic="p" className="server-muted">
        Hourly Haus snapshots and recovery copies; recovery keys stay separate from worker servers.
      </Text>
      {admin && (
        <Box className="server-backup-actions">
          <HausButton
            variant="secondary"
            isDisabled={busy || backupBusy}
            onPress={() =>
              void act(() => serverRequest('POST', '/api/backups/create', { kind: 'haus' })).catch(
                () => {},
              )
            }
          >
            Back up Haus
          </HausButton>
          <HausButton
            variant="ghost"
            isDisabled={busy}
            onPress={() =>
              void act(async () => {
                if (!window.hausNative)
                  throw new Error('Use the desktop app to export a private recovery kit.');
                await window.hausNative.saveRecoveryKit();
              }).catch(() => {})
            }
          >
            <KeyRound size={16} />
            Save recovery kit
          </HausButton>
        </Box>
      )}
      {backupBusy && (
        <Text semantic="p" role="status">
          Creating an encrypted backup…
        </Text>
      )}
      {backupError && (
        <Text semantic="p" className="form-error" role="alert">
          {serverErrorMessage(backupError)}
        </Text>
      )}
      <Box className="server-backup-list">
        {items.slice(0, 8).map((item) => {
          const created = Number.isFinite(item.createdAt) ? new Date(item.createdAt) : null;
          return (
            <Box key={item.digest}>
              <Text semantic="strong">
                {item.kind === 'ha' ? 'Home Assistant' : 'Haus configuration'}
              </Text>
              <Text semantic="time" dateTime={created ? created.toISOString() : undefined}>
                {created ? created.toLocaleString() : 'Unknown time'}
              </Text>
              <Text>{bytes(item.bytes)}</Text>
            </Box>
          );
        })}
      </Box>
      {!items.length && (
        <Text semantic="p" className="server-muted">
          Your first configuration snapshot will appear shortly.
        </Text>
      )}
    </Box>
  );
}
