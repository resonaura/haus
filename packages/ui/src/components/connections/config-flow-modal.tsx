/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo, useState } from 'react';
import {
  buildBrandIntegrationCatalog,
  createFlowLocalization,
  flowEyebrowLabel,
  normalizeLocalizedMenuOptions,
  resolveStepDocumentationUrl,
  type BrandCatalogItem,
  type FlowStartTarget,
  type FlowStepRecord,
  type IntegrationCatalogChoice,
  type ParsedOAuthCallbackInput,
} from '@haus/core/transport';
import { corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { HausButton, HausDialog, Row, Stack, Text, useHausUi } from '../../primitives/index.js';
import { BrandIcon, type BrandIconKind } from '../brand/index.js';
import { UiIcon } from '../icon.js';
import { FlowFieldInput, type FlowFieldSnapshotContext } from './config-flow-fields.js';
import { IntegrationBrandDetailView } from './flow/brand-detail.js';
import { ConfigFlowDialogFooter } from './flow/footer.js';
import { IntegrationCatalogPicker } from './flow/picker.js';
import { PluginInstallFlowView, type EcosystemPluginInstallInfo } from './flow/plugin-install.js';
import {
  FlowMenuStepView,
  FlowOAuthStepView,
  FlowProgressStepView,
  FlowResultStepView,
  FlowTargetFallbackView,
  FlowUnsupportedView,
  type FlowUnsupportedInfo,
} from './flow/steps.js';

export interface ConfigFlowModalProps {
  readonly title: string;
  readonly target?: FlowStartTarget;
  readonly step: FlowStepRecord | null;
  readonly translations?: Readonly<Record<string, string>>;
  readonly catalog: readonly IntegrationCatalogChoice[];
  readonly brandCatalog?: readonly BrandCatalogItem[];
  readonly selectedBrand?: BrandCatalogItem | null;
  readonly selectedPlugin?: EcosystemPluginInstallInfo | null;
  readonly pluginLoading?: boolean;
  readonly pluginInstalled?: boolean;
  readonly pluginStage?: string;
  readonly unsupported?: FlowUnsupportedInfo | null;
  readonly snapshot?: FlowFieldSnapshotContext;
  readonly pickerQuery: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly busy?: boolean;
  readonly error?: string;
  readonly isHubSession?: boolean;
  readonly onPickerQueryChange: (query: string) => void;
  readonly onStartDomain: (choice: IntegrationCatalogChoice) => void;
  readonly onSelectBrand?: (brand: BrandCatalogItem | null) => void;
  readonly onLaunchDriver?: (driver: BrandCatalogItem) => void;
  readonly onInstallPlugin?: () => void;
  readonly onContinueInstalledPlugin?: () => void;
  readonly onBackFromPlugin?: () => void;
  readonly onChangeValues: (values: Record<string, unknown>) => void;
  readonly onSubmitForm: () => void;
  readonly onSelectMenu: (optionKey: string) => void;
  readonly onOpenExternalUrl: (url: string) => void;
  readonly onSubmitOAuthCallback?: (parsed: ParsedOAuthCallbackInput) => void;
  readonly onSaveAppCredentials?: (clientId: string, clientSecret: string) => void;
  readonly onCopyText?: (text: string) => void;
  readonly onRetry?: () => void;
  readonly onBrowseAll?: () => void;
  readonly onClose: () => void;
}

function headerIconKindFor(plugin: EcosystemPluginInstallInfo | null | undefined): BrandIconKind {
  if (!plugin) return 'integration';
  if (plugin.runtime === 'docker') return 'app';
  return plugin.runtime;
}

/**
 * Shared Electron & GPUIX Integration Configuration, Repair, Options, Reauth,
 * Brand Catalog Picker, and Ecosystem Driver Install modal.
 */
export const ConfigFlowModal = memo(function ConfigFlowModal({
  title,
  target,
  step,
  translations,
  catalog,
  brandCatalog,
  selectedBrand,
  selectedPlugin,
  pluginLoading = false,
  pluginInstalled = false,
  pluginStage,
  unsupported,
  snapshot,
  pickerQuery,
  values,
  fieldErrors,
  busy = false,
  error,
  isHubSession = false,
  onPickerQueryChange,
  onStartDomain,
  onSelectBrand,
  onLaunchDriver,
  onInstallPlugin,
  onContinueInstalledPlugin,
  onBackFromPlugin,
  onChangeValues,
  onSubmitForm,
  onSelectMenu,
  onOpenExternalUrl,
  onSubmitOAuthCallback,
  onSaveAppCredentials,
  onCopyText,
  onRetry,
  onBrowseAll,
  onClose,
}: ConfigFlowModalProps) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const primaryFg = dark ? '#101010' : '#ffffff';
  const [selectedMenuKey, setSelectedMenuKey] = useState('');
  const [internalBrand, setInternalBrand] = useState<BrandCatalogItem | null>(null);

  const activeBrand = selectedBrand !== undefined ? selectedBrand : internalBrand;
  const setActiveBrand = (next: BrandCatalogItem | null) => {
    if (onSelectBrand) onSelectBrand(next);
    else setInternalBrand(next);
  };

  const resolvedBrandCatalog = useMemo<readonly BrandCatalogItem[]>(() => {
    if (brandCatalog && brandCatalog.length > 0) return brandCatalog;
    const names = Object.fromEntries(catalog.map((c) => [c.domain, c.title]));
    return buildBrandIntegrationCatalog(
      catalog.map((c) => c.domain),
      names,
    );
  }, [brandCatalog, catalog]);

  const domain =
    step?.handler ??
    target?.repair?.domain ??
    target?.domain ??
    activeBrand?.iconId ??
    activeBrand?.id ??
    '';

  const localization = useMemo(
    () =>
      createFlowLocalization({
        domain,
        integrationTitle: selectedPlugin?.title ?? activeBrand?.title ?? title,
        kind: target?.kind ?? 'config',
        repair: target?.repair,
        step,
        translations,
      }),
    [
      activeBrand?.title,
      domain,
      selectedPlugin?.title,
      step,
      target?.kind,
      target?.repair,
      title,
      translations,
    ],
  );

  const menuOptions = useMemo(
    () => (step?.type === 'menu' ? normalizeLocalizedMenuOptions(step, localization) : []),
    [localization, step],
  );
  const activeMenuKey = menuOptions.some((o) => o.key === selectedMenuKey)
    ? selectedMenuKey
    : (menuOptions[0]?.key ?? '');

  const hasTarget = Boolean(
    target?.flowId || target?.domain || target?.entryId || target?.repair || selectedPlugin,
  );
  const isPicker = !step && !hasTarget && !activeBrand;
  const eyebrow = flowEyebrowLabel({
    repair: target?.repair,
    reauth: target?.reauth,
    reconfigure: target?.reconfigure,
    kind: target?.kind,
    appRuntime: selectedPlugin?.runtime,
  });
  const dialogTitle = selectedPlugin
    ? selectedPlugin.title
    : activeBrand && !step
      ? activeBrand.title
      : step
        ? localization.title
        : title;
  const docsUrl =
    selectedPlugin?.documentationUrl ??
    (step ? resolveStepDocumentationUrl(step, domain) : undefined);

  const headerIconId = selectedPlugin ? selectedPlugin.appId : domain || undefined;
  const headerLeading = headerIconId ? (
    <BrandIcon
      kind={headerIconKindFor(selectedPlugin)}
      id={headerIconId}
      size={40}
      hint={{
        name: selectedPlugin?.title ?? activeBrand?.title ?? title,
        ...(step?.supported_by ? { supportedBy: step.supported_by } : {}),
      }}
    />
  ) : undefined;

  const headerActions = docsUrl ? (
    <HausButton
      id="flow-header-docs"
      variant="ghost"
      size="sm"
      title="Open integration documentation"
      aria-label="Open documentation"
      onPress={() => onOpenExternalUrl(docsUrl)}
    >
      <UiIcon name="circle-help" size={16} />
    </HausButton>
  ) : undefined;

  const handleSelectBrandFromPicker = (brand: BrandCatalogItem) => {
    const drivers = brand.groupItems ?? [brand];
    if (drivers.length > 1 || brand.isCombinedHausGovee) {
      setActiveBrand(brand);
      return;
    }
    const single = drivers[0] ?? brand;
    if (onLaunchDriver) {
      onLaunchDriver(single);
      return;
    }
    onStartDomain({ domain: single.domain ?? single.id, title: single.title });
  };

  const handleLaunchFromDetail = (driver: BrandCatalogItem) => {
    if (onLaunchDriver) {
      onLaunchDriver(driver);
      return;
    }
    onStartDomain({ domain: driver.domain ?? driver.id, title: driver.title });
  };

  const footer = (
    <ConfigFlowDialogFooter
      step={step}
      selectedPlugin={selectedPlugin}
      pluginLoading={pluginLoading}
      pluginInstalled={pluginInstalled}
      unsupported={Boolean(unsupported)}
      busy={busy}
      submitLabel={localization.submitLabel}
      activeMenuKey={activeMenuKey}
      primaryFg={primaryFg}
      onBackFromPlugin={onBackFromPlugin}
      onInstallPlugin={onInstallPlugin}
      onSubmitForm={onSubmitForm}
      onSelectMenu={onSelectMenu}
      onClose={onClose}
    />
  );

  return (
    <HausDialog
      size={isPicker || (Boolean(activeBrand) && !step) ? 'lg' : 'md'}
      eyebrow={eyebrow}
      title={dialogTitle}
      headerLeading={headerLeading}
      headerActions={headerActions}
      scrollable
      onClose={onClose}
      footer={footer}
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        {error && !selectedPlugin && (
          <Row
            align="center"
            gapPx={8}
            style={{
              layout: { width: pct(100), padding: insets(10, 12) },
              material: new SolidMaterial(rgba(239, 68, 68, dark ? 0.14 : 0.1)),
              border: { width: 1, color: rgba(239, 68, 68, 0.34) },
              corners: corners(12),
            }}
          >
            <UiIcon name="alert-circle" size={15} color={dark ? '#fca5a5' : '#b91c1c'} />
            <Text size={12} tone="critical" style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              {error}
            </Text>
          </Row>
        )}

        {selectedPlugin && (
          <PluginInstallFlowView
            plugin={selectedPlugin}
            loading={pluginLoading}
            busy={busy}
            installed={pluginInstalled}
            stage={pluginStage}
            error={error}
            hideInlineActions
            onBack={onBackFromPlugin}
            onOpenExternal={onOpenExternalUrl}
            onInstall={() => onInstallPlugin?.()}
            onContinueSetup={onContinueInstalledPlugin}
          />
        )}

        {!selectedPlugin && !step && activeBrand && (
          <IntegrationBrandDetailView
            brand={activeBrand}
            busy={busy}
            onBack={() => setActiveBrand(null)}
            onLaunchDriver={handleLaunchFromDetail}
          />
        )}

        {isPicker && (
          <IntegrationCatalogPicker
            catalog={resolvedBrandCatalog}
            query={pickerQuery}
            busy={busy}
            onQueryChange={onPickerQueryChange}
            onSelectBrand={handleSelectBrandFromPicker}
          />
        )}

        {hasTarget && !step && !selectedPlugin && !activeBrand && (
          <FlowTargetFallbackView
            title={title || domain || 'device'}
            busy={busy}
            onRetry={onRetry}
            onBrowseAll={onBrowseAll}
          />
        )}

        {!selectedPlugin && step && unsupported && (
          <FlowUnsupportedView
            unsupported={unsupported}
            domainName={title || domain}
            onOpenWeb={onOpenExternalUrl}
          />
        )}

        {!selectedPlugin && !unsupported && step?.type === 'form' && (
          <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
            <Text size={12.5} tone="muted" style={{ typography: { size: 12.5, lineHeight: 1.45 } }}>
              {localization.description ||
                (step.data_schema?.length
                  ? 'Enter the details for this connection.'
                  : 'Continue when your device is ready.')}
            </Text>
            {step.errors?.base && (
              <Row
                align="center"
                gapPx={8}
                style={{
                  layout: { width: pct(100), padding: insets(10, 12) },
                  material: new SolidMaterial(rgba(239, 68, 68, dark ? 0.14 : 0.1)),
                  border: { width: 1, color: rgba(239, 68, 68, 0.34) },
                  corners: corners(12),
                }}
              >
                <UiIcon name="alert-circle" size={15} color={dark ? '#fca5a5' : '#b91c1c'} />
                <Text size={12} tone="critical">
                  {localization.errorText(step.errors.base)}
                </Text>
              </Row>
            )}
            {(step.data_schema ?? []).map((field) => {
              const rawErr = fieldErrors[field.name] ?? step.errors?.[field.name];
              return (
                <FlowFieldInput
                  key={field.name}
                  field={field}
                  step={step}
                  value={values[field.name]}
                  error={rawErr ? localization.errorText(rawErr) : undefined}
                  fieldErrors={fieldErrors}
                  disabled={busy}
                  localization={localization}
                  snapshot={snapshot}
                  onCopyText={onCopyText}
                  onChange={(nextVal) => onChangeValues({ ...values, [field.name]: nextVal })}
                />
              );
            })}
          </Stack>
        )}

        {!selectedPlugin && !unsupported && step?.type === 'menu' && (
          <FlowMenuStepView
            options={menuOptions}
            activeKey={activeMenuKey}
            description={localization.description}
            busy={busy}
            onSelectKey={setSelectedMenuKey}
            onDoubleSelect={onSelectMenu}
          />
        )}

        {!selectedPlugin && !unsupported && step?.type === 'external' && (
          <FlowOAuthStepView
            domain={domain}
            domainName={title || domain}
            url={step.url}
            description={localization.description}
            busy={busy}
            canSubmitManualCallback={isHubSession && Boolean(onSubmitOAuthCallback)}
            onOpenExternal={() => step.url && onOpenExternalUrl(step.url)}
            onSubmitManualCallback={onSubmitOAuthCallback}
          />
        )}

        {!selectedPlugin &&
          !unsupported &&
          step &&
          ['progress', 'progress_done', 'external_done'].includes(step.type) && (
            <FlowProgressStepView
              message={localization.progressText(step.progress_action, localization.description)}
            />
          )}

        {!selectedPlugin &&
          !unsupported &&
          step &&
          (step.type === 'create_entry' || step.type === 'abort') && (
            <FlowResultStepView
              step={step}
              domain={domain}
              domainName={title || domain}
              localization={localization}
              isRepair={Boolean(target?.repair)}
              canSaveAppCredentials={isHubSession && Boolean(onSaveAppCredentials)}
              busy={busy}
              onSaveAppCredentials={onSaveAppCredentials}
            />
          )}
      </Stack>
    </HausDialog>
  );
});
