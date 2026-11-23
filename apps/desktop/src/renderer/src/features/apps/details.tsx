/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, HausButton, Heading, Pressable, Text } from '@haus/ui';
import {
  Activity,
  ArrowUpCircle,
  Camera,
  ChevronRight,
  FileText,
  Hash,
  Play,
  RotateCw,
  SlidersHorizontal,
  Square,
  Tag,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import type { AppAction } from '@haus/apps';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { humanize } from '../../ha/management';
import { ConnectionDetailLayout } from '../connections/ConnectionDetailLayout';
import { LiveTerminal } from '../servers/terminal/live-terminal';
import {
  appRequest,
  parseAccessories,
  record,
  type AccessoryInventory,
  type InstalledApp,
} from './api';
import { parseUpdateCheck, type AppUpdateStatus } from './catalog-api';
import { AppConfigTab } from './config-tab';
import { AppLiveLogs } from './live-logs';

type AppDetailTab = 'overview' | 'config' | 'logs' | 'terminal';

export function AppDetails({
  app,
  admin,
  onClose,
  onChanged,
}: {
  app: InstalledApp;
  admin: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<AppDetailTab>('overview');
  const [inventory, setInventory] = useState<AccessoryInventory>();
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const path = `apps/${encodeURIComponent(app.id)}`;
  const updatePath = `apps/${encodeURIComponent(app.externalId)}/update-check`;

  useEffect(() => {
    active.current = true;
    const current = ++generation.current;
    if (app.accessories?.camera && app.state === 'running') {
      void appRequest('GET', `${path}/accessories`)
        .then((value) => {
          const parsed = parseAccessories(value);
          if (active.current && generation.current === current) setInventory(parsed);
        })
        .catch((reason: unknown) => {
          if (active.current)
            setError(reason instanceof Error ? reason.message : 'Could not load accessories.');
        });
    }
    void appRequest('GET', updatePath)
      .then((value) => {
        const parsed = parseUpdateCheck(value);
        if (active.current && generation.current === current) setUpdateStatus(parsed);
      })
      .catch(() => {});
    return () => {
      active.current = false;
      generation.current++;
    };
  }, [path, updatePath, app.accessories?.camera, app.state]);

  const run = useCallback((action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    void (async () => {
      try {
        await action();
      } catch (reason) {
        if (active.current)
          setError(reason instanceof Error ? reason.message : 'The App operation failed.');
      } finally {
        pending.current = false;
        if (active.current) setBusy(false);
      }
    })();
  }, []);

  const execute = (action: AppAction) =>
    run(async () => {
      await appRequest('POST', `${path}/execute`, { action });
      await onChanged();
    });

  const applyUpdate = () =>
    run(async () => {
      await appRequest('POST', `${path}/update`, {
        grantedPermissions: updateStatus?.requiredPermissions ?? [],
      });
      const rechecked = parseUpdateCheck(await appRequest('GET', updatePath));
      if (active.current) setUpdateStatus(rechecked);
      await onChanged();
    });

  const removeApp = () =>
    run(async () => {
      const res = await appRequest('POST', `${path}/remove`, {});
      if (record(res) && res.status === 'error') {
        throw Error(typeof res.reason === 'string' ? res.reason : 'Could not remove this App.');
      }
      await onChanged();
      if (active.current) onClose();
    });

  const tabs: Array<{ id: AppDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    ...(admin && app.managed ? [{ id: 'config' as const, label: 'Configuration' }] : []),
    ...(app.logs || admin ? [{ id: 'logs' as const, label: 'Live logs' }] : []),
    ...(admin ? [{ id: 'terminal' as const, label: 'Terminal' }] : []),
  ];

  const statusText = app.available ? humanize(app.state) : 'Unavailable';
  const isRunning = app.available && app.state === 'running';
  const isViewportPane = tab === 'logs' || tab === 'terminal';

  const headerActions = (
    <Box className="native-app-header-actions">
      {app.actions.map((action) => (
        <HausButton
          key={action}
          variant={action === 'start' ? 'primary' : 'secondary'}
          size="sm"
          isDisabled={!admin || busy || !app.managed || !app.available}
          onPress={() => execute(action)}
        >
          {action === 'restart' && <RotateCw size={14} />}
          {action === 'start' && <Play size={14} />}
          {action === 'stop' && <Square size={13} />}
          {action.charAt(0).toUpperCase() + action.slice(1)}
        </HausButton>
      ))}
      {updateStatus?.updateAvailable && (
        <HausButton
          variant="primary"
          size="sm"
          isDisabled={!admin || busy || !app.managed || !app.available}
          isPending={busy}
          onPress={applyUpdate}
        >
          <ArrowUpCircle size={15} />
          Update to {updateStatus.latestVersion}
        </HausButton>
      )}
    </Box>
  );

  return (
    <ConnectionDetailLayout
      className={`native-app-detail${isViewportPane ? ' is-viewport-pane' : ''}`}
      title={app.name}
      icon={
        <BrandIcon kind="app" id={app.externalId || app.id} size={64} hint={{ name: app.name }} />
      }
      subtitle={`${statusText}${app.version ? ` · Version ${app.version}` : ''}`}
      onBack={() => {
        if (!pending.current) onClose();
      }}
      actions={headerActions}
    >
      <Box className="native-app-tabs" role="tablist" ariaLabel="App sections">
        {tabs.map((item) => (
          <Pressable
            key={item.id}
            role="tab"
            ariaSelected={tab === item.id}
            className={tab === item.id ? 'selected' : ''}
            onPress={() => {
              setError('');
              setTab(item.id);
            }}
          >
            {item.label}
          </Pressable>
        ))}
      </Box>

      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}

      {tab === 'overview' && (
        <Box className="native-app-overview">
          <Box className="native-app-metrics-grid">
            <Box className="native-app-metric-card">
              <Text className="native-app-metric-label">
                <Activity size={13} />
                State
              </Text>
              <Text semantic="strong" className="native-app-metric-value">
                <Text className={`native-app-state-dot${isRunning ? ' is-running' : ''}`} />
                {statusText}
              </Text>
              <Text semantic="small">
                {app.managed ? 'Managed by Haus Hub' : 'External runtime'}
              </Text>
            </Box>
            <Box className="native-app-metric-card">
              <Text className="native-app-metric-label">
                <Tag size={13} />
                Version
              </Text>
              <Text semantic="strong" className="native-app-metric-value is-mono">
                {app.version ?? 'Unknown'}
              </Text>
              <Text semantic="small">
                {updateStatus?.updateAvailable
                  ? `Update ${updateStatus.latestVersion} available`
                  : 'Up to date'}
              </Text>
            </Box>
            <Box className="native-app-metric-card">
              <Text className="native-app-metric-label">
                <Hash size={13} />
                App ID
              </Text>
              <Text semantic="strong" className="native-app-metric-value is-mono">
                {app.externalId}
              </Text>
              <Text semantic="small">
                {app.accessories?.mqtt
                  ? 'MQTT discovery bridge'
                  : app.accessories?.camera
                    ? 'Camera accessory provider'
                    : 'Container service'}
              </Text>
            </Box>
          </Box>

          {updateStatus?.updateAvailable && (
            <Box semantic="section" className="native-app-card native-app-update-card">
              <Box className="native-app-card-copy">
                <Heading level={3}>Update available</Heading>
                <Text semantic="p">
                  Version {updateStatus.latestVersion} is ready to install (currently{' '}
                  {updateStatus.currentVersion}).
                </Text>
                {updateStatus.releaseNotes && <Text semantic="p">{updateStatus.releaseNotes}</Text>}
              </Box>
              <HausButton
                variant="primary"
                size="sm"
                isDisabled={!admin || busy || !app.managed || !app.available}
                isPending={busy}
                onPress={applyUpdate}
              >
                <ArrowUpCircle size={15} />
                Update to {updateStatus.latestVersion}
              </HausButton>
            </Box>
          )}

          {(app.accessories?.mqtt || app.accessories?.camera) && (
            <Box semantic="section" className="native-app-card">
              <Box className="native-app-card-header">
                <Box>
                  <Heading level={3}>Accessories</Heading>
                  {app.accessories.mqtt && (
                    <Text semantic="p">
                      Devices and controls appear automatically when this App publishes MQTT
                      discovery.
                    </Text>
                  )}
                </Box>
                {app.accessories.camera && (
                  <HausButton
                    isDisabled={!admin || busy || app.state !== 'running'}
                    variant="secondary"
                    size="sm"
                    onPress={() =>
                      run(async () => {
                        generation.current++;
                        const result = parseAccessories(
                          await appRequest('POST', `${path}/accessories/sync`, {}),
                        );
                        if (active.current) setInventory(result);
                        await onChanged();
                      })
                    }
                  >
                    <Camera size={15} />
                    {inventory?.connected ? 'Refresh accessories' : 'Connect accessories'}
                  </HausButton>
                )}
              </Box>
              {app.accessories.camera && inventory && inventory.cameras.length > 0 && (
                <Box className="native-camera-candidates">
                  {inventory.cameras.map((camera) => (
                    <Box key={camera.physicalId}>
                      <Camera aria-hidden="true" />
                      <Text>
                        <Text semantic="strong">{camera.name}</Text>
                        <Text semantic="small">
                          {camera.imported ? 'Added to your home' : 'Ready to add'}
                        </Text>
                      </Text>
                      <Text semantic="small">{camera.available ? 'Online' : 'Offline'}</Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          <Box semantic="section" className="native-app-card native-app-shortcuts">
            {admin && app.managed && (
              <Pressable className="native-app-shortcut" onPress={() => setTab('config')}>
                <Text className="native-app-shortcut-icon">
                  <SlidersHorizontal size={16} />
                </Text>
                <Text>
                  <Text semantic="strong">Configuration</Text>
                  <Text semantic="small">Edit App options, secrets, and runtime settings</Text>
                </Text>
                <ChevronRight size={16} />
              </Pressable>
            )}
            {(app.logs || admin) && (
              <Pressable className="native-app-shortcut" onPress={() => setTab('logs')}>
                <Text className="native-app-shortcut-icon">
                  <FileText size={16} />
                </Text>
                <Text>
                  <Text semantic="strong">Live logs</Text>
                  <Text semantic="small">Inspect real-time container stdout and diagnostics</Text>
                </Text>
                <ChevronRight size={16} />
              </Pressable>
            )}
            {admin && (
              <Pressable className="native-app-shortcut" onPress={() => setTab('terminal')}>
                <Text className="native-app-shortcut-icon">
                  <TerminalSquare size={16} />
                </Text>
                <Text>
                  <Text semantic="strong">Terminal</Text>
                  <Text semantic="small">Open an interactive shell inside the App container</Text>
                </Text>
                <ChevronRight size={16} />
              </Pressable>
            )}
          </Box>

          {admin && app.managed && (
            <Box semantic="section" className="native-app-card native-app-danger-card">
              <Box className="native-app-card-copy">
                <Heading level={3}>Remove App</Heading>
                <Text semantic="p">Stop and uninstall {app.name} from this Hub.</Text>
              </Box>
              {!confirmRemove ? (
                <HausButton
                  variant="ghost"
                  size="sm"
                  className="native-app-danger-trigger"
                  isDisabled={busy}
                  onPress={() => setConfirmRemove(true)}
                >
                  <Trash2 size={15} />
                  Remove App
                </HausButton>
              ) : (
                <Box className="native-app-row-actions">
                  <HausButton variant="danger" size="sm" isDisabled={busy} onPress={removeApp}>
                    Confirm removal
                  </HausButton>
                  <HausButton
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => setConfirmRemove(false)}
                  >
                    Cancel
                  </HausButton>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {tab === 'config' && admin && app.managed && (
        <AppConfigTab app={app} busy={busy} onRun={run} onChanged={onChanged} onError={setError} />
      )}

      {tab === 'logs' && (app.logs || admin) && (
        <Box
          semantic="section"
          className="native-app-section native-app-tab-section is-fill-viewport"
        >
          <AppLiveLogs appId={app.id} appState={app.state} />
        </Box>
      )}

      {tab === 'terminal' && admin && (
        <Box
          semantic="section"
          className="native-app-section native-app-tab-section is-fill-viewport"
        >
          {app.state === 'running' ? (
            <LiveTerminal
              className="native-app-xterm"
              serverId="local"
              target={{ kind: 'app-exec', appId: app.id }}
              active
              onSwitchToLogs={app.logs || admin ? () => setTab('logs') : undefined}
            />
          ) : (
            <Box className="management-empty native-app-terminal-stopped">
              <TerminalSquare size={30} />
              <Heading level={3}>App is not running</Heading>
              <Text semantic="p">
                Start {app.name} to open an interactive shell inside its container.
              </Text>
              {app.actions.includes('start') && (
                <HausButton
                  variant="secondary"
                  isDisabled={busy || !app.managed || !app.available}
                  onPress={() => execute('start')}
                >
                  <Play size={15} />
                  Start App
                </HausButton>
              )}
            </Box>
          )}
        </Box>
      )}
    </ConnectionDetailLayout>
  );
}
