/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowLeft, Check, Layers, LoaderCircle, Settings2, ShieldCheck } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { appRequest, type InstalledApp } from './api';
import {
  initialConfigFromManifest,
  parseCatalogDetail,
  requiredManifestPermissions,
  sanitizeOptionsSubmission,
  type CatalogAppDetail,
  type CatalogAppSummary,
} from './catalog-api';
import { AppConfigFields } from './config-form';
import { formatStabilityMedal, HAUS_GOVEE_WHY_GROUPED } from './vendor-grouping';

export interface HausGoveeEngineItem {
  readonly id: string;
  readonly title: string;
  readonly runtime: string;
  readonly description: string;
  readonly trustScore: number;
  readonly stabilityTier: 'gold' | 'silver' | 'bronze' | 'low';
  readonly installed?: boolean;
  readonly state?: string;
  readonly version?: string;
  readonly onConfigureSeparately: () => void;
}

export function HausGoveeGroupView({
  admin = true,
  catalogItems = [],
  installedApps = [],
  extraEngines = [],
  onBack,
  onSelectCatalogEntry,
  onManageInstalledApp,
  onCombinedSaved,
}: {
  admin?: boolean;
  catalogItems?: readonly CatalogAppSummary[];
  installedApps?: readonly InstalledApp[];
  extraEngines?: readonly HausGoveeEngineItem[];
  onBack?: () => void;
  onSelectCatalogEntry?: (entry: CatalogAppSummary) => void;
  onManageInstalledApp?: (appId: string) => void;
  onCombinedSaved?: () => void | Promise<void>;
}) {
  const [goveeDetail, setGoveeDetail] = useState<CatalogAppDetail>();
  const [mqttDetail, setMqttDetail] = useState<CatalogAppDetail>();
  const [values, setValues] = useState<Record<string, unknown>>({ hybridSplit: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setError('');
    void Promise.all([
      appRequest('GET', 'apps/catalog/homebridge-govee')
        .then(parseCatalogDetail)
        .catch(() =>
          appRequest('GET', 'apps/catalog/govee')
            .then(parseCatalogDetail)
            .catch(() => undefined),
        ),
      appRequest('GET', 'apps/catalog/govee2mqtt')
        .then(parseCatalogDetail)
        .catch(() => undefined),
    ])
      .then(([hb, mqtt]) => {
        if (!mounted.current) return;
        setGoveeDetail(hb);
        setMqttDetail(mqtt);
        if (hb) {
          setValues({ ...initialConfigFromManifest(hb.manifest), hybridSplit: true });
        }
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const installOrConfigureEngine = async (
    appId: string,
    detail: CatalogAppDetail | undefined,
    submittedValues: Record<string, unknown>,
  ) => {
    if (!detail) return;
    const config = sanitizeOptionsSubmission(detail.manifest, submittedValues);
    const isInstalled =
      installedApps.some((a) => a.id === appId || a.externalId === appId) ||
      catalogItems.some((c) => c.id === appId && c.installed);
    if (isInstalled) {
      await appRequest('POST', `apps/${encodeURIComponent(appId)}/operate`, {
        operation: 'configure',
        options: config,
      });
    } else {
      await appRequest('POST', 'apps/install', {
        manifest: detail.manifest,
        grantedPermissions: requiredManifestPermissions(detail.manifest),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
    }
  };

  const handleCombinedSubmit = async () => {
    if (busy || !goveeDetail) return;
    setBusy(true);
    setError('');
    setStatusMessage('Configuring Homebridge Govee (smart outlets, LAN & BLE)…');
    try {
      await installOrConfigureEngine(goveeDetail.manifest.id, goveeDetail, values);
      if (mqttDetail && values.hybridSplit !== false) {
        setStatusMessage('Configuring Govee2MQTT (lights, sensors & Matter bridge)…');
        await installOrConfigureEngine('govee2mqtt', mqttDetail, values).catch(() => {
          // Docker Govee2MQTT may already be managed as an external container on some nodes.
        });
      }
      if (!mounted.current) return;
      setStatusMessage('Haus Govee combined setup applied.');
      await onCombinedSaved?.();
    } catch (reason: unknown) {
      if (mounted.current) {
        setError(
          reason instanceof Error ? reason.message : 'Could not apply combined Haus Govee setup.',
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const builtEngines: HausGoveeEngineItem[] = [];
  const hbInstalled = installedApps.find(
    (a) =>
      a.id === 'homebridge-govee' ||
      a.externalId === 'homebridge-govee' ||
      a.id === 'govee' ||
      a.externalId === 'govee',
  );
  const hbCatalog =
    catalogItems.find((c) => c.id === 'homebridge-govee') ??
    catalogItems.find((c) => c.id === 'govee');

  builtEngines.push({
    id: hbInstalled?.id ?? hbCatalog?.id ?? 'homebridge-govee',
    title: 'Homebridge Govee',
    runtime: 'Homebridge',
    description:
      'Direct LAN UDP, Bluetooth Low Energy (BLE), and AWS IoT cloud driver — ideal for Govee smart outlets and sub-devices.',
    trustScore: 96,
    stabilityTier: 'gold',
    installed: Boolean(hbInstalled || hbCatalog?.installed),
    state: hbInstalled?.state ?? hbCatalog?.state,
    version: hbInstalled?.version ?? hbCatalog?.latestVersion ?? '11.39.1',
    onConfigureSeparately: () => {
      if (hbInstalled && onManageInstalledApp) {
        onManageInstalledApp(hbInstalled.id);
      } else if (hbCatalog && onSelectCatalogEntry) {
        onSelectCatalogEntry(hbCatalog);
      }
    },
  });

  const mqttInstalled = installedApps.find(
    (a) => a.id === 'govee2mqtt' || a.externalId === 'govee2mqtt',
  );
  const mqttCatalog = catalogItems.find((c) => c.id === 'govee2mqtt');

  builtEngines.push({
    id: mqttInstalled?.id ?? mqttCatalog?.id ?? 'govee2mqtt',
    title: 'Govee2MQTT',
    runtime: 'Docker · MQTT',
    description:
      'High-throughput LAN, BLE, and Matter-to-MQTT bridge for Govee RGBIC lights, strips, and environmental sensors.',
    trustScore: 95,
    stabilityTier: 'gold',
    installed: Boolean(mqttInstalled || mqttCatalog?.installed),
    state: mqttInstalled?.state ?? mqttCatalog?.state,
    version: mqttInstalled?.version ?? mqttCatalog?.latestVersion ?? '2024.10.1',
    onConfigureSeparately: () => {
      if (mqttInstalled && onManageInstalledApp) {
        onManageInstalledApp(mqttInstalled.id);
      } else if (mqttCatalog && onSelectCatalogEntry) {
        onSelectCatalogEntry(mqttCatalog);
      }
    },
  });

  for (const extra of extraEngines) {
    if (!builtEngines.some((e) => e.id === extra.id)) {
      builtEngines.push(extra);
    }
  }
  builtEngines.sort((a, b) => b.trustScore - a.trustScore);

  return (
    <div className="haus-govee-group-view">
      {onBack && (
        <div className="haus-govee-back-row">
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={onBack}>
            <ArrowLeft size={15} />
            Back
          </Button>
        </div>
      )}

      <section className="vendor-group-explainer-banner">
        <div className="vendor-group-explainer-head">
          <span className="integration-logo">
            <BrandIcon kind="integration" id="govee" size={42} hint={{ name: 'Haus Govee' }} />
          </span>
          <div className="vendor-group-explainer-titles">
            <div className="vendor-group-title-row">
              <h3>Haus Govee</h3>
              <span className="vendor-group-count-pill">
                <Layers size={12} />
                {builtEngines.length} engines grouped
              </span>
              <span className="stability-medal-pill is-gold">🥇 Gold Stability · 99% Trust</span>
            </div>
            <p>{HAUS_GOVEE_WHY_GROUPED}</p>
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <section className="native-app-panel haus-govee-combined-panel">
        <div className="native-app-panel-head">
          <div>
            <div className="vendor-group-title-row">
              <h3>Combined Setup Flow (Recommended)</h3>
              <span className="stability-medal-pill is-gold">
                <ShieldCheck size={12} />
                Govee2MQTT + Homebridge Govee
              </span>
            </div>
            <p>
              Enter your Govee credentials once. Haus automatically provisions Homebridge Govee for
              outlets and Govee2MQTT for lights with deduplicated room &amp; device handover.
            </p>
          </div>
        </div>

        {loading && (
          <div className="management-loading">
            <LoaderCircle className="spin" />
            Loading Haus Govee combined schema…
          </div>
        )}

        {!loading && goveeDetail && (
          <>
            <AppConfigFields
              options={goveeDetail.manifest.options}
              secrets={goveeDetail.manifest.secrets}
              values={values}
              disabled={!admin || busy}
              onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
            />
            {statusMessage && (
              <div className="management-loading" aria-live="polite">
                {busy ? <LoaderCircle className="spin" /> : <Check size={15} />}
                <span>{statusMessage}</span>
              </div>
            )}
            <div className="plugin-install-actions">
              <div className="plugin-install-actions-right">
                <Button
                  variant="primary"
                  isDisabled={!admin || busy}
                  isPending={busy}
                  onPress={() => void handleCombinedSubmit()}
                >
                  <Check size={15} />
                  {busy ? 'Applying Combined Setup…' : 'Apply Combined Haus Govee Setup'}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="vendor-group-drivers-section">
        <div className="vendor-group-drivers-head">
          <h4>Individual Engines in Haus Govee ({builtEngines.length})</h4>
          <span>Ranked by stability &amp; trust — configure any engine separately</span>
        </div>
        <div className="vendor-group-driver-list">
          {builtEngines.map((engine, index) => {
            const medal = formatStabilityMedal(engine.stabilityTier, engine.trustScore, true);
            return (
              <article key={engine.id} className="vendor-driver-card">
                <span className="vendor-driver-rank">#{index + 1}</span>
                <span className="integration-logo">
                  <BrandIcon
                    kind={
                      engine.runtime.toLowerCase().includes('homebridge') ? 'homebridge' : 'app'
                    }
                    id={engine.id}
                    size={36}
                    hint={{ name: engine.title, supportedBy: 'govee' }}
                  />
                </span>
                <div className="vendor-driver-copy">
                  <div className="vendor-group-title-row">
                    <strong>{engine.title}</strong>
                    <span className={`stability-medal-pill is-${medal.tier}`}>{medal.label}</span>
                    <span className="integration-runtime-pill">{engine.runtime}</span>
                    {engine.installed && (
                      <span className="integration-runtime-pill">
                        {engine.state === 'running' ? 'Running' : 'Installed'}
                      </span>
                    )}
                  </div>
                  <p>{engine.description}</p>
                </div>
                <Button size="sm" variant="secondary" onPress={engine.onConfigureSeparately}>
                  <Settings2 size={14} />
                  Configure separately
                </Button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
