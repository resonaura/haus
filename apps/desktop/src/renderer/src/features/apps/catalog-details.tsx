/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
import { Check, Download, ExternalLink } from 'lucide-react';
import type { BrandIconKind } from '../../../../shared/native';
import { BrandIcon } from '../../components/brand/BrandIcon';
import {
  FeatureLoading,
  OperationProgressPanel,
  computeInstallProgressPercent,
  formatByteProgress,
  formatInstallStageTitle,
} from '@haus/ui/components';
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
import { AppLiveLogs } from './live-logs';

export function catalogIconKind(runtimeType: string): BrandIconKind {
  if (runtimeType === 'homebridge') return 'homebridge';
  if (runtimeType === 'scrypted') return 'scrypted';
  if (runtimeType === 'hacs') return 'hacs';
  if (runtimeType === 'addon') return 'addon';
  return 'app';
}

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
          <HausButton variant="secondary" onPress={() => onManageApp(entry.id)}>
            <Check size={16} />
            Manage App
          </HausButton>
        ) : (
          <HausButton
            variant="primary"
            isDisabled={!admin || busy || !detail}
            isPending={busy}
            onPress={() => void submitInstall()}
          >
            <Download size={16} />
            {busy ? 'Installing…' : 'Install App'}
          </HausButton>
        )
      }
    >
      {detailError && (
        <Text semantic="p" className="form-error" role="alert">
          {detailError}
        </Text>
      )}
      {loading && <FeatureLoading />}
      {!loading && (
        <>
          {description && (
            <Text semantic="p" className="flow-description">
              {description}
            </Text>
          )}

          <Box className="addon-facts">
            <Text>
              Runtime
              <Text semantic="strong">{detail?.runtimeType ?? entry.runtimeType}</Text>
            </Text>
            {(detail?.packageName ?? entry.packageName) && (
              <Text>
                Package
                <Text semantic="strong">{detail?.packageName ?? entry.packageName}</Text>
              </Text>
            )}
            <Text>
              Category
              <Text semantic="strong">{detail?.category ?? entry.category}</Text>
            </Text>
            <Text>
              Latest version
              <Text semantic="strong">{detail?.manifest.version ?? entry.latestVersion}</Text>
            </Text>
          </Box>

          {(docUrl || repoUrl) && (
            <Box className="native-app-links">
              {docUrl && (
                <HausButton
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
                </HausButton>
              )}
              {repoUrl && (
                <HausButton
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
                </HausButton>
              )}
            </Box>
          )}

          {permissions.length > 0 && (
            <Box semantic="section" className="native-app-section">
              <Heading level={3}>Requested Hub permissions</Heading>
              <Box className="native-app-permissions">
                <Box semantic="list">
                  {permissions.map((perm) => (
                    <Box semantic="listitem" key={perm}>
                      {perm}
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          )}

          {detail && hasConfigFields && (
            <Box semantic="section" className="native-app-section">
              <Heading level={3}>Initial configuration</Heading>
              <AppConfigFields
                options={detail.manifest.options}
                secrets={detail.manifest.secrets}
                values={values}
                disabled={busy}
                onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
              />
            </Box>
          )}

          {progress && (
            <Box semantic="section" className="native-app-section">
              <OperationProgressPanel
                id="catalog-app-install-progress"
                title={formatInstallStageTitle(progress.stage)}
                detail={
                  progress.detail ??
                  formatByteProgress(progress.current, progress.total) ??
                  (progress.errorCode ? `Error code: ${progress.errorCode}` : undefined)
                }
                percent={computeInstallProgressPercent(
                  progress.stage,
                  progress.current,
                  progress.total,
                  progress.percent,
                )}
                state={
                  progress.stage === 'failed'
                    ? 'failed'
                    : progress.stage === 'complete'
                      ? 'complete'
                      : 'running'
                }
                logs={progress.logs}
                liveLogsSlot={
                  progress.stage === 'starting' || progress.stage === 'complete' ? (
                    <AppLiveLogs appId={entry.id} />
                  ) : undefined
                }
              />
            </Box>
          )}

          {!entry.installed && detail && (
            <Box className="native-app-actions">
              <HausButton
                variant="primary"
                isDisabled={!admin || busy}
                isPending={busy}
                onPress={() => void submitInstall()}
              >
                <Download size={16} />
                {busy ? 'Installing…' : 'Install App'}
              </HausButton>
              <HausButton variant="ghost" isDisabled={busy} onPress={onBack}>
                Cancel
              </HausButton>
            </Box>
          )}
        </>
      )}
    </ConnectionDetailLayout>
  );
}
