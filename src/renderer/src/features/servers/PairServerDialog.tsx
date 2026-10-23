import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../components/ui/Dialog';
import { serverRequest } from './server-api';
export function PairServerDialog({
  onClose,
  onPaired,
  canSubmit = true,
}: {
  onClose: () => void;
  onPaired: () => void;
  canSubmit?: boolean;
}) {
  const [name, setName] = useState(''),
    [url, setUrl] = useState('https://'),
    [key, setKey] = useState('');
  const [storage, setStorage] = useState(true),
    [stream, setStream] = useState(true),
    [allowHttp, setAllowHttp] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await serverRequest('POST', '/api/cluster/nodes', {
        name,
        url,
        key,
        roles: [...(storage ? ['storage'] : []), ...(stream ? ['stream'] : [])],
        allowHttp,
      });
      setKey('');
      onPaired();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The server could not be reached.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Add a server"
      className="server-pair-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        Connect a home server to see its resources, disks and running services. This connection uses
        the Haus NVR service; choose which camera and recovery work it can help with below.
      </p>
      <details className="server-setup">
        <summary>Set up your server with Docker</summary>
        <ol>
          <li>Save the Haus NVR Compose file on the server.</li>
          <li>
            Create a unique key with <code>openssl rand -hex 32</code> and save it in{' '}
            <code>.env</code> as <code>HAUS_NODE_KEY</code>
          </li>
          <li>
            Run <code>docker compose up -d</code>, then paste that key below.
          </li>
        </ol>
        <p>
          Use HTTPS for a private connection. Plain HTTP is available only for a trusted private
          network.
        </p>
      </details>
      <label className="management-field">
        <span>Name</span>
        <input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder="Home server"
          disabled={busy}
        />
      </label>
      <label className="management-field">
        <span>Server address</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://server.home:8098"
          disabled={busy}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="management-field">
        <span>Pairing key</span>
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={busy}
        />
      </label>
      <fieldset className="server-role-options">
        <legend>Haus NVR roles</legend>
        <p>Choose at least one role for this connection. System monitoring is included.</p>
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
          Activity assist stays off until you enable it for a camera. These roles apply to Haus NVR;
          your other server services keep their own settings.
        </p>
      </fieldset>
      {url.startsWith('http:') && (
        <label className="registry-check">
          <input
            type="checkbox"
            checked={allowHttp}
            onChange={(e) => setAllowHttp(e.target.checked)}
            disabled={busy}
          />
          <span>
            Allow HTTP on my trusted private network
            <small>Video is unencrypted in transit. Configuration backups remain encrypted.</small>
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
            !name.trim() ||
            key.length < 32 ||
            (!storage && !stream) ||
            (url.startsWith('http:') && !allowHttp)
          }
          onPress={() => void submit()}
        >
          Connect server
        </Button>
      </div>
    </Dialog>
  );
}
