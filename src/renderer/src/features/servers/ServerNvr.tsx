import type { ReactNode } from 'react';
import { Video } from 'lucide-react';
import { StorageLimit } from './StorageLimit';
import type { HomeServer } from './types';

export function ServerNvr({
  server,
  fresh,
  admin,
  busy,
  onSaveLimit,
  backups,
}: {
  server: HomeServer;
  fresh: boolean;
  admin: boolean;
  busy: boolean;
  onSaveLimit: (limit: number | null) => Promise<void>;
  backups?: ReactNode;
}) {
  const live = fresh && server.online && server.enabled !== false;
  const storage = server.roles?.includes('storage');
  const streaming = server.roles?.includes('stream');
  return (
    <>
      <section className="server-panel server-nvr-capabilities">
        <div className="server-section-heading">
          <div>
            <h3>
              <Video size={19} />
              Haus NVR
            </h3>
            <p>
              Camera recording, streaming and recovery copies are separate from this server’s system
              information.
            </p>
          </div>
        </div>
        <div className="server-nvr-role-grid">
          <div>
            <strong>Recording storage</strong>
            <span>{storage ? 'Assigned' : server.roles ? 'Not assigned' : 'Not reported'}</span>
            <p>Store camera recordings and encrypted recovery copies for this home.</p>
          </div>
          <div>
            <strong>Video streaming</strong>
            <span>{streaming ? 'Assigned' : server.roles ? 'Not assigned' : 'Not reported'}</span>
            <p>Relay camera video and help prepare recordings for playback.</p>
          </div>
        </div>
        <div className="server-work" aria-label="NVR work on this server">
          {server.streams && streaming && (
            <span>
              <strong>{live ? `${server.streams.active} / ${server.streams.max}` : '—'}</strong>
              Active streams
            </span>
          )}
          {server.playback && streaming && (
            <span>
              <strong>{live ? `${server.playback.active} / ${server.playback.max}` : '—'}</strong>
              Playback preparation
            </span>
          )}
          {server.analysis && streaming && (
            <span>
              <strong>{live ? `${server.analysis.active} / ${server.analysis.max}` : '—'}</strong>
              Activity assist
            </span>
          )}
          {server.backupCopies !== undefined && (
            <span>
              <strong>{server.backupCopies}</strong>
              {fresh ? 'Recovery copies on this server' : 'Last known recovery copies'}
            </span>
          )}
        </div>
        <p className="server-muted">
          NVR roles are chosen when this server is paired. Activity assist uses compatible streaming
          servers when enabled for a camera.
        </p>
      </section>
      {server.settings && (
        <StorageLimit server={server} admin={admin} busy={busy || !live} onSave={onSaveLimit} />
      )}
      {backups}
    </>
  );
}
