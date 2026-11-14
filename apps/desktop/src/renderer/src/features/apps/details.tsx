/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpCircle, Camera, FileText, RotateCw, Settings, Trash2 } from 'lucide-react';
import type { AppAction } from '@haus/apps';
import { Dialog } from '../../components/ui/Dialog';
import { AppConfigFields } from './config-form';
import {
  appRequest,
  parseAccessories,
  record,
  type AccessoryInventory,
  type InstalledApp,
} from './api';
import {
  initialConfigFromManifest,
  parseCatalogDetail,
  parseUpdateCheck,
  sanitizeOptionsSubmission,
  type AppUpdateStatus,
  type CatalogAppDetail,
} from './catalog-api';

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
  const [catalogDetail, setCatalogDetail] = useState<CatalogAppDetail>();
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>();
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('{}');
  const [configOpen, setConfigOpen] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [logs, setLogs] = useState<string[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const path = `apps/${encodeURIComponent(app.id)}`;
  const catalogPath = `apps/catalog/${encodeURIComponent(app.externalId)}`;
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

  const openConfigure = () =>
    void run(async () => {
      setConfigSaved(false);
      try {
        const loaded = parseCatalogDetail(await appRequest('GET', catalogPath));
        if (active.current) {
          setCatalogDetail(loaded);
          setConfigValues(initialConfigFromManifest(loaded.manifest));
          setConfigOpen(true);
        }
      } catch {
        if (active.current) {
          setCatalogDetail(undefined);
          setConfigOpen(true);
        }
      }
    });

  const saveConfiguration = () =>
    void run(async () => {
      let options: Record<string, unknown>;
      const hasSchema = Boolean(
        catalogDetail?.manifest.options?.length || catalogDetail?.manifest.secrets?.length,
      );
      if (hasSchema && catalogDetail) {
        options = sanitizeOptionsSubmission(catalogDetail.manifest, configValues);
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          throw Error('Configuration must be valid JSON.');
        }
        if (!record(parsed)) throw Error('Configuration must be a JSON object.');
        options = parsed;
      }
      const res = await appRequest('POST', `${path}/configure`, { options });
      if (record(res) && res.status === 'error') {
        throw Error(typeof res.reason === 'string' ? res.reason : 'Could not update App config.');
      }
      if (active.current) setConfigSaved(true);
      await onChanged();
    });

  const applyUpdate = () =>
    void run(async () => {
      await appRequest('POST', `${path}/update`, {
        grantedPermissions: updateStatus?.requiredPermissions ?? [],
      });
      const rechecked = parseUpdateCheck(await appRequest('GET', updatePath));
      if (active.current) setUpdateStatus(rechecked);
      await onChanged();
    });

  const removeApp = () =>
    void run(async () => {
      const res = await appRequest('POST', `${path}/remove`, {});
      if (record(res) && res.status === 'error') {
        throw Error(typeof res.reason === 'string' ? res.reason : 'Could not remove this App.');
      }
      await onChanged();
      if (active.current) onClose();
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
        {admin && app.managed && (
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => (configOpen ? setConfigOpen(false) : openConfigure())}
          >
            <Settings size={16} />
            {configOpen ? 'Hide configuration' : 'Configure'}
          </Button>
        )}
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
      {configOpen && admin && app.managed && (
        <section className="native-app-section">
          <h3>Configuration</h3>
          <AppConfigFields
            options={catalogDetail?.manifest.options}
            secrets={catalogDetail?.manifest.secrets}
            values={configValues}
            disabled={busy}
            secretsOptional
            jsonText={jsonText}
            onJsonChange={setJsonText}
            onChange={(name, value) => {
              setConfigSaved(false);
              setConfigValues((prev) => ({ ...prev, [name]: value }));
            }}
          />
          {configSaved && <p className="management-hint">Configuration saved.</p>}
          <div className="native-app-row-actions">
            <Button variant="primary" isDisabled={busy} onPress={saveConfiguration}>
              Save configuration
            </Button>
          </div>
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
    </Dialog>
  );
}
