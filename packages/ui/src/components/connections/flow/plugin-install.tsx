/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { colorToken, corners, insets, pct, px, rgba } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import { HausButton, Row, Stack, Text, useHausUi } from '../../../primitives/index.js';
import { ManagementGlassCard, ManagementStatusPill } from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

export interface EcosystemPluginInstallInfo {
  readonly appId: string;
  readonly title: string;
  readonly runtime: 'hacs' | 'homebridge' | 'scrypted' | 'docker';
  readonly packageName?: string;
  readonly version?: string;
  readonly category?: string;
  readonly description?: string;
  readonly verified?: boolean;
  readonly documentationUrl?: string;
  readonly repositoryUrl?: string;
  readonly hacsRepositoryId?: string;
  readonly hacsDomain?: string;
}

const STAGE_LABELS: Readonly<Record<string, string>> = {
  validating: 'Validating manifest…',
  'checking-local': 'Checking local packages…',
  pulling: 'Downloading package…',
  building: 'Installing dependencies…',
  ready: 'Package ready…',
  creating: 'Initializing runtime…',
  starting: 'Starting runtime…',
  complete: 'Installed and ready',
  failed: 'Installation failed',
};

function runtimeDisplay(runtime: EcosystemPluginInstallInfo['runtime']): string {
  if (runtime === 'hacs') return 'HACS';
  if (runtime === 'homebridge') return 'Homebridge';
  if (runtime === 'scrypted') return 'Scrypted';
  return 'Docker';
}

function FactTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Stack
      gapPx={2}
      style={{
        layout: { flexGrow: 1, flexShrink: 1, minWidth: px(120), padding: insets(10, 12) },
        material: new SolidMaterial(colorToken('surface')),
        border: { width: 1, color: colorToken('borderSubtle') },
        corners: corners(12),
      }}
    >
      <Text size={10.5} weight={600} tone="muted">
        {label}
      </Text>
      <Text
        size={12.5}
        weight={600}
        style={{ typography: { size: 12.5, weight: 600, maxLines: 1, truncate: true } }}
      >
        {value}
      </Text>
    </Stack>
  );
}

/**
 * Shared glass view for installing HACS, Homebridge, Scrypted, or Docker drivers
 * directly inside the unified device setup flow.
 */
export function PluginInstallFlowView({
  plugin,
  loading = false,
  busy = false,
  installed = false,
  stage,
  error,
  hideInlineActions = false,
  onBack,
  onOpenExternal,
  onInstall,
  onContinueSetup,
}: {
  readonly plugin: EcosystemPluginInstallInfo;
  readonly loading?: boolean;
  readonly busy?: boolean;
  readonly installed?: boolean;
  readonly stage?: string;
  readonly error?: string;
  readonly hideInlineActions?: boolean;
  readonly onBack?: () => void;
  readonly onOpenExternal?: (url: string) => void;
  readonly onInstall: () => void;
  readonly onContinueSetup?: () => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const primaryFg = dark ? '#101010' : '#ffffff';
  const rtLabel = runtimeDisplay(plugin.runtime);
  const pkgName = plugin.hacsDomain ?? plugin.packageName ?? plugin.appId;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      {!hideInlineActions && onBack && !busy && (
        <Row>
          <HausButton id="plugin-install-back" variant="ghost" size="sm" onPress={onBack}>
            <UiIcon name="arrow-left" size={14} />
            <Text size={12.5}>Back</Text>
          </HausButton>
        </Row>
      )}

      {error && (
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(10, 12) },
            material: new SolidMaterial(rgba(239, 68, 68, dark ? 0.14 : 0.1)),
            border: { width: 1, color: rgba(239, 68, 68, 0.34) },
            corners: corners(14),
          }}
        >
          <UiIcon name="alert-circle" size={15} color={dark ? '#fca5a5' : '#b91c1c'} />
          <Text size={12.5} tone="critical">
            {error}
          </Text>
        </Row>
      )}

      {loading ? (
        <ManagementGlassCard
          radius={18}
          padding={insets(20)}
          style={{ layout: { width: pct(100) } }}
        >
          <Row align="center" gapPx={10}>
            <UiIcon name="loader-circle" size={16} />
            <Text size={13} tone="muted">
              {`Loading ${rtLabel} plugin details…`}
            </Text>
          </Row>
        </ManagementGlassCard>
      ) : (
        <>
          {plugin.description && (
            <Text size={13} tone="muted" style={{ typography: { size: 13, lineHeight: 1.45 } }}>
              {plugin.description}
            </Text>
          )}

          <ManagementGlassCard
            radius={20}
            padding={insets(12)}
            style={{ layout: { width: pct(100) } }}
          >
            <Row gapPx={8} wrap style={{ layout: { width: pct(100) } }}>
              <FactTile
                label="ECOSYSTEM"
                value={plugin.verified ? `${rtLabel} · Verified` : rtLabel}
              />
              <FactTile label="PACKAGE" value={pkgName} />
              {plugin.version && <FactTile label="VERSION" value={plugin.version} />}
              {plugin.category && <FactTile label="CATEGORY" value={plugin.category} />}
            </Row>
          </ManagementGlassCard>

          {(plugin.documentationUrl || plugin.repositoryUrl) && onOpenExternal && (
            <Row gapPx={8} wrap>
              {plugin.documentationUrl && (
                <HausButton
                  variant="ghost"
                  size="sm"
                  onPress={() => onOpenExternal(plugin.documentationUrl!)}
                >
                  <UiIcon name="external-link" size={13} />
                  <Text size={12}>Documentation</Text>
                </HausButton>
              )}
              {plugin.repositoryUrl && (
                <HausButton
                  variant="ghost"
                  size="sm"
                  onPress={() => onOpenExternal(plugin.repositoryUrl!)}
                >
                  <UiIcon name="external-link" size={13} />
                  <Text size={12}>Repository</Text>
                </HausButton>
              )}
            </Row>
          )}

          {(busy || stage) && !installed && (
            <Row
              align="center"
              gapPx={10}
              style={{
                layout: { width: pct(100), padding: insets(12, 14) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(14),
              }}
            >
              <UiIcon name="loader-circle" size={16} />
              <Stack gapPx={2}>
                <Text size={12.5} weight={600}>
                  {STAGE_LABELS[stage ?? ''] ?? 'Installing driver…'}
                </Text>
                <Text size={11.5} tone="muted">
                  Haus is provisioning this integration runtime on your Hub.
                </Text>
              </Stack>
            </Row>
          )}

          {installed && (
            <Row
              align="center"
              justify="between"
              gapPx={10}
              wrap
              style={{
                layout: { width: pct(100), padding: insets(14) },
                material: new SolidMaterial(rgba(52, 211, 153, dark ? 0.14 : 0.1)),
                border: { width: 1, color: rgba(52, 211, 153, 0.36) },
                corners: corners(16),
              }}
            >
              <Row align="center" gapPx={10}>
                <UiIcon name="check-circle" size={18} color="#34d399" />
                <Stack gapPx={2}>
                  <Row align="center" gapPx={6}>
                    <Text size={13.5} weight={600}>
                      {`${plugin.title} installed`}
                    </Text>
                    <ManagementStatusPill label="Ready" tone="success" />
                  </Row>
                  <Text size={12} tone="muted">
                    {plugin.runtime === 'hacs' && plugin.hacsDomain
                      ? 'Continue to configure this integration with your devices.'
                      : 'Driver is running on your Hub.'}
                  </Text>
                </Stack>
              </Row>
              {onContinueSetup && (
                <HausButton variant="primary" size="sm" onPress={onContinueSetup}>
                  <Text
                    size={12}
                    style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                  >
                    Configure now
                  </Text>
                </HausButton>
              )}
            </Row>
          )}

          {!hideInlineActions && !installed && (
            <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
              <HausButton
                id="plugin-install-submit"
                variant="primary"
                disabled={busy}
                onPress={onInstall}
              >
                <UiIcon name={busy ? 'loader-circle' : 'plus'} size={14} color={primaryFg} />
                <Text
                  size={12.5}
                  style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                >
                  {busy
                    ? 'Installing…'
                    : plugin.runtime === 'hacs'
                      ? 'Download & configure'
                      : `Install ${rtLabel} driver`}
                </Text>
              </HausButton>
            </Row>
          )}
        </>
      )}
    </Stack>
  );
}
