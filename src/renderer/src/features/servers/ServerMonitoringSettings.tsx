import { useState } from 'react';
import { Button } from '@heroui/react';
import { Activity, Unplug } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { serverRequest } from './server-api';
import { serverHasNvr, serverManagementId } from './server-connections';
import type { HomeServer } from './types';

export function ServerMonitoringSettings({
  server,
  supported,
  fresh,
  busy,
  onConnect,
  onChanged,
}: {
  server: HomeServer;
  supported: boolean;
  fresh: boolean;
  busy: boolean;
  onConnect: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [removedId, setRemovedId] = useState<string>();
  const [error, setError] = useState('');
  const connected = Boolean(server.managedId);
  const disconnect = async () => {
    setPending(true);
    setError('');
    try {
      if (removedId !== serverManagementId(server)) {
        await serverRequest('POST', `/api/cluster/nodes/${serverManagementId(server)}/remove`, {});
        setRemovedId(serverManagementId(server));
      }
      await onChanged();
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Monitoring could not be disconnected.');
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <section className="server-panel server-management-actions">
        <div className="server-section-heading">
          <div>
            <h3>
              <Activity size={19} />
              System Monitoring
            </h3>
            <p>
              {connected
                ? serverHasNvr(server)
                  ? 'Haus Helper reports system information and provides the camera services assigned to this machine.'
                  : 'Haus Helper reports this machine’s resources, disks and services. No camera or backup work is assigned.'
                : supported
                  ? 'Add resource, disk and service information to this SSH connection with an optional Haus Helper.'
                  : 'Update Haus Helper in Home Assistant to connect system monitoring for this SSH server.'}
            </p>
          </div>
        </div>
        {!connected && (
          <Button variant="secondary" isDisabled={busy || !fresh || !supported} onPress={onConnect}>
            <Activity size={16} />
            Connect monitoring
          </Button>
        )}
        {connected && !serverHasNvr(server) && (
          <Button variant="ghost" isDisabled={busy || !fresh} onPress={() => setConfirm(true)}>
            <Unplug size={16} />
            Disconnect monitoring
          </Button>
        )}
      </section>
      {confirm && (
        <Dialog
          title="Disconnect system monitoring?"
          onClose={() => {
            if (!pending) setConfirm(false);
          }}
        >
          <p className="registry-help">
            Your SSH connection and saved credentials stay available. Haus stops collecting this
            helper’s metrics; the server’s own services keep running.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="registry-dialog-actions">
            <Button variant="ghost" isDisabled={pending} onPress={() => setConfirm(false)}>
              Keep connected
            </Button>
            <Button variant="danger" isPending={pending} onPress={() => void disconnect()}>
              Disconnect monitoring
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
