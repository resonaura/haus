/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpCircle, Camera, Play, RotateCw, TerminalSquare, Trash2 } from 'lucide-react';
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

  return (
    <ConnectionDetailLayout
      title={app.name}
      icon={
        <BrandIcon kind="app" id={app.externalId || app.id} size={64} hint={{ name: app.name }} />
      }
      subtitle={`${statusText}${app.version ? ` · Version ${app.version}` : ''}`}
      onBack={() => {
        if (!pending.current) onClose();
      }}
      actions={
        updateStatus?.updateAvailable ? (
          <Button
            variant="primary"
            isDisabled={!admin || busy || !app.managed || !app.available}
            isPending={busy}
            onPress={applyUpdate}
          >
            <ArrowUpCircle size={16} />
            Update to {updateStatus.latestVersion}
          </Button>
        ) : undefined
      }
    >
      <div className="filter-tabs management-detail-tabs" role="tablist" aria-label="App sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-pressed={tab === item.id}
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
        <>
          <div className="addon-facts">
            <span>
              State
              <strong>{statusText}</strong>
            </span>
            <span>
              Version
              <strong>{app.version ?? 'Unknown'}</strong>
            </span>
            <span>
              App ID
              <strong>{app.externalId}</strong>
            </span>
          </div>

          <div className="management-action-row">
            {app.actions.map((action) => (
              <Button
                key={action}
                variant="secondary"
                isDisabled={!admin || busy || !app.managed || !app.available}
                onPress={() => execute(action)}
              >
                {action === 'restart' && <RotateCw size={16} />}
                {action === 'start' && <Play size={15} />}
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </Button>
            ))}
          </div>

          {updateStatus?.updateAvailable && (
            <section className="native-app-section">
              <h3>Update available</h3>
              <p className="management-hint">
                Version {updateStatus.latestVersion} is ready to install (currently{' '}
                {updateStatus.currentVersion}).
              </p>
              {updateStatus.releaseNotes && (
                <p className="management-hint">{updateStatus.releaseNotes}</p>
              )}
              <Button
                variant="primary"
                isDisabled={!admin || busy || !app.managed || !app.available}
                onPress={applyUpdate}
              >
                <ArrowUpCircle size={16} />
                Update to {updateStatus.latestVersion}
              </Button>
            </section>
          )}

          {(app.accessories?.mqtt || app.accessories?.camera) && (
            <section className="native-app-section">
              <h3>Accessories</h3>
              {app.accessories.mqtt && (
                <p className="management-hint">
                  Devices and their controls appear automatically when this App publishes discovery.
                  Configure your devices in the App.
                </p>
              )}
              {app.accessories.camera && (
                <>
                  <div className="native-camera-candidates">
                    {inventory?.cameras.map((camera) => (
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
                  <Button
                    isDisabled={!admin || busy || app.state !== 'running'}
                    variant="secondary"
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
                    <Camera size={16} />
                    {inventory?.connected ? 'Refresh accessories' : 'Connect accessories'}
                  </Button>
                </>
              )}
            </section>
          )}

          {admin && app.managed && (
            <section className="native-app-section">
              {!confirmRemove ? (
                <Button variant="danger" isDisabled={busy} onPress={() => setConfirmRemove(true)}>
                  <Trash2 size={16} />
                  Remove App
                </Button>
              ) : (
                <div className="native-app-row-actions">
                  <Button variant="danger" isDisabled={busy} onPress={removeApp}>
                    Confirm removal
                  </Button>
                  <Button variant="ghost" isDisabled={busy} onPress={() => setConfirmRemove(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'config' && admin && app.managed && (
        <AppConfigTab app={app} busy={busy} onRun={run} onChanged={onChanged} onError={setError} />
      )}

      {tab === 'logs' && (app.logs || admin) && (
        <section className="native-app-section native-app-tab-section">
          <AppLiveLogs appId={app.id} appState={app.state} />
        </section>
      )}

      {tab === 'terminal' && admin && (
        <section className="native-app-section native-app-tab-section">
          {app.state === 'running' ? (
            <LiveTerminal
              className="native-app-xterm"
              serverId="local"
              target={{ kind: 'app-exec', appId: app.id }}
              active
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
