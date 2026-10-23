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
  cluster: ClusterStatus;
  admin: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="server-panel server-backups">
      <div className="server-section-heading">
        <div>
          <h3>
            <DatabaseBackup size={19} />A way back.
          </h3>
          <p>Encrypted recovery copies, shared across connected servers.</p>
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
            isDisabled={busy || cluster.backups.busy}
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
            isDisabled={busy || cluster.backups.busy}
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
      {cluster.backups.busy && <p role="status">Creating an encrypted backup…</p>}
      {cluster.backups.error && (
        <p className="form-error" role="alert">
          {serverErrorMessage(cluster.backups.error)}
        </p>
      )}
      <div className="server-backup-list">
        {cluster.backups.items.slice(0, 8).map((item) => (
          <div key={item.digest}>
            <strong>{item.kind === 'ha' ? 'Home Assistant' : 'Haus configuration'}</strong>
            <time dateTime={new Date(item.createdAt).toISOString()}>
              {new Date(item.createdAt).toLocaleString()}
            </time>
            <span>{bytes(item.bytes)}</span>
          </div>
        ))}
      </div>
      {!cluster.backups.items.length && (
        <p className="server-muted">Your first configuration snapshot will appear shortly.</p>
      )}
    </section>
  );
}
