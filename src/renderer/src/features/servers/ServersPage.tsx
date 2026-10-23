import { useState } from 'react';
import { Button } from '@heroui/react';
import { House, Plus, RefreshCw, Server, AlertCircle, ChevronRight } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { PairServerDialog } from './PairServerDialog';
import { confirmStorageLimit, serverRequest } from './server-api';
import { ServerDetail } from './ServerDetail';
import { ServerBackups } from './ServerBackups';
import { useServers } from './useServers';
import { percent, ratio, telemetryIsFresh } from './presentation';
import type { HomeServer } from './types';

export function ServersPage({ demo, admin }: { demo: boolean; admin: boolean }) {
  const { status, cluster, history, error, busy, fresh, now, receivedAt, refresh, act } =
    useServers(demo);
  const [selected, setSelected] = useState<string>();
  const [pair, setPair] = useState(false);
  const [removing, setRemoving] = useState<HomeServer>();
  const server = status?.servers.find((item) => item.id === selected) ?? status?.servers[0];
  return (
    <div className="servers-page">
      <div className="servers-toolbar">
        <div>
          <span className="servers-count">
            {status && !fresh
              ? 'Last known server status'
              : status
                ? `${status.servers.filter((item) => item.online).length} connected`
                : demo
                  ? 'Connect your home to begin'
                  : 'Connecting to your servers…'}
          </span>
          <p>Storage, media and the services behind your home.</p>
        </div>
        {!demo && (
          <div>
            {admin && (
              <Button variant="secondary" onPress={() => setPair(true)} isDisabled={!fresh}>
                <Plus size={17} />
                Add server
              </Button>
            )}
            <Button
              variant="ghost"
              isIconOnly
              aria-label="Refresh servers"
              isDisabled={busy}
              onPress={() => void refresh().catch(() => {})}
            >
              <RefreshCw size={17} />
            </Button>
          </div>
        )}
      </div>
      {(error || (status && !fresh)) && (
        <div className="server-notice" role={error ? 'alert' : 'status'}>
          <AlertCircle size={20} />
          <div>
            <strong>
              {status && !fresh ? 'Server information is out of date' : 'Servers need attention'}
            </strong>
            {error && <p>{error}</p>}
            {status && !fresh && (
              <p>
                Showing last known information
                {receivedAt ? ` from ${new Date(receivedAt).toLocaleTimeString()}` : ''}. Reconnect
                or refresh before making changes.
              </p>
            )}
            {!status && <p>Make sure the updated Haus helper is installed and running.</p>}
          </div>
        </div>
      )}
      {demo && (
        <div className="server-panel server-welcome">
          <Server size={36} />
          <h2>A home for your home servers.</h2>
          <p>
            Connect Home Assistant to see its resources, manage optional servers and keep recovery
            copies together.
          </p>
        </div>
      )}
      {!demo && !status && !error && (
        <div className="server-loading" aria-label="Loading servers" role="status">
          <span />
          <span />
          <span />
        </div>
      )}
      {status && server && (
        <div className="servers-workspace">
          <aside className="server-picker" aria-label="Your servers">
            <h2>
              Your servers <span>{status.servers.length}</span>
            </h2>
            {status.servers.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelected(item.id)}
                aria-pressed={item.id === server.id}
                className={`server-pick ${item.id === server.id ? 'is-selected' : ''}`}
              >
                <span className="server-pick-icon">
                  {item.kind === 'home-assistant' ? <House size={22} /> : <Server size={22} />}
                </span>
                <span className="server-pick-text">
                  <strong>{item.name}</strong>
                  <small>
                    {!fresh
                      ? 'Last known status'
                      : item.enabled === false
                        ? 'Paused'
                        : item.online
                          ? item.kind === 'home-assistant'
                            ? 'Home Assistant'
                            : 'Connected'
                          : 'Offline'}
                  </small>
                  {item.host && telemetryIsFresh(item, fresh, now) && (
                    <span>
                      CPU {percent(item.host.cpu.usage)}
                      <i />
                      RAM {percent(ratio(item.host.memory.usedBytes, item.host.memory.totalBytes))}
                    </span>
                  )}
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            <p className="server-picker-note">
              One place for every server. New servers can help with storage, streaming and activity
              analysis.
            </p>
          </aside>
          <ServerDetail
            key={server.id}
            server={server}
            history={history[server.id] ?? []}
            admin={admin}
            fresh={fresh}
            now={now}
            busy={busy}
            onSaveLimit={(storageLimitBytes) =>
              act(
                () =>
                  serverRequest(
                    'PATCH',
                    server.kind === 'home-assistant'
                      ? '/api/servers/home-assistant'
                      : `/api/cluster/nodes/${server.id}`,
                    { storageLimitBytes },
                  ),
                (next) => confirmStorageLimit(next, server.id, storageLimitBytes),
              )
            }
            onToggle={() =>
              void act(() =>
                serverRequest('PATCH', `/api/cluster/nodes/${server.id}`, {
                  enabled: !server.enabled,
                }),
              ).catch(() => {})
            }
            onRemove={() => setRemoving(server)}
          />
        </div>
      )}
      {cluster && <ServerBackups cluster={cluster} admin={admin} busy={busy || !fresh} act={act} />}
      {pair && (
        <PairServerDialog
          canSubmit={fresh}
          onClose={() => setPair(false)}
          onPaired={() => void refresh().catch(() => {})}
        />
      )}
      {removing && (
        <Dialog
          title={`Disconnect ${removing.name}?`}
          onClose={() => {
            if (!busy) setRemoving(undefined);
          }}
        >
          <p>
            Original recordings stay on your helper. Existing copies stay on this server; it will
            stop receiving new work. Pause it instead if you plan to reconnect it.
          </p>
          <div className="registry-dialog-actions">
            <Button variant="ghost" isDisabled={busy} onPress={() => setRemoving(undefined)}>
              Keep connected
            </Button>
            <Button
              variant="danger"
              isPending={busy}
              isDisabled={!fresh}
              onPress={() =>
                void act(async () => {
                  await serverRequest('POST', `/api/cluster/nodes/${removing.id}/remove`, {});
                  setRemoving(undefined);
                }).catch(() => {})
              }
            >
              Disconnect server
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
