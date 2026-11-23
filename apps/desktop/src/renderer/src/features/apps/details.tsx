/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
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
    <div className="native-app-header-actions">
      {app.actions.map((action) => (
        <Button
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
        </Button>
      ))}
      {updateStatus?.updateAvailable && (
        <Button
          variant="primary"
          size="sm"
          isDisabled={!admin || busy || !app.managed || !app.available}
          isPending={busy}
          onPress={applyUpdate}
        >
          <ArrowUpCircle size={15} />
          Update to {updateStatus.latestVersion}
        </Button>
      )}
    </div>
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
      <div className="native-app-tabs" role="tablist" aria-label="App sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'selected' : ''}
            onClick={() => {
              setError('');
              setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tab === 'overview' && (
        <div className="native-app-overview">
          <div className="native-app-metrics-grid">
            <div className="native-app-metric-card">
              <span className="native-app-metric-label">
                <Activity size={13} />
                State
              </span>
              <strong className="native-app-metric-value">
                <span className={`native-app-state-dot${isRunning ? ' is-running' : ''}`} />
                {statusText}
              </strong>
              <small>{app.managed ? 'Managed by Haus Hub' : 'External runtime'}</small>
            </div>
            <div className="native-app-metric-card">
              <span className="native-app-metric-label">
                <Tag size={13} />
                Version
              </span>
              <strong className="native-app-metric-value is-mono">
                {app.version ?? 'Unknown'}
              </strong>
              <small>
                {updateStatus?.updateAvailable
                  ? `Update ${updateStatus.latestVersion} available`
                  : 'Up to date'}
              </small>
            </div>
            <div className="native-app-metric-card">
              <span className="native-app-metric-label">
                <Hash size={13} />
                App ID
              </span>
              <strong className="native-app-metric-value is-mono">{app.externalId}</strong>
              <small>
                {app.accessories?.mqtt
                  ? 'MQTT discovery bridge'
                  : app.accessories?.camera
                    ? 'Camera accessory provider'
                    : 'Container service'}
              </small>
            </div>
          </div>

          {updateStatus?.updateAvailable && (
            <section className="native-app-card native-app-update-card">
              <div className="native-app-card-copy">
                <h3>Update available</h3>
                <p>
                  Version {updateStatus.latestVersion} is ready to install (currently{' '}
                  {updateStatus.currentVersion}).
                </p>
                {updateStatus.releaseNotes && <p>{updateStatus.releaseNotes}</p>}
              </div>
              <Button
                variant="primary"
                size="sm"
                isDisabled={!admin || busy || !app.managed || !app.available}
                isPending={busy}
                onPress={applyUpdate}
              >
                <ArrowUpCircle size={15} />
                Update to {updateStatus.latestVersion}
              </Button>
            </section>
          )}

          {(app.accessories?.mqtt || app.accessories?.camera) && (
            <section className="native-app-card">
              <div className="native-app-card-header">
                <div>
                  <h3>Accessories</h3>
                  {app.accessories.mqtt && (
                    <p>
                      Devices and controls appear automatically when this App publishes MQTT
                      discovery.
                    </p>
                  )}
                </div>
                {app.accessories.camera && (
                  <Button
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
                  </Button>
                )}
              </div>
              {app.accessories.camera && inventory && inventory.cameras.length > 0 && (
                <div className="native-camera-candidates">
                  {inventory.cameras.map((camera) => (
                    <div key={camera.physicalId}>
                      <Camera aria-hidden="true" />
                      <span>
                        <strong>{camera.name}</strong>
                        <small>{camera.imported ? 'Added to your home' : 'Ready to add'}</small>
                      </span>
                      <small>{camera.available ? 'Online' : 'Offline'}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="native-app-card native-app-shortcuts">
            {admin && app.managed && (
              <button
                type="button"
                className="native-app-shortcut"
                onClick={() => setTab('config')}
              >
                <span className="native-app-shortcut-icon">
                  <SlidersHorizontal size={16} />
                </span>
                <span>
                  <strong>Configuration</strong>
                  <small>Edit App options, secrets, and runtime settings</small>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
            {(app.logs || admin) && (
              <button type="button" className="native-app-shortcut" onClick={() => setTab('logs')}>
                <span className="native-app-shortcut-icon">
                  <FileText size={16} />
                </span>
                <span>
                  <strong>Live logs</strong>
                  <small>Inspect real-time container stdout and diagnostics</small>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
            {admin && (
              <button
                type="button"
                className="native-app-shortcut"
                onClick={() => setTab('terminal')}
              >
                <span className="native-app-shortcut-icon">
                  <TerminalSquare size={16} />
                </span>
                <span>
                  <strong>Terminal</strong>
                  <small>Open an interactive shell inside the App container</small>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
          </section>

          {admin && app.managed && (
            <section className="native-app-card native-app-danger-card">
              <div className="native-app-card-copy">
                <h3>Remove App</h3>
                <p>Stop and uninstall {app.name} from this Hub.</p>
              </div>
              {!confirmRemove ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="native-app-danger-trigger"
                  isDisabled={busy}
                  onPress={() => setConfirmRemove(true)}
                >
                  <Trash2 size={15} />
                  Remove App
                </Button>
              ) : (
                <div className="native-app-row-actions">
                  <Button variant="danger" size="sm" isDisabled={busy} onPress={removeApp}>
                    Confirm removal
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => setConfirmRemove(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'config' && admin && app.managed && (
        <AppConfigTab app={app} busy={busy} onRun={run} onChanged={onChanged} onError={setError} />
      )}

      {tab === 'logs' && (app.logs || admin) && (
        <section className="native-app-section native-app-tab-section is-fill-viewport">
          <AppLiveLogs appId={app.id} appState={app.state} />
        </section>
      )}

      {tab === 'terminal' && admin && (
        <section className="native-app-section native-app-tab-section is-fill-viewport">
          {app.state === 'running' ? (
            <LiveTerminal
              className="native-app-xterm"
              serverId="local"
              target={{ kind: 'app-exec', appId: app.id }}
              active
              onSwitchToLogs={app.logs || admin ? () => setTab('logs') : undefined}
            />
          ) : (
            <div className="management-empty native-app-terminal-stopped">
              <TerminalSquare size={30} />
              <h3>App is not running</h3>
              <p>Start {app.name} to open an interactive shell inside its container.</p>
              {app.actions.includes('start') && (
                <Button
                  variant="secondary"
                  isDisabled={busy || !app.managed || !app.available}
                  onPress={() => execute('start')}
                >
                  <Play size={15} />
                  Start App
                </Button>
              )}
            </div>
          )}
        </section>
      )}
    </ConnectionDetailLayout>
  );
}
