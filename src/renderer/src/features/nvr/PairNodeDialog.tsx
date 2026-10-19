import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../components/ui/Dialog';
import { nvrRequest } from './types';
export function PairNodeDialog({
  onClose,
  onPaired,
}: {
  onClose: () => void;
  onPaired: () => void;
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
    setBusy(true);
    setError('');
    try {
      await nvrRequest('POST', '/api/cluster/nodes', {
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
      setError(reason instanceof Error ? reason.message : 'The node could not be reached.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Add an NVR node"
      className="nvr-pair-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        Run Haus NVR on another machine, then pair it with this home. Your helper keeps the original
        recordings and configuration.
      </p>
      <details className="nvr-setup">
        <summary>Set up the Docker node</summary>
        <ol>
          <li>Save the Haus NVR Compose file on the node.</li>
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
          placeholder="Office storage"
          disabled={busy}
        />
      </label>
      <label className="management-field">
        <span>Node address</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://nvr.home:8098"
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
      <div className="nvr-role-options">
        <label>
          <input
            type="checkbox"
            checked={storage}
            onChange={(e) => setStorage(e.target.checked)}
            disabled={busy}
          />
          Store recordings
        </label>
        <label>
          <input
            type="checkbox"
            checked={stream}
            onChange={(e) => setStream(e.target.checked)}
            disabled={busy}
          />
          Serve media to your devices
        </label>
      </div>
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
      <div className="registry-dialog-actions">
        <Button variant="ghost" isDisabled={busy} onPress={onClose}>
          Cancel
        </Button>
        <Button
          isPending={busy}
          isDisabled={
            busy ||
            !name.trim() ||
            key.length < 32 ||
            (!storage && !stream) ||
            (url.startsWith('http:') && !allowHttp)
          }
          onPress={() => void submit()}
        >
          Connect node
        </Button>
      </div>
    </Dialog>
  );
}
