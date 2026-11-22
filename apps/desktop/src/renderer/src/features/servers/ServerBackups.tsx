/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
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
    <section className="server-panel server-backups">
      <div className="server-section-heading">
        <div>
          <h3>
            <DatabaseBackup size={19} />
            Home recovery
          </h3>
          <p>
            Home-wide backups of Haus and Home Assistant, shared with connected NVR storage servers.
          </p>
        </div>
      </div>
      <p className="server-muted">
        Hourly Haus snapshots and daily Home Assistant backups. Keep 24 Haus snapshots and 7 HA
        backups; recovery keys stay separate from worker servers.
      </p>
      {admin && (
        <div className="server-backup-actions">
          <Button
            variant="secondary"
            isDisabled={busy || backupBusy}
            onPress={() =>
              void act(() => serverRequest('POST', '/api/backups/create', { kind: 'haus' })).catch(
                () => {},
              )
            }
          >
            Back up Haus
          </Button>
          <Button
            variant="secondary"
            isDisabled={busy || backupBusy}
            onPress={() =>
              void act(() => serverRequest('POST', '/api/backups/create', { kind: 'ha' })).catch(
                () => {},
              )
            }
          >
            Back up Home Assistant
          </Button>
          <Button
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
          </Button>
        </div>
      )}
      {backupBusy && <p role="status">Creating an encrypted backup…</p>}
      {backupError && (
        <p className="form-error" role="alert">
          {serverErrorMessage(backupError)}
        </p>
      )}
      <div className="server-backup-list">
        {items.slice(0, 8).map((item) => {
          const created = Number.isFinite(item.createdAt) ? new Date(item.createdAt) : null;
          return (
            <div key={item.digest}>
              <strong>{item.kind === 'ha' ? 'Home Assistant' : 'Haus configuration'}</strong>
              <time dateTime={created ? created.toISOString() : undefined}>
                {created ? created.toLocaleString() : 'Unknown time'}
              </time>
              <span>{bytes(item.bytes)}</span>
            </div>
          );
        })}
      </div>
      {!items.length && (
        <p className="server-muted">Your first configuration snapshot will appear shortly.</p>
      )}
    </section>
  );
}
