/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
import {
  OperationProgressPanel,
  computeInstallProgressPercent,
  formatByteProgress,
  formatInstallStageTitle,
} from '@haus/ui/components';
import { ArrowLeft, Check, Download, ExternalLink, LoaderCircle } from 'lucide-react';
import { nativeApi } from '../../../ha/management';
import { appRequest } from '../../apps/api';
import {
  initialConfigFromManifest,
  parseCatalogDetail,
  parseInstallProgress,
  requiredManifestPermissions,
  sanitizeOptionsSubmission,
  type AppInstallProgress,
  type CatalogAppDetail,
} from '../../apps/catalog-api';
import { AppConfigFields } from '../../apps/config-form';
import { formatHacsRepositoryError, hacs } from '../../community/hacs';

export function PluginInstallStep({
  appId,
  runtime,
  hacsRepositoryId,
  hacsDomain,
  onBack,
  onCancel,
  onInstalled,
  onConfigureHacsDomain,
}: {
  appId: string;
  runtime: 'hacs' | 'homebridge' | 'scrypted' | 'docker';
  hacsRepositoryId?: string;
  hacsDomain?: string;
  onBack?: () => void;
  onCancel: () => void;
  onInstalled: () => void;
  onConfigureHacsDomain?: (domain: string) => void;
}) {
  const [detail, setDetail] = useState<CatalogAppDetail>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [progress, setProgress] = useState<AppInstallProgress>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setError('');
    setDetail(undefined);
    setProgress(undefined);
    void appRequest('GET', `apps/catalog/${encodeURIComponent(appId)}`)
      .then((raw) => {
        const parsed = parseCatalogDetail(raw);
        if (!mounted.current) return;
        setDetail(parsed);
        setValues(initialConfigFromManifest(parsed.manifest));
      })
      .catch((reason: unknown) => {
        if (mounted.current) {
          setError(reason instanceof Error ? reason.message : 'Could not load plugin details.');
        }
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [appId]);

  useEffect(() => {
    if (!busy || runtime === 'hacs') return;
    let active = true;
    const poll = () => {
      void appRequest('GET', `apps/${encodeURIComponent(appId)}/install-progress`)
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
  }, [appId, busy, runtime]);

  const handleInstall = async () => {
    if (busy) return;
    if (runtime === 'hacs') {
      const targetRepo =
        hacsRepositoryId ?? detail?.hacsRepositoryId ?? hacsDomain ?? detail?.domain;
      if (!targetRepo) {
        setError('Missing HACS repository identifier.');
        return;
      }
      setBusy(true);
      setError('');
      setProgress({
        appId,
        stage: 'pulling',
        detail: `Downloading HACS repository ${String(targetRepo)}…`,
        logs: [`[PULL] Requesting HACS download for ${String(targetRepo)}…`],
      });
      try {
        await hacs('repository/download', { repository: String(targetRepo) });
        if (!mounted.current) return;
        setProgress({
          appId,
          stage: 'complete',
          percent: 100,
          detail: 'HACS extension downloaded and registered.',
          logs: [
            `[PULL] Requesting HACS download for ${String(targetRepo)}…`,
            `[OK] Installed ${String(targetRepo)} into custom_components.`,
          ],
        });
        setInstalled(true);
        const resolvedDomain = hacsDomain ?? detail?.domain;
        if (resolvedDomain && onConfigureHacsDomain) {
          onConfigureHacsDomain(resolvedDomain);
        } else {
          onInstalled();
        }
      } catch (reason: unknown) {
        if (mounted.current) {
          const msg = formatHacsRepositoryError(reason);
          setError(msg);
          setProgress({
            appId,
            stage: 'failed',
            percent: 100,
            detail: msg,
            logs: [`[PULL] Requesting HACS download for ${String(targetRepo)}…`, `[ERROR] ${msg}`],
          });
        }
      } finally {
        if (mounted.current) setBusy(false);
      }
      return;
    }

    if (!detail) return;
    setBusy(true);
    setError('');
    setProgress({
      appId: detail.manifest.id,
      stage: 'validating',
      logs: [`[INFO] Preparing ${detail.manifest.name} (${runtimeLabel})…`],
    });
    try {
      const grantedPermissions = requiredManifestPermissions(detail.manifest);
      const config = sanitizeOptionsSubmission(detail.manifest, values);
      await appRequest('POST', 'apps/install', {
        manifest: detail.manifest,
        grantedPermissions,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      if (!mounted.current) return;
      setInstalled(true);
      onInstalled();
    } catch (reason: unknown) {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : 'Plugin installation failed.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const hasConfigFields = Boolean(
    (detail?.manifest.options && detail.manifest.options.length > 0) ||
    (detail?.manifest.secrets && detail.manifest.secrets.length > 0),
  );
  const runtimeLabel =
    runtime === 'hacs'
      ? 'HACS'
      : runtime === 'homebridge'
        ? 'Homebridge'
        : runtime === 'scrypted'
          ? 'Scrypted'
          : 'Docker';
  const packageName = detail?.domain ?? hacsDomain ?? detail?.packageName ?? appId;

  return (
    <Box className="plugin-install-step">
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
      {loading && (
        <Box className="management-loading">
          <LoaderCircle className="spin" />
          Loading {runtimeLabel} plugin details…
        </Box>
      )}
      {!loading && detail && (
        <>
          {detail.manifest.description && (
            <Text semantic="p" className="flow-description">
              {detail.manifest.description}
            </Text>
          )}
          <Box className="addon-facts">
            <Text>
              Ecosystem
              <Text semantic="strong">
                {runtimeLabel}
                {detail.verified ? ' · Verified' : ''}
              </Text>
            </Text>
            <Text>
              Package
              <Text semantic="strong">{packageName}</Text>
            </Text>
            <Text>
              Version
              <Text semantic="strong">{detail.manifest.version}</Text>
            </Text>
            <Text>
              Category
              <Text semantic="strong">{detail.category}</Text>
            </Text>
          </Box>

          {(detail.documentationUrl || detail.repositoryUrl) && (
            <Box className="native-app-links">
              {detail.documentationUrl && (
                <HausButton
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    void nativeApi()
                      .openExternal(detail.documentationUrl!)
                      .catch(() => {})
                  }
                >
                  <ExternalLink size={14} />
                  Documentation
                </HausButton>
              )}
              {detail.repositoryUrl && (
                <HausButton
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    void nativeApi()
                      .openExternal(detail.repositoryUrl!)
                      .catch(() => {})
                  }
                >
                  <ExternalLink size={14} />
                  Repository
                </HausButton>
              )}
            </Box>
          )}

          {hasConfigFields && !installed && (
            <Box semantic="section" className="native-app-panel">
              <Box className="native-app-panel-head">
                <Box>
                  <Heading level={3}>Initial Configuration</Heading>
                  <Text semantic="p">
                    Provide plugin settings before starting the {runtimeLabel} runtime.
                  </Text>
                </Box>
              </Box>
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
            <OperationProgressPanel
              id="plugin-install-progress"
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
            />
          )}
        </>
      )}

      <Box className="plugin-install-actions">
        {onBack && (
          <HausButton variant="ghost" isDisabled={busy} onPress={onBack}>
            <ArrowLeft size={15} />
            Back
          </HausButton>
        )}
        <Box className="plugin-install-actions-right">
          <HausButton variant="ghost" isDisabled={busy} onPress={onCancel}>
            {installed ? 'Close' : 'Cancel'}
          </HausButton>
          {installed ? (
            <HausButton variant="secondary" onPress={onInstalled}>
              <Check size={15} />
              Done
            </HausButton>
          ) : (
            <HausButton
              variant="primary"
              isDisabled={loading || busy || (!detail && runtime !== 'hacs')}
              isPending={busy}
              onPress={() => void handleInstall()}
            >
              <Download size={15} />
              {busy
                ? 'Downloading…'
                : runtime === 'hacs'
                  ? 'Download & Set Up'
                  : `Install ${runtimeLabel} Plugin`}
            </HausButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}
