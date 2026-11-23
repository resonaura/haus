/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Check, Download, ExternalLink, LoaderCircle } from 'lucide-react';
import type { BrandIconKind } from '../../../../shared/native';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { FeatureLoading } from '../../components/ui/Deferred';
import { nativeApi } from '../../ha/management';
import { hacs } from '../community/hacs';
import { ConnectionDetailLayout } from '../connections/ConnectionDetailLayout';
import { appRequest } from './api';
import {
  initialConfigFromManifest,
  parseCatalogDetail,
  parseInstallProgress,
  requiredManifestPermissions,
  sanitizeOptionsSubmission,
  type AppInstallProgress,
  type CatalogAppDetail,
  type CatalogAppSummary,
} from './catalog-api';
import { AppConfigFields } from './config-form';

export function catalogIconKind(runtimeType: string): BrandIconKind {
  if (runtimeType === 'homebridge') return 'homebridge';
  if (runtimeType === 'scrypted') return 'scrypted';
  if (runtimeType === 'hacs') return 'hacs';
  if (runtimeType === 'addon') return 'addon';
  return 'app';
}

const stageLabel = (stage: string) =>
  ({
    validating: 'Validating manifest…',
    'checking-local': 'Checking local images…',
    pulling: 'Pulling container image…',
    building: 'Building App image…',
    ready: 'Image ready…',
    creating: 'Creating App container…',
    starting: 'Starting App…',
    complete: 'Installed',
    failed: 'Installation failed',
  })[stage] ?? `${stage}…`;

export function AppCatalogDetails({
  entry,
  admin,
  onBack,
  onInstalled,
  onManageApp,
}: {
  entry: CatalogAppSummary;
  admin: boolean;
  onBack: () => void;
  onInstalled: () => Promise<void>;
  onManageApp: (appId: string) => void;
}) {
  const [detail, setDetail] = useState<CatalogAppDetail>();
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [progress, setProgress] = useState<AppInstallProgress>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setDetail(undefined);
    setDetailError('');
    setProgress(undefined);

    void appRequest('GET', `apps/catalog/${encodeURIComponent(entry.id)}`)
      .then((raw) => {
        const loaded = parseCatalogDetail(raw);
        if (!mounted.current) return;
        setDetail(loaded);
        setValues(initialConfigFromManifest(loaded.manifest));
      })
      .catch((reason: unknown) => {
        if (mounted.current) {
          setDetailError(reason instanceof Error ? reason.message : 'Could not load App details.');
        }
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });

    return () => {
      mounted.current = false;
    };
  }, [entry.id]);

  useEffect(() => {
    if (!busy) return;
    let active = true;
    const poll = () => {
      void appRequest('GET', `apps/${encodeURIComponent(entry.id)}/install-progress`)
        .then((raw) => {
          const parsed = parseInstallProgress(raw);
          if (active && parsed) setProgress(parsed);
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, 600);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [busy, entry.id]);

  const submitInstall = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setDetailError('');
    setProgress({ appId: detail.manifest.id, stage: 'validating' });
    try {
      if ((detail.runtimeType ?? entry.runtimeType) === 'hacs') {
        const repoId =
          detail.hacsRepositoryId ?? entry.hacsRepositoryId ?? detail.domain ?? entry.domain;
        if (!repoId) throw Error('Missing HACS repository identifier.');
        setProgress({ appId: detail.manifest.id, stage: 'pulling' });
        await hacs('repository/download', { repository: String(repoId) });
        setProgress({ appId: detail.manifest.id, stage: 'complete' });
        await onInstalled();
        if (mounted.current) onBack();
        return;
      }
      const grantedPermissions = requiredManifestPermissions(detail.manifest);
      const config = sanitizeOptionsSubmission(detail.manifest, values);
      await appRequest('POST', 'apps/install', {
        manifest: detail.manifest,
        grantedPermissions,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      await onInstalled();
      if (mounted.current) onManageApp(entry.id);
    } catch (reason) {
      if (mounted.current) {
        setDetailError(reason instanceof Error ? reason.message : 'App installation failed.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const permissions = detail ? requiredManifestPermissions(detail.manifest) : [];
  const description = detail?.manifest.description ?? entry.description;
  const docUrl = detail?.documentationUrl ?? entry.documentationUrl;
  const repoUrl = detail?.repositoryUrl ?? entry.repositoryUrl;
  const hasConfigFields = Boolean(
    (detail?.manifest.options && detail.manifest.options.length > 0) ||
    (detail?.manifest.secrets && detail.manifest.secrets.length > 0),
  );

  return (
    <ConnectionDetailLayout
      title={entry.name}
      icon={
        <BrandIcon
          kind={catalogIconKind(entry.runtimeType)}
          id={entry.id}
          size={64}
          hint={{
            name: entry.name,
            category: entry.category,
            ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
          }}
        />
      }
      subtitle={`Version ${detail?.manifest.version ?? entry.latestVersion}${entry.author ? ` · ${entry.author}` : ''}`}
      onBack={() => {
        if (!busy) onBack();
      }}
      actions={
        entry.installed ? (
          <Button variant="secondary" onPress={() => onManageApp(entry.id)}>
            <Check size={16} />
            Manage App
          </Button>
        ) : (
          <Button
            variant="primary"
            isDisabled={!admin || busy || !detail}
            isPending={busy}
            onPress={() => void submitInstall()}
          >
            <Download size={16} />
            {busy ? 'Installing…' : 'Install App'}
          </Button>
        )
      }
    >
      {detailError && (
        <p className="form-error" role="alert">
          {detailError}
        </p>
      )}
      {loading && <FeatureLoading />}
      {!loading && (
        <>
          {description && <p className="flow-description">{description}</p>}

          <div className="addon-facts">
            <span>
              Runtime
              <strong>{detail?.runtimeType ?? entry.runtimeType}</strong>
            </span>
            {(detail?.packageName ?? entry.packageName) && (
              <span>
                Package
                <strong>{detail?.packageName ?? entry.packageName}</strong>
              </span>
            )}
            <span>
              Category
              <strong>{detail?.category ?? entry.category}</strong>
            </span>
            <span>
              Latest version
              <strong>{detail?.manifest.version ?? entry.latestVersion}</strong>
            </span>
          </div>

          {(docUrl || repoUrl) && (
            <div className="native-app-links">
              {docUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    void nativeApi()
                      .openExternal(docUrl)
                      .catch(() => {})
                  }
                >
                  <ExternalLink size={14} />
                  Documentation
                </Button>
              )}
              {repoUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    void nativeApi()
                      .openExternal(repoUrl)
                      .catch(() => {})
                  }
                >
                  <ExternalLink size={14} />
                  Repository
                </Button>
              )}
            </div>
          )}

          {permissions.length > 0 && (
            <section className="native-app-section">
              <h3>Requested Hub permissions</h3>
              <div className="native-app-permissions">
                <ul>
                  {permissions.map((perm) => (
                    <li key={perm}>{perm}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {detail && hasConfigFields && (
            <section className="native-app-section">
              <h3>Initial configuration</h3>
              <AppConfigFields
                options={detail.manifest.options}
                secrets={detail.manifest.secrets}
                values={values}
                disabled={busy}
                onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
              />
            </section>
          )}

          {progress && (
            <section className="native-app-section">
              <div className="native-app-progress" role="status">
                {busy && <LoaderCircle size={15} className="spin" />}
                <span>
                  {stageLabel(progress.stage)}
                  {progress.errorCode ? ` (${progress.errorCode})` : ''}
                </span>
              </div>
            </section>
          )}

          {!entry.installed && detail && (
            <div className="native-app-actions">
              <Button
                variant="primary"
                isDisabled={!admin || busy}
                isPending={busy}
                onPress={() => void submitInstall()}
              >
                <Download size={16} />
                {busy ? 'Installing…' : 'Install App'}
              </Button>
              <Button variant="ghost" isDisabled={busy} onPress={onBack}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </ConnectionDetailLayout>
  );
}
