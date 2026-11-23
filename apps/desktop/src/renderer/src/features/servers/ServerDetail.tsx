/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useId, useState, type ReactNode } from 'react';
import { Box, HausButton, Heading, Pressable, Text } from '@haus/ui';
import { Pause, Play, Unplug, AlertCircle } from 'lucide-react';
import { ServerIcon } from '../../components/icons/ServerIcon';
import { ServerOverview } from './ServerOverview';
import { ServerDisks } from './ServerDisks';
import { ServerServices } from './ServerServices';
import { ServerTerminal } from './ServerTerminal';
import { LiveTerminal } from './terminal/live-terminal';
import { ServerNvr } from './ServerNvr';
import { telemetryIsFresh } from './presentation';
import type { HomeServer, ResourceSample } from './types';
import { serverErrorMessage } from './server-errors';
import { ServerIdentitySettings } from './ServerIdentitySettings';
import type { ServerDevicePreference, ServerRoom } from './server-rooms';
import { serverHasNvr, serverManagementId } from './server-connections';
import { ServerMonitoringSettings } from './ServerMonitoringSettings';

export function ServerDetail({
  server,
  history,
  admin,
  busy,
  fresh,
  now,
  onSaveLimit,
  onToggle,
  onRemove,
  rooms = [],
  preference,
  onSaveIdentity,
  backups,
  activeTab,
  onTabChange,
  contextualNavigation = false,
  monitoringSupported = false,
  onConnectMonitoring,
  onMonitoringChanged,
}: {
  server: HomeServer;
  history: ResourceSample[];
  admin: boolean;
  busy: boolean;
  fresh: boolean;
  now: number;
  onSaveLimit: (limit: number | null) => Promise<void>;
  onToggle: () => void;
  onRemove: () => void;
  rooms?: ServerRoom[];
  preference?: ServerDevicePreference;
  onSaveIdentity?: (value: ServerDevicePreference) => void | Promise<void>;
  backups?: ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  contextualNavigation?: boolean;
  monitoringSupported?: boolean;
  onConnectMonitoring?: () => void;
  onMonitoringChanged?: () => Promise<void>;
}) {
  const [localTab, setLocalTab] = useState('overview');
  const tabId = useId();
  const isHubServer = server.kind === 'hub' || server.kind === 'nvr' || Boolean(server.managedId);
  const hubServerId = isHubServer ? serverManagementId(server) : undefined;
  const tabs = [
    ['overview', 'Overview'],
    ['storage', 'Disks'],
    ['services', 'Services'],
    ['terminal', 'Terminal'],
    ...(isHubServer ? [['logs', 'Logs']] : []),
    ...(serverHasNvr(server) ? [['backups', 'NVR']] : []),
    ...(admin ? [['settings', 'Settings']] : []),
  ];
  const selectedTab = activeTab ?? localTab;
  const tab = tabs.some(([id]) => id === selectedTab) ? selectedTab : 'overview';
  const setTab = (id: string) => {
    setLocalTab(id);
    onTabChange?.(id);
  };
  const host = server.host;
  const connectionFresh = fresh || server.kind === 'ssh';
  const telemetryFresh = telemetryIsFresh(server, fresh, now);
  const hasStaleTelemetry = Boolean(host) && !telemetryFresh;
  const connection = !connectionFresh
    ? 'Last known status'
    : server.enabled === false
      ? 'Paused'
      : server.online === true
        ? 'Connected'
        : server.online === false
          ? 'Offline'
          : 'Not checked';
  const lastSeen = server.lastSeen ? new Date(server.lastSeen).toLocaleString() : undefined;
  return (
    <Box className={`server-detail ${contextualNavigation ? 'is-contextual' : ''}`}>
      {!contextualNavigation && (
        <Box semantic="section" className="server-detail-heading">
          <Text className="server-identity-icon">
            <ServerIcon server={server} icon={preference?.icon} size={28} />
          </Text>
          <Box>
            <Box className="server-kind">
              {server.kind === 'home-assistant'
                ? 'Home Assistant'
                : server.kind === 'hub'
                  ? 'Haus Hub'
                  : server.kind === 'ssh'
                    ? 'SSH server'
                    : 'Home server'}
            </Box>
            <Heading level={2}>{server.name}</Heading>
            <Text semantic="p">
              {host
                ? [host.hostname, host.platform, host.arch].filter(Boolean).join(' · ')
                : server.url || 'Your home, connected'}
            </Text>
          </Box>
          <Text
            className={`server-connection ${server.online === true && connectionFresh ? 'is-online' : ''}`}
          >
            <Text semantic="swatch" />
            {connection}
          </Text>
        </Box>
      )}
      {server.online === false && (
        <Box className="server-notice">
          <AlertCircle size={19} />
          <Text semantic="p">
            {server.enabled === false
              ? 'This server is paused. Resume it to receive new work and refresh its information.'
              : `This server is offline.${lastSeen ? ` Last seen ${lastSeen}.` : ''} Its saved configuration stays available.`}
          </Text>
        </Box>
      )}
      {server.error && (
        <Text semantic="p" className="server-muted" role="status">
          {serverErrorMessage(server.error)}
        </Text>
      )}
      {server.online === true && server.monitoringOnline === false && (
        <Text semantic="p" className="server-muted" role="status">
          SSH is available, but Haus Hub is not reporting. Resource information is last known.
        </Text>
      )}
      {server.online === true && !host && (
        <Box className="server-notice" role="status">
          <AlertCircle size={19} />
          <Text semantic="p">
            {server.kind === 'ssh'
              ? 'SSH is connected. Connect monitoring in Settings to see processor, memory, disks and services.'
              : 'This server is connected, but it has not shared resource information yet. Update its Haus service to see processor, memory, disks and services.'}
          </Text>
        </Box>
      )}
      {hasStaleTelemetry && (
        <Text semantic="p" className="server-scope-note" role="status">
          Resource information is last known.{' '}
          {host?.sampledAt
            ? `Last sampled ${new Date(host.sampledAt).toLocaleString()}.`
            : 'Waiting for a fresh sample.'}{' '}
          Live measurements resume when this server reports again.
        </Text>
      )}
      {!contextualNavigation && (
        <Box
          className="server-tabs"
          role="tablist"
          ariaLabel="Server details"
          onKeyDown={(event) => {
            const index = tabs.findIndex(([id]) => id === tab);
            const target =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : -1;
            if (target < 0) return;
            event.preventDefault();
            setTab(tabs[target][0]);
            const current = event.currentTarget;
            if (current instanceof HTMLElement) {
              current.querySelector<HTMLButtonElement>(`[data-tab="${tabs[target][0]}"]`)?.focus();
            }
          }}
        >
          {tabs.map(([id, label]) => (
            <Pressable
              role="tab"
              key={id}
              id={`${tabId}-${id}-tab`}
              dataAttrs={{ 'data-tab': id }}
              ariaSelected={tab === id}
              ariaControls={`${tabId}-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onPress={() => setTab(id)}
            >
              {label}
            </Pressable>
          ))}
        </Box>
      )}
      <Box
        semantic="section"
        className="server-tab-panel"
        role="tabpanel"
        id={`${tabId}-overview`}
        ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-overview-tab`}
        ariaLabel={contextualNavigation ? 'Overview' : undefined}
        hidden={tab !== 'overview'}
      >
        <ServerOverview
          server={server}
          history={history}
          fresh={telemetryFresh}
          now={now}
          onNavigate={setTab}
        />
      </Box>
      <Box
        semantic="section"
        className="server-tab-panel server-disk-panel"
        role="tabpanel"
        id={`${tabId}-storage`}
        ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-storage-tab`}
        ariaLabel={contextualNavigation ? 'Disks' : undefined}
        hidden={tab !== 'storage'}
      >
        <ServerDisks disks={host?.disks ?? []} lastKnown={hasStaleTelemetry} />
      </Box>
      <Box
        semantic="section"
        className="server-tab-panel server-services-panel"
        role="tabpanel"
        id={`${tabId}-services`}
        ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-services-tab`}
        ariaLabel={contextualNavigation ? 'Services' : undefined}
        hidden={tab !== 'services'}
      >
        {host?.cpu && host?.memory && host?.docker && host?.pm2 ? (
          <ServerServices
            host={host}
            lastKnown={hasStaleTelemetry}
            now={now}
            serverId={hubServerId}
            admin={admin}
          />
        ) : (
          <Text semantic="p" className="server-muted">
            {server.kind === 'ssh'
              ? 'Install Haus Hub to report service information for this server.'
              : 'Service information will appear when this server connects.'}
          </Text>
        )}
      </Box>
      {serverHasNvr(server) && (
        <Box
          semantic="section"
          className="server-tab-panel"
          role="tabpanel"
          id={`${tabId}-backups`}
          ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-backups-tab`}
          ariaLabel={contextualNavigation ? 'NVR' : undefined}
          hidden={tab !== 'backups'}
        >
          <ServerNvr
            server={server}
            fresh={fresh}
            admin={admin}
            busy={busy}
            onSaveLimit={onSaveLimit}
            backups={backups}
          />
        </Box>
      )}
      {admin && (
        <Box
          semantic="section"
          className="server-tab-panel"
          role="tabpanel"
          id={`${tabId}-settings`}
          ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-settings-tab`}
          ariaLabel={contextualNavigation ? 'Settings' : undefined}
          hidden={tab !== 'settings'}
        >
          {onSaveIdentity && (
            <ServerIdentitySettings
              key={`${server.id}:${server.name}:${preference?.areaId ?? ''}:${preference?.icon ?? ''}`}
              server={server}
              rooms={rooms}
              preference={preference}
              onSave={onSaveIdentity}
            />
          )}
          {server.kind === 'ssh' && onConnectMonitoring && onMonitoringChanged && (
            <ServerMonitoringSettings
              server={server}
              supported={monitoringSupported}
              fresh={fresh}
              busy={busy}
              onConnect={onConnectMonitoring}
              onChanged={onMonitoringChanged}
            />
          )}
          {(server.kind === 'nvr' ||
            (server.kind === 'hub' && !server.local) ||
            server.kind === 'ssh') && (
            <Box className="server-panel server-management-actions">
              <Box className="server-section-heading">
                <Box>
                  <Heading level={3}>Connection</Heading>
                  <Text semantic="p">
                    {server.kind === 'nvr' || server.kind === 'hub' || server.managedId
                      ? 'Pause this Haus connection, or remove it from your home. The server’s other services keep running.'
                      : 'Remove this SSH connection from your home. The server and its files are not changed.'}
                  </Text>
                </Box>
              </Box>
              <Box>
                {(server.kind === 'nvr' || server.kind === 'hub' || server.managedId) && (
                  <HausButton variant="secondary" isDisabled={busy || !fresh} onPress={onToggle}>
                    {server.enabled === false ? <Play size={15} /> : <Pause size={15} />}{' '}
                    {server.enabled === false ? 'Resume connection' : 'Pause connection'}
                  </HausButton>
                )}
                <HausButton
                  variant="ghost"
                  isDisabled={busy || (server.kind !== 'ssh' && !fresh)}
                  onPress={onRemove}
                >
                  <Unplug size={15} />
                  Disconnect
                </HausButton>
              </Box>
            </Box>
          )}
        </Box>
      )}
      <Box
        semantic="section"
        className="server-tab-panel server-terminal-panel"
        role="tabpanel"
        id={`${tabId}-terminal`}
        ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-terminal-tab`}
        ariaLabel={contextualNavigation ? 'Terminal' : undefined}
        hidden={tab !== 'terminal'}
      >
        <ServerTerminal key={server.id} server={server} active={tab === 'terminal'} />
      </Box>
      {hubServerId && (
        <Box
          semantic="section"
          className="server-tab-panel server-terminal-panel"
          role="tabpanel"
          id={`${tabId}-logs`}
          ariaLabelledBy={contextualNavigation ? undefined : `${tabId}-logs-tab`}
          ariaLabel={contextualNavigation ? 'Logs' : undefined}
          hidden={tab !== 'logs'}
        >
          <LiveTerminal
            key={`${server.id}:hub-logs`}
            serverId={hubServerId}
            target={{ kind: 'hub-logs', tail: 500 }}
            active={tab === 'logs'}
          />
        </Box>
      )}
      <Box
        semantic="footer"
        className="server-detail-footer"
        hidden={tab === 'terminal' || tab === 'logs'}
      >
        <Text semantic="p">
          {host?.sampledAt
            ? `${telemetryFresh ? 'Updated' : 'Last sampled'} ${new Date(host.sampledAt).toLocaleTimeString()}${telemetryFresh ? ' · refreshes every second' : ''}`
            : server.kind === 'ssh'
              ? 'Resource reporting is not configured'
              : 'Waiting for resource information'}
        </Text>
      </Box>
    </Box>
  );
}
