/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { LoaderCircle, Radio, Server } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { serverRequest } from './server-api';
import { serverManagementId } from './server-connections';
import type { HomeServer } from './types';
import type { DiscoveredHausNvr } from '../../../../shared/native';
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
  const [attachMode, setAttachMode] = useState(false),
    [grantInput, setGrantInput] = useState(''),
    [coordinatorToken, setCoordinatorToken] = useState('');
  const [storage, setStorage] = useState(!monitoringOnly),
    [stream, setStream] = useState(!monitoringOnly),
    [allowHttp, setAllowHttp] = useState(false);
  const [nearbyNodes, setNearbyNodes] = useState<DiscoveredHausNvr[]>([]);
  const [searchingForNodes, setSearchingForNodes] = useState(true);
  const [pairedId, setPairedId] = useState<string>();
  const paired = Boolean(pairedId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const native = window.hausNative;
    if (!native?.discoverHausNvrNodes || !native.cancelHausNvrDiscovery) {
      setSearchingForNodes(false);
      return;
    }
    let active = true;
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') native.cancelHausNvrDiscovery();
    };
    document.addEventListener('visibilitychange', cancelWhenHidden);
    void native
      .discoverHausNvrNodes()
      .then((nodes) => {
        if (active) setNearbyNodes(nodes);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setSearchingForNodes(false);
      });
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      native.cancelHausNvrDiscovery();
    };
  }, []);
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      let id = pairedId;
      if (!id) {
        const roles = [...(storage ? ['storage'] : []), ...(stream ? ['stream'] : [])];
        if (attachMode) {
          let parsedGrant: Record<string, unknown>;
          const trimmed = grantInput.trim();
          if (trimmed.startsWith('{')) {
            const raw = JSON.parse(trimmed) as unknown;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
              throw new Error('Paste a valid pairing grant JSON object or grant ID.');
            }
            parsedGrant = raw as Record<string, unknown>;
          } else {
            parsedGrant = { grantId: trimmed };
          }
          const attachRes = await serverRequest<{ coordinatorHubId?: string }>(
            'POST',
            '/api/cluster/attach',
            {
              coordinatorUrl: url.trim(),
              grant: parsedGrant,
              ...(name.trim() ? { name: name.trim() } : {}),
              roles: roles.length > 0 ? roles : ['storage', 'stream'],
              ...(coordinatorToken.trim() ? { coordinatorToken: coordinatorToken.trim() } : {}),
            },
          );
          id = attachRes.coordinatorHubId;
        } else {
          const result = await serverRequest<{
            pairedNodeId?: string;
            nodes?: { id: string; url: string }[];
          }>('POST', '/api/cluster/nodes', {
            name,
            url,
            key,
            roles,
            allowHttp,
            ...(sshServerId ? { sshServerId } : {}),
          });
          id =
            result.pairedNodeId ??
            result.nodes?.find(
              (node) => node.url.replace(/\/$/, '') === new URL(url).href.replace(/\/$/, ''),
            )?.id;
        }
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
          ? 'Connect Haus Hub to see this machine’s processor, memory, disks and services alongside its SSH access.'
          : attachMode
            ? 'Join this Hub as a cluster worker under an existing Coordinator Hub using an admin pairing grant.'
            : 'See your server’s resources, disks and running services. Choose whether it also helps with cameras and recovery copies.'}
      </p>
      {!monitoringOnly && !paired && (
        <div className="server-backup-actions">
          <Button
            variant={attachMode ? 'ghost' : 'secondary'}
            isDisabled={busy}
            onPress={() => setAttachMode(false)}
          >
            Add worker Hub
          </Button>
          <Button
            variant={attachMode ? 'secondary' : 'ghost'}
            isDisabled={busy}
            onPress={() => setAttachMode(true)}
          >
            Join existing Coordinator
          </Button>
        </div>
      )}
      <div className="nvr-discovery">
        <div className="discovery-label">
          {searchingForNodes ? (
            <>
              <LoaderCircle className="spin" size={15} />
              Looking for Haus NVR nodes…
            </>
          ) : (
            <>
              <Radio size={15} />
              {nearbyNodes.length ? 'HAUS NVR ON YOUR NETWORK' : 'NO HAUS NVR FOUND'}
            </>
          )}
        </div>
        {nearbyNodes.map((node) => (
          <button
            className="discovered-server"
            type="button"
            key={node.id}
            disabled={locked}
            onClick={() => {
              setName(node.name);
              setUrl(node.url);
            }}
          >
            <span className="home-avatar">
              <Server size={20} />
            </span>
            <span>
              <strong>{node.name}</strong>
              <small>{node.url}</small>
            </span>
          </button>
        ))}
        {!searchingForNodes && nearbyNodes.length === 0 && (
          <p className="registry-help">
            Discovery needs a local network that forwards mDNS. You can still enter the server
            address below.
          </p>
        )}
      </div>
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
              href={`https://github.com/resonaura/haus/blob/main/apps/hub/deploy/${monitoringOnly ? 'monitoring/compose.yaml' : 'compose.yaml'}`}
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
            href="https://github.com/resonaura/haus/blob/main/apps/hub/docs/servers.md"
            target="_blank"
            rel="noreferrer"
          >
            host collector
          </a>
          . Haus shows the reporting scope and leaves unsupported details unavailable.
        </p>
        <p>
          Running Haus Hub on Windows via WSL2? Enable mirrored networking or configure NAT
          forwarding in the{' '}
          <a
            href="https://github.com/resonaura/haus/blob/main/apps/hub/docs/install.md"
            target="_blank"
            rel="noreferrer"
          >
            Hub WSL2 setup guide
          </a>
          .
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
      {attachMode ? (
        <>
          <label className="management-field">
            <span>Pairing grant (JSON or grant ID)</span>
            <input
              maxLength={2048}
              autoComplete="off"
              value={grantInput}
              onChange={(e) => setGrantInput(e.target.value)}
              placeholder='{"grantId":"...","homeId":"..."}'
              disabled={locked}
            />
          </label>
          <label className="management-field">
            <span>Coordinator admin token (optional)</span>
            <input
              type="password"
              maxLength={1024}
              autoComplete="off"
              value={coordinatorToken}
              onChange={(e) => setCoordinatorToken(e.target.value)}
              disabled={locked}
            />
          </label>
        </>
      ) : (
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
      )}
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
              (attachMode
                ? !grantInput.trim() || !url.trim()
                : !name.trim() ||
                  key.length < 32 ||
                  (!monitoringOnly && !allowMonitoringOnly && !storage && !stream) ||
                  (url.startsWith('http:') && !allowHttp)))
          }
          onPress={() => void submit()}
        >
          {paired
            ? 'Finish connection'
            : attachMode
              ? 'Join cluster'
              : monitoringOnly
                ? 'Connect monitoring'
                : 'Connect server'}
        </Button>
      </div>
    </Dialog>
  );
}
