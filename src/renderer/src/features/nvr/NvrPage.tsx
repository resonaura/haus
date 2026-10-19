import { useCallback, useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { DatabaseBackup, HardDrive, Plus, RefreshCw, KeyRound } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { PairNodeDialog } from './PairNodeDialog';
import { NodeList } from './NodeList';
import { nvrRequest, size, type NvrStatus, type NvrNode } from './types';
export function NvrPage({ demo, admin }: { demo: boolean; admin: boolean }) {
  const [status, setStatus] = useState<NvrStatus>(),
    [error, setError] = useState(''),
    [pair, setPair] = useState(false),
    [removing, setRemoving] = useState<NvrNode>(),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (demo) return;
    const next = await nvrRequest<NvrStatus>('GET', '/api/cluster');
    setStatus(next);
    setError('');
  }, [demo]);
  useEffect(() => {
    let active = true,
      pending = false;
    const poll = async () => {
      if (!active || pending || document.visibilityState !== 'visible' || demo) return;
      pending = true;
      try {
        const next = await nvrRequest<NvrStatus>('GET', '/api/cluster');
        if (active) {
          setStatus(next);
          setError('');
        }
      } catch (reason) {
        if (active)
          setError(reason instanceof Error ? reason.message : 'The helper could not be reached.');
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [demo]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nvr-layout">
      <section className="settings-card nvr-intro">
        <span className="settings-icon">
          <HardDrive size={26} />
        </span>
        <h2>More room for your home.</h2>
        <p>
          Your Haus helper works on its own. Add optional nodes to store recordings, serve media and
          keep encrypted recovery copies on other machines.
        </p>
        <div className="nvr-summary">
          <span>{status?.nodes.length ?? 0} nodes</span>
          <span>{status?.nodes.filter((n) => n.enabled && n.online).length ?? 0} connected</span>
          <span>Originals stay on your helper</span>
        </div>
        {demo ? (
          <p className="settings-note">
            Connect a home with the updated Haus add-on to manage real nodes and backups.
          </p>
        ) : (
          <div className="settings-card-actions">
            {admin && (
              <Button onPress={() => setPair(true)} isDisabled={!status}>
                <Plus size={17} />
                Add node
              </Button>
            )}
            <Button variant="ghost" onPress={() => void act(refresh)} isDisabled={busy}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>
        )}
      </section>
      {error && (
        <div className="settings-card" role="alert">
          <h3>Recording service needs attention</h3>
          <p>{error}</p>
          {!status && (
            <p>
              Make sure the updated Haus add-on is installed and running. Existing camera controls
              continue to work.
            </p>
          )}
        </div>
      )}
      {status && (
        <>
          <NodeList
            nodes={status.nodes}
            admin={admin}
            busy={busy}
            onToggle={(node) =>
              void act(() =>
                nvrRequest('PATCH', `/api/cluster/nodes/${node.id}`, { enabled: !node.enabled }),
              )
            }
            onRemove={setRemoving}
          />
          <section className="settings-card">
            <div className="nvr-section-title">
              <DatabaseBackup size={24} />
              <h2>A way back, whenever you need it.</h2>
            </div>
            <p>
              Hourly Haus configuration snapshots and daily Home Assistant configuration/app
              backups. Keep 24 Haus snapshots and 7 HA backups; encrypted copies synchronize to
              every connected node.
            </p>
            <p className="settings-note">
              Shared home layout is saved on the helper. Recovery keys stay separate from worker
              nodes. HA camera media is excluded from configuration backups.
            </p>
            {admin && (
              <div className="nvr-backup-actions">
                <Button
                  variant="secondary"
                  isDisabled={busy || status.backups.busy}
                  onPress={() =>
                    void act(() => nvrRequest('POST', '/api/backups/create', { kind: 'haus' }))
                  }
                >
                  Back up Haus
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={busy || status.backups.busy}
                  onPress={() =>
                    void act(() => nvrRequest('POST', '/api/backups/create', { kind: 'ha' }))
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
                    })
                  }
                >
                  <KeyRound size={16} />
                  Save recovery kit
                </Button>
              </div>
            )}
            {status.backups.busy && <p role="status">Creating an encrypted backup…</p>}
            {status.backups.error && (
              <p role="alert" className="form-error">
                {status.backups.error}
              </p>
            )}
            <div className="nvr-backups-list">
              {status.backups.items.slice(0, 8).map((item) => (
                <div key={item.digest}>
                  <strong>{item.kind === 'ha' ? 'Home Assistant' : 'Haus configuration'}</strong>
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                  <span>{size(item.bytes)}</span>
                </div>
              ))}
            </div>
            {!status.backups.items.length && (
              <p className="settings-note">
                Your first configuration snapshot will appear shortly.
              </p>
            )}
          </section>
        </>
      )}
      {pair && (
        <PairNodeDialog
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
            Original recordings stay on your helper. Existing copies stay on this node; it will stop
            receiving new work. Pause the node instead if you plan to reconnect it.
          </p>
          <div className="registry-dialog-actions">
            <Button variant="ghost" isDisabled={busy} onPress={() => setRemoving(undefined)}>
              Keep connected
            </Button>
            <Button
              variant="danger"
              isPending={busy}
              onPress={() =>
                void act(async () => {
                  await nvrRequest('POST', `/api/cluster/nodes/${removing.id}/remove`, {});
                  setRemoving(undefined);
                })
              }
            >
              Disconnect node
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
