/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import {
  Box,
  CheckboxInput,
  HausButton,
  HausCode,
  HausDisclosure,
  HausLink,
  Pressable,
  Text,
  TextInput,
} from '@haus/ui';
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
      <Text semantic="p" className="registry-help">
        {monitoringOnly
          ? 'Connect Haus Hub to see this machine’s processor, memory, disks and services alongside its SSH access.'
          : attachMode
            ? 'Join this Hub as a cluster worker under an existing Coordinator Hub using an admin pairing grant.'
            : 'See your server’s resources, disks and running services. Choose whether it also helps with cameras and recovery copies.'}
      </Text>
      {!monitoringOnly && !paired && (
        <Box className="server-backup-actions">
          <HausButton
            variant={attachMode ? 'ghost' : 'secondary'}
            isDisabled={busy}
            onPress={() => setAttachMode(false)}
          >
            Add worker Hub
          </HausButton>
          <HausButton
            variant={attachMode ? 'secondary' : 'ghost'}
            isDisabled={busy}
            onPress={() => setAttachMode(true)}
          >
            Join existing Coordinator
          </HausButton>
        </Box>
      )}
      <Box className="nvr-discovery">
        <Box className="discovery-label">
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
        </Box>
        {nearbyNodes.map((node) => (
          <Pressable
            className="discovered-server"
            key={node.id}
            disabled={locked}
            onPress={() => {
              setName(node.name);
              setUrl(node.url);
            }}
          >
            <Text className="home-avatar">
              <Server size={20} />
            </Text>
            <Text>
              <Text semantic="strong">{node.name}</Text>
              <Text semantic="small">{node.url}</Text>
            </Text>
          </Pressable>
        ))}
        {!searchingForNodes && nearbyNodes.length === 0 && (
          <Text semantic="p" className="registry-help">
            Discovery needs a local network that forwards mDNS. You can still enter the server
            address below.
          </Text>
        )}
      </Box>
      {monitoringOnly && !paired && existingServers.length > 0 && (
        <Box className="server-monitoring-options">
          <Text semantic="strong">Use an existing Haus connection</Text>
          {existingServers.map((server) => (
            <HausButton
              key={server.id}
              variant="secondary"
              isDisabled={busy || !canSubmit}
              onPress={() => void link(server)}
            >
              <Text>
                <Text semantic="strong">{server.name}</Text>
                <Text semantic="small">{server.host?.hostname || server.url}</Text>
              </Text>
            </HausButton>
          ))}
          <Text semantic="p" className="registry-help">
            Or connect a new server below.
          </Text>
        </Box>
      )}
      <HausDisclosure className="server-setup" summary="Set up your server with Docker">
        <Box semantic="ordered-list">
          <Box semantic="listitem">
            Save the{' '}
            <HausLink
              href={`https://github.com/resonaura/haus/blob/main/apps/hub/deploy/${monitoringOnly ? 'monitoring/compose.yaml' : 'compose.yaml'}`}
              target="_blank"
              rel="noreferrer"
            >
              Haus {monitoringOnly ? 'monitoring' : 'server'} Compose file
            </HausLink>{' '}
            on the server.
          </Box>
          <Box semantic="listitem">
            Create a unique key with <HausCode>openssl rand -hex 32</HausCode> and save it in{' '}
            <HausCode>.env</HausCode> as <HausCode>HAUS_NODE_KEY</HausCode>
          </Box>
          <Box semantic="listitem">
            Run{' '}
            <HausCode>
              docker compose{monitoringOnly ? ' -f compose.monitoring.yaml' : ''} up -d
            </HausCode>
            , then paste that key below.
          </Box>
        </Box>
        <Text semantic="p">
          Use HTTPS for a private connection. Plain HTTP is available only for a trusted private
          network.
        </Text>
        <Text semantic="p">
          For the physical machine’s complete metrics, add the optional{' '}
          <HausLink
            href="https://github.com/resonaura/haus/blob/main/apps/hub/docs/servers.md"
            target="_blank"
            rel="noreferrer"
          >
            host collector
          </HausLink>
          . Haus shows the reporting scope and leaves unsupported details unavailable.
        </Text>
        <Text semantic="p">
          Running Haus Hub on Windows via WSL2? Enable mirrored networking or configure NAT
          forwarding in the{' '}
          <HausLink
            href="https://github.com/resonaura/haus/blob/main/apps/hub/docs/install.md"
            target="_blank"
            rel="noreferrer"
          >
            Hub WSL2 setup guide
          </HausLink>
          .
        </Text>
      </HausDisclosure>
      <Text semantic="label" className="management-field">
        <Text>Name</Text>
        <TextInput
          value={name}
          maxLength={100}
          onChange={setName}
          placeholder="Home server"
          disabled={locked}
        />
      </Text>
      <Text semantic="label" className="management-field">
        <Text>Server address</Text>
        <TextInput
          value={url}
          onChange={setUrl}
          placeholder="https://server.home:8098"
          disabled={locked}
          spellCheck={false}
        />
      </Text>
      {attachMode ? (
        <>
          <Text semantic="label" className="management-field">
            <Text>Pairing grant (JSON or grant ID)</Text>
            <TextInput
              maxLength={2048}
              autoComplete="off"
              value={grantInput}
              onChange={setGrantInput}
              placeholder='{"grantId":"...","homeId":"..."}'
              disabled={locked}
            />
          </Text>
          <Text semantic="label" className="management-field">
            <Text>Coordinator admin token (optional)</Text>
            <TextInput
              inputType="password"
              maxLength={1024}
              autoComplete="off"
              value={coordinatorToken}
              onChange={setCoordinatorToken}
              disabled={locked}
            />
          </Text>
        </>
      ) : (
        <Text semantic="label" className="management-field">
          <Text>Pairing key</Text>
          <TextInput
            inputType="password"
            maxLength={256}
            autoComplete="off"
            value={key}
            onChange={setKey}
            disabled={locked}
          />
        </Text>
      )}
      {!monitoringOnly && (
        <Box semantic="fieldset" className="server-role-options" disabled={locked}>
          <Box semantic="legend">Optional camera services</Box>
          <Text semantic="p">
            {allowMonitoringOnly
              ? 'Leave both off to use only system monitoring.'
              : 'Choose at least one role for this connection. System monitoring is included.'}
          </Text>
          <Text semantic="label">
            <CheckboxInput checked={storage} onChange={setStorage} disabled={busy} />
            <Text>
              <Text semantic="strong">Recording storage</Text>
              <Text semantic="small">
                Store camera recordings and encrypted home recovery copies.
              </Text>
            </Text>
          </Text>
          <Text semantic="label">
            <CheckboxInput checked={stream} onChange={setStream} disabled={busy} />
            <Text>
              <Text semantic="strong">Video streaming</Text>
              <Text semantic="small">
                Relay video, prepare recordings for playback and support Activity assist when
                available.
              </Text>
            </Text>
          </Text>
          <Text semantic="p">
            Activity assist stays off until you enable it for a camera. These roles apply to Haus
            NVR; your other server services keep their own settings.
          </Text>
        </Box>
      )}
      {monitoringOnly && (
        <Text semantic="p" className="registry-help">
          System monitoring only. This connection receives no camera, recording or backup work.
        </Text>
      )}
      {url.startsWith('http:') && (
        <Text semantic="label" className="registry-check">
          <CheckboxInput checked={allowHttp} onChange={setAllowHttp} disabled={locked} />
          <Text>
            Allow HTTP on my trusted private network
            <Text semantic="small">
              {monitoringOnly
                ? 'Server metrics are unencrypted in transit.'
                : 'Video is unencrypted in transit. Configuration backups remain encrypted.'}
            </Text>
          </Text>
        </Text>
      )}
      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}
      {!canSubmit && (
        <Text semantic="p" className="registry-help" role="status">
          Reconnect or refresh your servers before connecting another server.
        </Text>
      )}
      <Box className="registry-dialog-actions">
        <HausButton variant="ghost" isDisabled={busy} onPress={onClose}>
          Cancel
        </HausButton>
        <HausButton
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
        </HausButton>
      </Box>
    </Dialog>
  );
}
