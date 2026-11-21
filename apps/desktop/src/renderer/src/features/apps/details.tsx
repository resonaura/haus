/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpCircle, Camera, FileText, RotateCw, Settings, Trash2 } from 'lucide-react';
import type { AppAction } from '@haus/apps';
import { Dialog } from '../../components/ui/Dialog';
import { NativeAppConfigFields, type NativeConfigFieldMeta } from './config-form';
import { AppLiveLogs } from './live-logs';
import {
  appRequest,
  parseAccessories,
  record,
  type AccessoryInventory,
  type InstalledApp,
} from './api';
import { parseCatalogDetail, parseUpdateCheck, type AppUpdateStatus } from './catalog-api';

interface LoadedAppInfo {
  readonly config: Record<string, unknown>;
  readonly configuredSecrets: readonly string[];
  readonly nativeFields?: Record<string, NativeConfigFieldMeta>;
  readonly image?: string;
}

function isGoveeAddon(externalId: string, image?: string): boolean {
  return (
    externalId === 'govee' ||
    externalId === 'homebridge-govee' ||
    externalId === 'govee2mqtt' ||
    /govee/i.test(image ?? '')
  );
}

function parseAppInfo(value: unknown): LoadedAppInfo | undefined {
  if (!record(value) || value.status !== 'ok' || !record(value.data)) return undefined;
  const data = value.data;
  const config = record(data.config) ? { ...data.config } : {};
  const configuredSecrets = Array.isArray(data.configuredSecrets)
    ? data.configuredSecrets.filter((item): item is string => typeof item === 'string')
    : [];
  const nativeFields = record(data.nativeFields)
    ? (data.nativeFields as Record<string, NativeConfigFieldMeta>)
    : undefined;
  const image =
    record(data.manifest) && typeof data.manifest.image === 'string'
      ? data.manifest.image
      : undefined;
  return { config, configuredSecrets, nativeFields, image };
}

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
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>();
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [configuredSecrets, setConfiguredSecrets] = useState<Set<string>>(() => new Set());
  const [fieldMeta, setFieldMeta] = useState<Record<string, NativeConfigFieldMeta>>();
  const [configMode, setConfigMode] = useState<'fields' | 'json'>('fields');
  const [jsonText, setJsonText] = useState('{}');
  const [configOpen, setConfigOpen] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
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

  const loadNativeConfig = async () => {
    const infoRes = await appRequest('POST', `${path}/operate`, { operation: 'info' }).catch(
      () => undefined,
    );
    const info = parseAppInfo(infoRes);
    const liveConfig = info?.config ?? {};
    const mergedMeta: Record<string, NativeConfigFieldMeta> = { ...info?.nativeFields };

    // Never override Govee add-on native configs with simplified catalog defaults or schemas.
    if (!isGoveeAddon(app.externalId, info?.image)) {
      try {
        const catalogDetail = parseCatalogDetail(await appRequest('GET', catalogPath));
        for (const opt of catalogDetail.manifest.options ?? []) {
          if (!mergedMeta[opt.name]) {
            mergedMeta[opt.name] = {
              description: opt.description,
              ...(opt.choices ? { choices: opt.choices } : {}),
            };
          }
        }
        for (const sec of catalogDetail.manifest.secrets ?? []) {
          if (!mergedMeta[sec.name]) {
            mergedMeta[sec.name] = { description: sec.description, secret: true };
          }
        }
      } catch {
        // Catalog metadata is optional; native config remains authoritative.
      }
    }

    if (!active.current) return;
    setConfigValues(liveConfig);
    setJsonText(JSON.stringify(liveConfig, null, 2));
    setConfiguredSecrets(new Set(info?.configuredSecrets ?? []));
    setFieldMeta(Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined);
    setConfigMode(Object.keys(liveConfig).length > 0 ? 'fields' : 'json');
  };

  const openConfigure = () =>
    void run(async () => {
      setConfigSaved(false);
      await loadNativeConfig();
      if (active.current) setConfigOpen(true);
    });

  const switchConfigMode = (nextMode: 'fields' | 'json') => {
    if (nextMode === configMode) return;
    setError('');
    if (nextMode === 'json') {
      setJsonText(JSON.stringify(configValues, null, 2));
      setConfigMode('json');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!record(parsed)) {
        setError('Configuration must be a JSON object.');
        return;
      }
      setConfigValues(parsed);
      setConfigMode('fields');
    } catch {
      setError('Fix invalid JSON before switching to Fields view.');
    }
  };

  const saveConfiguration = (restartAfter = false) =>
    void run(async () => {
      let options: Record<string, unknown>;
      if (configMode === 'json') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          throw Error('Configuration must be valid JSON.');
        }
        if (!record(parsed)) throw Error('Configuration must be a JSON object.');
        options = parsed;
      } else {
        options = configValues;
      }
      const res = await appRequest('POST', `${path}/configure`, { options, replace: true });
      if (record(res) && res.status === 'error') {
        throw Error(typeof res.reason === 'string' ? res.reason : 'Could not update App config.');
      }
      if (restartAfter && app.state === 'running') {
        await appRequest('POST', `${path}/execute`, { action: 'restart' });
      }
      await loadNativeConfig();
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
        {app.logs && (
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => setLogsOpen((prev) => !prev)}
          >
            <FileText size={16} />
            {logsOpen ? 'Hide live logs' : 'Live logs'}
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
          <div className="native-app-section-header">
            <h3>Configuration</h3>
            <div className="native-app-mode-tabs" role="tablist" aria-label="Configuration mode">
              <button
                type="button"
                role="tab"
                aria-selected={configMode === 'fields'}
                className={configMode === 'fields' ? 'selected' : ''}
                onClick={() => switchConfigMode('fields')}
              >
                Fields
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={configMode === 'json'}
                className={configMode === 'json' ? 'selected' : ''}
                onClick={() => switchConfigMode('json')}
              >
                JSON
              </button>
            </div>
          </div>
          {configMode === 'fields' ? (
            <NativeAppConfigFields
              values={configValues}
              configuredSecrets={configuredSecrets}
              fieldMeta={fieldMeta}
              disabled={busy}
              onChange={(name, value) => {
                setConfigSaved(false);
                setConfigValues((prev) => ({ ...prev, [name]: value }));
              }}
            />
          ) : (
            <div className="native-app-fields">
              <label className="native-app-field">
                <span>Native configuration (options.json)</span>
                <textarea
                  className="native-app-json"
                  rows={Math.min(18, Math.max(8, jsonText.split('\n').length + 1))}
                  value={jsonText}
                  disabled={busy}
                  onChange={(event) => {
                    setConfigSaved(false);
                    setJsonText(event.target.value);
                  }}
                  spellCheck={false}
                />
                <small>
                  Secrets shown as &lt;unchanged&gt; stay preserved unless replaced with a new
                  value.
                </small>
              </label>
            </div>
          )}
          {configSaved && (
            <p className="management-hint">
              Configuration saved. Restart the App if its runtime reads options on startup.
            </p>
          )}
          <div className="native-app-row-actions">
            <Button variant="primary" isDisabled={busy} onPress={() => saveConfiguration(false)}>
              Save configuration
            </Button>
            {app.state === 'running' && (
              <Button variant="secondary" isDisabled={busy} onPress={() => saveConfiguration(true)}>
                <RotateCw size={15} />
                Save &amp; restart
              </Button>
            )}
          </div>
        </section>
      )}
      {app.logs && logsOpen && (
        <section className="native-app-section">
          <h3>Live logs</h3>
          <AppLiveLogs appId={app.id} appState={app.state} />
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
