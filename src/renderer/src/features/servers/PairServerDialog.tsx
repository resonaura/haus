import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../components/ui/Dialog';
import { serverRequest } from './server-api';
import { serverManagementId } from './server-connections';
import type { HomeServer } from './types';
export function PairServerDialog({
  onClose,
  onPaired,
  canSubmit = true,
  allowMonitoringOnly = false,
  monitoringOnly = false,
  initialName = '',
  initialUrl = 'https://',
  sshServerId,
  existingServers = [],
}: {
  onClose: () => void;
  onPaired: (nodeId: string) => void | Promise<void>;
  canSubmit?: boolean;
  allowMonitoringOnly?: boolean;
  monitoringOnly?: boolean;
  initialName?: string;
  initialUrl?: string;
  sshServerId?: string;
  existingServers?: HomeServer[];
}) {
  const [name, setName] = useState(initialName),
    [url, setUrl] = useState(initialUrl),
    [key, setKey] = useState('');
  const [storage, setStorage] = useState(!monitoringOnly),
    [stream, setStream] = useState(!monitoringOnly),
    [allowHttp, setAllowHttp] = useState(false);
  const [pairedId, setPairedId] = useState<string>();
  const paired = Boolean(pairedId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      let id = pairedId;
      if (!id) {
        const result = await serverRequest<{
          pairedNodeId?: string;
          nodes?: { id: string; url: string }[];
        }>('POST', '/api/cluster/nodes', {
          name,
          url,
          key,
          roles: [...(storage ? ['storage'] : []), ...(stream ? ['stream'] : [])],
          allowHttp,
          ...(sshServerId ? { sshServerId } : {}),
        });
        id =
          result.pairedNodeId ??
          result.nodes?.find(
            (node) => node.url.replace(/\/$/, '') === new URL(url).href.replace(/\/$/, ''),
          )?.id;
        if (!id)
          throw new Error('The updated server state could not be confirmed. Refresh your servers.');
        setPairedId(id);
      }
      setKey('');
      await onPaired(id);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The server could not be reached.');
    } finally {
      setBusy(false);
    }
  };
  const link = async (server: HomeServer) => {
    if (!sshServerId || !canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      await serverRequest('PATCH', `/api/cluster/nodes/${serverManagementId(server)}`, {
        sshServerId,
      });
      setPairedId(serverManagementId(server));
      await onPaired(serverManagementId(server));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Monitoring could not be connected.');
    } finally {
      setBusy(false);
    }
  };
  const locked = busy || paired;
  return (
    <Dialog
      title={monitoringOnly ? 'Connect server monitoring' : 'Add a server'}
      className="server-pair-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        {monitoringOnly
          ? 'Connect Haus Helper to see this machine’s processor, memory, disks and services alongside its SSH access.'
          : 'See your server’s resources, disks and running services. Choose whether it also helps with cameras and recovery copies.'}
      </p>
      {monitoringOnly && !paired && existingServers.length > 0 && (
        <div className="server-monitoring-options">
          <strong>Use an existing Haus connection</strong>
          {existingServers.map((server) => (
            <Button
              key={server.id}
              variant="secondary"
              isDisabled={busy || !canSubmit}
              onPress={() => void link(server)}
            >
              <span>
                <strong>{server.name}</strong>
                <small>{server.host?.hostname || server.url}</small>
              </span>
            </Button>
          ))}
          <p className="registry-help">Or connect a new helper below.</p>
        </div>
      )}
      <details className="server-setup">
        <summary>Set up your server with Docker</summary>
        <ol>
          <li>
            Save the{' '}
            <a
              href={`https://github.com/resonaura/haus-nvr/blob/main/${monitoringOnly ? 'compose.monitoring.yaml' : 'compose.yaml'}`}
              target="_blank"
              rel="noreferrer"
            >
              Haus {monitoringOnly ? 'monitoring' : 'server'} Compose file
            </a>{' '}
            on the server.
          </li>
          <li>
            Create a unique key with <code>openssl rand -hex 32</code> and save it in{' '}
            <code>.env</code> as <code>HAUS_NODE_KEY</code>
          </li>
          <li>
            Run{' '}
            <code>docker compose{monitoringOnly ? ' -f compose.monitoring.yaml' : ''} up -d</code>,
            then paste that key below.
          </li>
        </ol>
        <p>
          Use HTTPS for a private connection. Plain HTTP is available only for a trusted private
          network.
        </p>
        <p>
          For the physical machine’s complete metrics, add the optional{' '}
          <a
            href="https://github.com/resonaura/haus-nvr/blob/main/docs/server-management.md"
            target="_blank"
            rel="noreferrer"
          >
            host collector
          </a>
          . Haus shows the reporting scope and leaves unsupported details unavailable.
        </p>
      </details>
      <label className="management-field">
        <span>Name</span>
        <input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder="Home server"
          disabled={locked}
        />
      </label>
      <label className="management-field">
        <span>Server address</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://server.home:8098"
          disabled={locked}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="management-field">
        <span>Pairing key</span>
        <input
          type="password"
          maxLength={256}
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={locked}
        />
      </label>
      {!monitoringOnly && (
        <fieldset className="server-role-options" disabled={locked}>
          <legend>Optional camera services</legend>
          <p>
            {allowMonitoringOnly
              ? 'Leave both off to use only system monitoring.'
              : 'Choose at least one role for this connection. System monitoring is included.'}
          </p>
          <label>
            <input
              type="checkbox"
              checked={storage}
              onChange={(e) => setStorage(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Recording storage</strong>
              <small>Store camera recordings and encrypted home recovery copies.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Video streaming</strong>
              <small>
                Relay video, prepare recordings for playback and support Activity assist when
                available.
              </small>
            </span>
          </label>
          <p>
            Activity assist stays off until you enable it for a camera. These roles apply to Haus
            NVR; your other server services keep their own settings.
          </p>
        </fieldset>
      )}
      {monitoringOnly && (
        <p className="registry-help">
          System monitoring only. This connection receives no camera, recording or backup work.
        </p>
      )}
      {url.startsWith('http:') && (
        <label className="registry-check">
          <input
            type="checkbox"
            checked={allowHttp}
            onChange={(e) => setAllowHttp(e.target.checked)}
            disabled={locked}
          />
          <span>
            Allow HTTP on my trusted private network
            <small>
              {monitoringOnly
                ? 'Server metrics are unencrypted in transit.'
                : 'Video is unencrypted in transit. Configuration backups remain encrypted.'}
            </small>
          </span>
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!canSubmit && (
        <p className="registry-help" role="status">
          Reconnect or refresh your servers before connecting another server.
        </p>
      )}
      <div className="registry-dialog-actions">
        <Button variant="ghost" isDisabled={busy} onPress={onClose}>
          Cancel
        </Button>
        <Button
          isPending={busy}
          isDisabled={
            busy ||
            !canSubmit ||
            (!paired &&
              (!name.trim() ||
                key.length < 32 ||
                (!monitoringOnly && !allowMonitoringOnly && !storage && !stream) ||
                (url.startsWith('http:') && !allowHttp)))
          }
          onPress={() => void submit()}
        >
          {paired ? 'Finish connection' : monitoringOnly ? 'Connect monitoring' : 'Connect server'}
        </Button>
      </div>
    </Dialog>
  );
}
