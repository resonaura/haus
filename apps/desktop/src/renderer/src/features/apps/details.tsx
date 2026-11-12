/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Camera, FileText, RotateCw } from 'lucide-react';
import type { AppAction } from '@haus/apps';
import { Dialog } from '../../components/ui/Dialog';
import {
  appRequest,
  record,
  parseAccessories,
  type InstalledApp,
  type AccessoryInventory,
} from './api';

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
  const [inventory, setInventory] = useState<AccessoryInventory>();
  const [logs, setLogs] = useState<string[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const path = `apps/${app.id}`;
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
    return () => {
      active.current = false;
      generation.current++;
    };
  }, [path, app.accessories?.camera, app.state]);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (active.current)
        setError(reason instanceof Error ? reason.message : 'The App operation failed.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const execute = (action: AppAction) =>
    void run(async () => {
      await appRequest('POST', `${path}/execute`, { action });
      await onChanged();
    });
  return (
    <Dialog
      title={app.name}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      className="native-app-dialog"
    >
      <p className="management-hint">
        {app.available ? app.state : 'Unavailable'}
        {app.version ? ` · Version ${app.version}` : ''}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="native-app-actions">
        {app.actions.map((action) => (
          <Button
            key={action}
            variant="secondary"
            isDisabled={!admin || busy || !app.managed || !app.available}
            onPress={() => execute(action)}
          >
            {action === 'restart' && <RotateCw size={16} />}
            {action.charAt(0).toUpperCase() + action.slice(1)}
          </Button>
        ))}
      </div>
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
                  void run(async () => {
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
      {app.logs && (
        <section className="native-app-section">
          <Button
            variant="ghost"
            isDisabled={busy}
            onPress={() =>
              void run(async () => {
                const value = await appRequest('POST', `${path}/operate`, { operation: 'logs' });
                if (
                  !record(value) ||
                  value.status !== 'ok' ||
                  !record(value.data) ||
                  !Array.isArray(value.data.lines) ||
                  !value.data.lines.every((line): line is string => typeof line === 'string')
                )
                  throw Error('Activity is unavailable for this App.');
                if (active.current) setLogs(value.data.lines);
              })
            }
          >
            <FileText size={16} />
            App activity
          </Button>
          {logs && (
            <pre className="native-app-logs">
              {logs.length ? logs.join('\n') : 'No log entries yet.'}
            </pre>
          )}
        </section>
      )}
    </Dialog>
  );
}
