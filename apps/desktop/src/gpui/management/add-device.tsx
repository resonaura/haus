/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildBrandIntegrationCatalog,
  buildDemoOnboardingState,
  extractFlowErrorMessage,
  type EcosystemCatalogSourceItem,
  type FlowStartTarget,
  type IntegrationCatalogChoice,
  type ManagementPort,
  type OnboardingDiscoveredFlow,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  AddDeviceModal,
  CameraSetupModal,
  CommissioningModal,
  ConfigFlowModal,
  ManualCameraSetupModal,
} from '@haus/ui/components';
import {
  fetchLiveOnboardingState,
  searchLiveEcosystemCatalog,
  startLiveManualCameraFlow,
  updateLiveCameraEntity,
} from './add-device-live.js';
import type { GpuiRpcRequest } from './integrations.js';
import { buildCameraDomainSet, buildExistingCameraOptions } from './onboarding/camera-helper.js';
import { useGpuiCommissioning } from './onboarding/use-commissioning.js';
import { useGpuiConfigFlow } from './onboarding/use-config-flow.js';

export type GpuiAddDeviceRequest =
  | { readonly mode: 'picker' }
  | { readonly mode: 'code'; readonly initialCode?: string }
  | { readonly mode: 'camera' }
  | { readonly mode: 'flow'; readonly target: FlowStartTarget };

type ModalViewMode = 'picker' | 'code' | 'camera' | 'camera-manual' | 'camera-existing' | 'flow';

export function GpuiAddDeviceModal({
  snapshot,
  demo,
  sessionKind,
  management,
  requestRpc,
  openExternal,
  onCopyText,
  initialRequest,
  onOpenApps,
  onClose,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly demo?: boolean;
  readonly sessionKind?: 'haus-hub' | 'home-assistant';
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly openExternal?: (url: string) => Promise<void>;
  readonly onCopyText?: (text: string) => void;
  readonly initialRequest: GpuiAddDeviceRequest;
  readonly onOpenApps: () => void;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}) {
  const isHubSession = sessionKind === 'haus-hub';
  const [viewMode, setViewMode] = useState<ModalViewMode>(initialRequest.mode);
  const [searchQuery, setSearchQuery] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [domainFilter, setDomainFilter] = useState<ReadonlySet<string> | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const demoState = useMemo(() => (demo ? buildDemoOnboardingState() : undefined), [demo]);
  const [discovered, setDiscovered] = useState<readonly OnboardingDiscoveredFlow[]>(
    () => demoState?.discovered ?? [],
  );
  const [catalog, setCatalog] = useState<readonly IntegrationCatalogChoice[]>(
    () => demoState?.catalog ?? [],
  );
  const [names, setNames] = useState<Readonly<Record<string, string>>>(() =>
    demoState ? Object.fromEntries(demoState.catalog.map((c) => [c.domain, c.title])) : {},
  );
  const [ecosystemApps, setEcosystemApps] = useState<readonly EcosystemCatalogSourceItem[]>(
    () => demoState?.ecosystemApps ?? [],
  );
  const [liveSearchApps, setLiveSearchApps] = useState<readonly EcosystemCatalogSourceItem[]>([]);

  const rooms = useMemo(
    () => snapshot.areas.map((a) => ({ id: a.area_id, name: a.name })),
    [snapshot.areas],
  );
  const existingCameras = useMemo(() => buildExistingCameraOptions(snapshot), [snapshot]);

  const commissioning = useGpuiCommissioning({
    initialCode: initialRequest.mode === 'code' ? initialRequest.initialCode : '',
    demo,
    management,
    rooms,
    onSaved,
    onClose,
  });

  const enterFlowView = useCallback(() => setViewMode('flow'), []);
  const flow = useGpuiConfigFlow({
    initialTarget: initialRequest.mode === 'flow' ? initialRequest.target : undefined,
    autoStartLive: initialRequest.mode === 'flow',
    demo,
    isHubSession,
    management,
    requestRpc,
    onEnterFlowView: enterFlowView,
    onSaved,
  });

  const loadDiscovery = useCallback(async () => {
    if (demo) {
      const next = buildDemoOnboardingState();
      setDiscovered(next.discovered);
      setCatalog(next.catalog);
      setNames(Object.fromEntries(next.catalog.map((c) => [c.domain, c.title])));
      setEcosystemApps(next.ecosystemApps);
      return;
    }
    setPickerLoading(true);
    try {
      const loaded = await fetchLiveOnboardingState({ management, requestRpc });
      setDiscovered(loaded.discovered);
      setCatalog(loaded.catalog);
      setNames(loaded.names);
      setEcosystemApps(loaded.ecosystemApps);
    } finally {
      setPickerLoading(false);
    }
  }, [demo, management, requestRpc]);

  useEffect(() => {
    void loadDiscovery();
  }, [loadDiscovery]);

  const activeQuery = viewMode === 'flow' ? flow.flowPickerQuery : searchQuery;
  useEffect(() => {
    if (demo || !management) return;
    const trimmed = activeQuery.trim();
    if (trimmed.length < 2) {
      setLiveSearchApps([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void searchLiveEcosystemCatalog(management, trimmed).then((found) => {
        if (active) setLiveSearchApps(found);
      });
    }, 260);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeQuery, demo, management]);

  const brandCatalog = useMemo(() => {
    const mergedEco =
      liveSearchApps.length > 0
        ? [
            ...new Map(
              [...ecosystemApps, ...liveSearchApps].map((item) => [item.id, item]),
            ).values(),
          ]
        : ecosystemApps;
    const handlers = catalog
      .map((c) => c.domain)
      .filter((d) => !domainFilter || domainFilter.has(d));
    const filteredEco = domainFilter
      ? mergedEco.filter(
          (e) =>
            (e.domain && domainFilter.has(e.domain)) ||
            (e.vendorId && domainFilter.has(e.vendorId)) ||
            e.runtimeType === 'scrypted',
        )
      : mergedEco;
    return buildBrandIntegrationCatalog(handlers, names, filteredEco);
  }, [catalog, domainFilter, ecosystemApps, liveSearchApps, names]);

  if (viewMode === 'camera') {
    return (
      <CameraSetupModal
        existingCameraCount={existingCameras.length}
        onChooseApps={() => {
          onClose();
          onOpenApps();
        }}
        onChooseFindBrand={() => {
          setDomainFilter(buildCameraDomainSet(snapshot));
          flow.openFlowTarget({ title: 'Find a camera' });
        }}
        onChooseExisting={
          existingCameras.length > 0
            ? () => {
                setCameraError('');
                setViewMode('camera-existing');
              }
            : undefined
        }
        onChooseManual={() => {
          setCameraError('');
          setViewMode('camera-manual');
        }}
        onBack={() => setViewMode('picker')}
        onClose={onClose}
      />
    );
  }

  if (viewMode === 'camera-manual' || viewMode === 'camera-existing') {
    return (
      <ManualCameraSetupModal
        mode={viewMode === 'camera-existing' ? 'existing' : 'manual'}
        existingCameras={existingCameras}
        rooms={rooms}
        busy={cameraBusy}
        error={cameraError || undefined}
        onBack={() => setViewMode('camera')}
        onSubmitExisting={(input) => {
          if (demo) {
            onSaved?.();
            onClose();
            return;
          }
          if (!requestRpc) {
            setCameraError('Connect your Hub to update camera settings.');
            return;
          }
          setCameraBusy(true);
          setCameraError('');
          void updateLiveCameraEntity(requestRpc, input)
            .then(() => {
              onSaved?.();
              onClose();
            })
            .catch((err: unknown) => setCameraError(extractFlowErrorMessage(err)))
            .finally(() => setCameraBusy(false));
        }}
        onSubmitManual={(input) => {
          if (demo) {
            flow.openFlowTarget({ domain: 'generic', title: input.name || 'Generic Camera' });
            return;
          }
          if (!management) {
            setCameraError('Connect your Hub to add a camera.');
            return;
          }
          setCameraBusy(true);
          setCameraError('');
          void startLiveManualCameraFlow(management, input)
            .then((nextStep) => {
              flow.setFlowTarget({ domain: 'generic', title: input.name || 'Generic Camera' });
              setViewMode('flow');
              flow.markOwnedFlow();
              flow.acceptFlowStep(nextStep);
            })
            .catch((err: unknown) => setCameraError(extractFlowErrorMessage(err)))
            .finally(() => setCameraBusy(false));
        }}
        onClose={onClose}
      />
    );
  }

  if (viewMode === 'code') {
    return <CommissioningModal {...commissioning} />;
  }

  if (viewMode === 'flow') {
    return (
      <ConfigFlowModal
        title={flow.flowTarget.title ?? 'Connect an integration'}
        target={flow.flowTarget}
        step={flow.flowStep}
        translations={flow.stepTranslations}
        catalog={catalog}
        brandCatalog={brandCatalog}
        selectedBrand={flow.selectedBrand}
        selectedPlugin={flow.selectedPlugin}
        pluginLoading={flow.pluginLoading}
        pluginInstalled={flow.pluginInstalled}
        pluginStage={flow.pluginStage}
        unsupported={flow.unsupported}
        snapshot={snapshot}
        pickerQuery={flow.flowPickerQuery}
        values={flow.flowValues}
        fieldErrors={flow.flowFieldErrors}
        busy={flow.flowBusy}
        error={flow.flowError || undefined}
        isHubSession={isHubSession}
        onPickerQueryChange={flow.setFlowPickerQuery}
        onStartDomain={(c) =>
          flow.openFlowTarget({ ...flow.flowTarget, domain: c.domain, title: c.title })
        }
        onSelectBrand={flow.setSelectedBrand}
        onLaunchDriver={flow.launchDriver}
        onInstallPlugin={flow.installPlugin}
        onContinueInstalledPlugin={
          flow.selectedPlugin?.runtime === 'hacs' && flow.selectedPlugin.hacsDomain
            ? () =>
                flow.openFlowTarget({
                  domain: flow.selectedPlugin!.hacsDomain,
                  title: flow.selectedPlugin!.title,
                })
            : undefined
        }
        onBackFromPlugin={flow.clearPlugin}
        onChangeValues={flow.setFlowValues}
        onSubmitForm={flow.submitForm}
        onSelectMenu={flow.selectMenu}
        onOpenExternalUrl={(url) => {
          if (url && openExternal) {
            void openExternal(url).catch((err: unknown) =>
              flow.setFlowError(extractFlowErrorMessage(err)),
            );
          }
        }}
        onSubmitOAuthCallback={flow.submitOAuthCallback}
        onSaveAppCredentials={flow.saveAppCredentials}
        onCopyText={onCopyText}
        onRetry={() => flow.openFlowTarget(flow.flowTarget)}
        onBrowseAll={() => {
          setDomainFilter(null);
          flow.openFlowTarget({});
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <AddDeviceModal
      query={searchQuery}
      discovered={discovered}
      catalog={catalog}
      brandCatalog={brandCatalog}
      loading={pickerLoading}
      onQueryChange={setSearchQuery}
      onRescan={() => void loadDiscovery()}
      onSelectDiscovered={(item) =>
        flow.openFlowTarget({ flowId: item.flowId, domain: item.domain, title: item.label })
      }
      onSelectCatalog={(choice) =>
        flow.openFlowTarget({ domain: choice.domain, title: choice.title })
      }
      onSelectBrand={(brand) => {
        const drivers = brand.groupItems ?? [brand];
        if (drivers.length > 1 || brand.isCombinedHausGovee) {
          flow.openFlowTarget({ title: brand.title }, { brand });
        } else {
          flow.launchDriver(drivers[0] ?? brand);
        }
      }}
      onChooseCode={() => setViewMode('code')}
      onChooseCamera={() => setViewMode('camera')}
      onChooseBrowse={() => {
        setDomainFilter(null);
        flow.openFlowTarget({});
      }}
      onChooseApps={() => {
        onClose();
        onOpenApps();
      }}
      onClose={onClose}
    />
  );
}
