/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { LoaderCircle, RefreshCw, RotateCw } from 'lucide-react';
import { appRequest, record, type InstalledApp } from './api';
import { parseCatalogDetail } from './catalog-api';
import { NativeAppConfigFields, type NativeConfigFieldMeta } from './config-form';

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

export function AppConfigTab({
  app,
  busy,
  onRun,
  onChanged,
  onError,
}: {
  app: InstalledApp;
  busy: boolean;
  onRun: (action: () => Promise<void>) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [configuredSecrets, setConfiguredSecrets] = useState<Set<string>>(() => new Set());
  const [fieldMeta, setFieldMeta] = useState<Record<string, NativeConfigFieldMeta>>();
  const [configMode, setConfigMode] = useState<'fields' | 'json'>('fields');
  const [jsonText, setJsonText] = useState('{}');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const active = useRef(true);

  const path = `apps/${encodeURIComponent(app.id)}`;
  const catalogPath = `apps/catalog/${encodeURIComponent(app.externalId)}`;

  const loadNativeConfig = useCallback(async () => {
    setLoading(true);
    onError('');
    try {
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
      setLoaded(true);
    } catch (reason) {
      if (active.current) {
        onError(reason instanceof Error ? reason.message : 'Could not load App configuration.');
      }
    } finally {
      if (active.current) setLoading(false);
    }
  }, [app.externalId, catalogPath, onError, path]);

  useEffect(() => {
    active.current = true;
    void loadNativeConfig();
    return () => {
      active.current = false;
    };
  }, [loadNativeConfig]);

  const switchConfigMode = (nextMode: 'fields' | 'json') => {
    if (nextMode === configMode) return;
    onError('');
    if (nextMode === 'json') {
      setJsonText(JSON.stringify(configValues, null, 2));
      setConfigMode('json');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!record(parsed)) {
        onError('Configuration must be a JSON object.');
        return;
      }
      setConfigValues(parsed);
      setConfigMode('fields');
    } catch {
      onError('Fix invalid JSON before switching to Fields view.');
    }
  };

  const saveConfiguration = (restartAfter = false) =>
    onRun(async () => {
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
      if (active.current) setSaved(true);
      await onChanged();
    });

  return (
    <section className="native-app-section native-app-tab-section">
      <div className="native-app-section-header">
        <h3>Configuration</h3>
        <div className="native-app-row-actions">
          <button
            type="button"
            className="text-link"
            disabled={loading || busy}
            onClick={() => void loadNativeConfig()}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Reload
          </button>
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
      </div>

      {loading && !loaded ? (
        <div className="management-loading">
          <LoaderCircle className="spin" size={18} />
          Loading configuration…
        </div>
      ) : configMode === 'fields' ? (
        <NativeAppConfigFields
          values={configValues}
          configuredSecrets={configuredSecrets}
          fieldMeta={fieldMeta}
          disabled={busy}
          onChange={(name, value) => {
            setSaved(false);
            setConfigValues((prev) => ({ ...prev, [name]: value }));
          }}
        />
      ) : (
        <div className="native-app-fields">
          <label className="native-app-field">
            <span>Native configuration (options.json)</span>
            <textarea
              className="native-app-json"
              rows={Math.min(24, Math.max(10, jsonText.split('\n').length + 1))}
              value={jsonText}
              disabled={busy}
              onChange={(event) => {
                setSaved(false);
                setJsonText(event.target.value);
              }}
              spellCheck={false}
            />
            <small>
              Secrets shown as &lt;unchanged&gt; stay preserved unless replaced with a new value.
            </small>
          </label>
        </div>
      )}

      {saved && (
        <p className="management-notice" role="status">
          Configuration saved. Restart the App if its runtime reads options on startup.
        </p>
      )}

      <div className="native-app-row-actions">
        <Button
          variant="primary"
          isDisabled={busy || loading}
          isPending={busy}
          onPress={() => saveConfiguration(false)}
        >
          Save configuration
        </Button>
        {app.state === 'running' && (
          <Button
            variant="secondary"
            isDisabled={busy || loading}
            onPress={() => saveConfiguration(true)}
          >
            <RotateCw size={15} />
            Save &amp; restart
          </Button>
        )}
      </div>
    </section>
  );
}
