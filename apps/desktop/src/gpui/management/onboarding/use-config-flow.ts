/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceDemoConfigFlow,
  buildFlowStartPayload,
  extractFlowErrorMessage,
  isCompletedFlowStep,
  schemaDefaultsForFlow,
  startDemoConfigFlow,
  validateFlowFormValues,
  type BrandCatalogItem,
  type FlowStartTarget,
  type FlowStepRecord,
  type ManagementPort,
  type ParsedOAuthCallbackInput,
} from '@haus/core/transport';
import type { EcosystemPluginInstallInfo } from '@haus/ui/components';
import {
  fetchLiveStepTranslations,
  flowBasePath,
  installLiveCatalogPlugin,
  loadLiveCatalogPluginDetail,
  parseFlowStep,
  saveLiveApplicationCredentials,
  submitLiveOAuthCallback,
} from '../add-device-live.js';
import type { GpuiRpcRequest } from '../integrations.js';
import { assessLiveFlowStep, pluginInfoFromDriver } from './camera-helper.js';

export function useGpuiConfigFlow({
  initialTarget,
  autoStartLive,
  demo,
  isHubSession,
  management,
  requestRpc,
  onEnterFlowView,
  onSaved,
}: {
  readonly initialTarget?: FlowStartTarget;
  readonly autoStartLive: boolean;
  readonly demo?: boolean;
  readonly isHubSession: boolean;
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly onEnterFlowView: () => void;
  readonly onSaved?: () => void;
}) {
  const [flowTarget, setFlowTarget] = useState<FlowStartTarget>(() => initialTarget ?? {});
  const [flowStep, setFlowStep] = useState<FlowStepRecord | null>(() => {
    if (!demo || !initialTarget) return null;
    const d = initialTarget.repair?.domain ?? initialTarget.domain;
    return d ? startDemoConfigFlow(d, initialTarget.title, initialTarget) : null;
  });
  const [stepTranslations, setStepTranslations] = useState<Readonly<Record<string, string>>>({});
  const [flowValues, setFlowValues] = useState<Record<string, unknown>>(() =>
    flowStep?.data_schema ? schemaDefaultsForFlow(flowStep.data_schema) : {},
  );
  const [flowFieldErrors, setFlowFieldErrors] = useState<Record<string, string>>({});
  const [flowPickerQuery, setFlowPickerQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<BrandCatalogItem | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<EcosystemPluginInstallInfo | null>(null);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginInstalled, setPluginInstalled] = useState(false);
  const [pluginStage, setPluginStage] = useState<string | undefined>(undefined);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowError, setFlowError] = useState('');

  const ownsFlowRef = useRef(false);
  const flowPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowTargetRef = useRef<FlowStartTarget>(flowTarget);
  flowTargetRef.current = flowTarget;
  const flowStepRef = useRef<FlowStepRecord | null>(flowStep);
  flowStepRef.current = flowStep;

  useEffect(
    () => () => {
      if (flowPollRef.current) clearTimeout(flowPollRef.current);
      const activeFlow = flowStepRef.current;
      if (
        !demo &&
        management &&
        activeFlow &&
        ownsFlowRef.current &&
        activeFlow.type !== 'create_entry' &&
        activeFlow.type !== 'abort'
      ) {
        const base = flowBasePath(flowTargetRef.current);
        void management
          .management({ method: 'DELETE', path: `${base}/${activeFlow.flow_id}` })
          .catch(() => {});
      }
    },
    [demo, management],
  );

  const activeStepDomain =
    flowStep?.handler ?? flowTarget.repair?.domain ?? flowTarget.domain ?? '';
  const activeTranslationDomain = flowStep?.translation_domain;
  const activeSupportedBy = flowStep?.supported_by;
  const activeCategory: 'issues' | 'options' | 'config' = flowTarget.repair
    ? 'issues'
    : flowTarget.kind === 'options'
      ? 'options'
      : 'config';

  useEffect(() => {
    if (demo || !requestRpc || !activeStepDomain) return;
    let active = true;
    const domains = [activeStepDomain, activeTranslationDomain, activeSupportedBy].filter(
      (d): d is string => Boolean(d),
    );
    void fetchLiveStepTranslations(requestRpc, domains, activeCategory).then((tr) => {
      if (active) setStepTranslations((prev) => ({ ...prev, ...tr }));
    });
    return () => {
      active = false;
    };
  }, [
    activeCategory,
    activeStepDomain,
    activeSupportedBy,
    activeTranslationDomain,
    demo,
    requestRpc,
  ]);

  const acceptFlowStep = useCallback(
    (next: FlowStepRecord) => {
      setFlowStep(next);
      setFlowFieldErrors({});
      setFlowValues(schemaDefaultsForFlow(next.data_schema ?? []));
      if (isCompletedFlowStep(next)) onSaved?.();
      if (
        ['progress', 'progress_done', 'external', 'external_done'].includes(next.type) &&
        !demo &&
        management
      ) {
        const base = flowBasePath(flowTargetRef.current);
        flowPollRef.current = setTimeout(() => {
          void management
            .management({ method: 'GET', path: `${base}/${next.flow_id}` })
            .then((res) => acceptFlowStep(parseFlowStep(res)))
            .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)));
        }, 1200);
      }
    },
    [demo, management, onSaved],
  );

  const openFlowTarget = useCallback(
    (target: FlowStartTarget, options?: { readonly brand?: BrandCatalogItem | null }) => {
      setFlowTarget(target);
      setFlowError('');
      setSelectedPlugin(null);
      setPluginInstalled(false);
      setPluginStage(undefined);
      setSelectedBrand(options?.brand ?? null);
      onEnterFlowView();
      if (demo) {
        const domain = target.repair?.domain ?? target.domain;
        if (domain) {
          ownsFlowRef.current = true;
          acceptFlowStep(startDemoConfigFlow(domain, target.title, target));
        } else {
          setFlowStep(null);
        }
        return;
      }
      if (!management) {
        setFlowError('Connect your Haus Hub to configure integrations.');
        return;
      }
      if (!target.flowId && !target.domain && !target.entryId && !target.repair) {
        setFlowStep(null);
        return;
      }
      setFlowBusy(true);
      const base = flowBasePath(target);
      const req = target.flowId
        ? management.management({ method: 'GET', path: `${base}/${target.flowId}` })
        : management.management({
            method: 'POST',
            path: base,
            data: buildFlowStartPayload(target, target.repair?.domain ?? target.domain ?? ''),
          });
      void req
        .then((res) => {
          ownsFlowRef.current = !target.flowId;
          acceptFlowStep(parseFlowStep(res));
        })
        .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)))
        .finally(() => setFlowBusy(false));
    },
    [acceptFlowStep, demo, management, onEnterFlowView],
  );

  useEffect(() => {
    if (!demo && autoStartLive && initialTarget) openFlowTarget(initialTarget);
  }, [autoStartLive, demo, initialTarget, openFlowTarget]);

  const submitFlow = (payload: Record<string, unknown>) => {
    if (!flowStep) return;
    if (demo) {
      acceptFlowStep(advanceDemoConfigFlow(flowStep, payload));
      return;
    }
    if (!management) return;
    setFlowBusy(true);
    setFlowError('');
    void management
      .management({
        method: 'POST',
        path: `${flowBasePath(flowTarget)}/${flowStep.flow_id}`,
        data: payload,
      })
      .then((res) => acceptFlowStep(parseFlowStep(res)))
      .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)))
      .finally(() => setFlowBusy(false));
  };

  const launchDriver = (driver: BrandCatalogItem) => {
    const pluginInfo = pluginInfoFromDriver(driver);
    if (pluginInfo) {
      setSelectedPlugin(pluginInfo);
      setPluginInstalled(Boolean(driver.installed));
      setPluginStage(undefined);
      setFlowError('');
      onEnterFlowView();
      if (!demo && management) {
        setPluginLoading(true);
        void loadLiveCatalogPluginDetail(management, pluginInfo)
          .then((enriched) => setSelectedPlugin(enriched))
          .catch(() => {})
          .finally(() => setPluginLoading(false));
      }
      return;
    }
    openFlowTarget({ ...flowTarget, domain: driver.domain ?? driver.id, title: driver.title });
  };

  const installPlugin = () => {
    if (!selectedPlugin) return;
    if (demo) {
      setFlowBusy(true);
      setPluginStage('pulling');
      setTimeout(() => {
        setPluginStage('complete');
        setPluginInstalled(true);
        setFlowBusy(false);
        onSaved?.();
      }, 300);
      return;
    }
    setFlowBusy(true);
    setFlowError('');
    void installLiveCatalogPlugin({
      management,
      requestRpc,
      plugin: selectedPlugin,
      onStage: setPluginStage,
    })
      .then(() => {
        setPluginInstalled(true);
        onSaved?.();
      })
      .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)))
      .finally(() => setFlowBusy(false));
  };

  const unsupported = useMemo(
    () => assessLiveFlowStep(flowStep, isHubSession, Boolean(demo)),
    [demo, flowStep, isHubSession],
  );

  return {
    flowTarget,
    flowStep,
    stepTranslations,
    flowValues,
    flowFieldErrors,
    flowPickerQuery,
    selectedBrand,
    selectedPlugin,
    pluginLoading,
    pluginInstalled,
    pluginStage,
    flowBusy,
    flowError,
    unsupported,
    setFlowTarget,
    setFlowValues,
    setFlowPickerQuery,
    setSelectedBrand,
    setFlowError,
    openFlowTarget,
    acceptFlowStep,
    markOwnedFlow: () => {
      ownsFlowRef.current = true;
    },
    launchDriver,
    installPlugin,
    clearPlugin: () => {
      setSelectedPlugin(null);
      setPluginInstalled(false);
      setPluginStage(undefined);
      setFlowError('');
    },
    submitForm: () => {
      const errs = validateFlowFormValues(flowStep?.data_schema ?? [], flowValues);
      if (Object.keys(errs).length > 0) {
        setFlowFieldErrors(errs);
        return;
      }
      submitFlow(flowValues);
    },
    selectMenu: (optionKey: string) => submitFlow({ next_step_id: optionKey }),
    submitOAuthCallback:
      management && flowStep
        ? (parsed: ParsedOAuthCallbackInput) => {
            setFlowBusy(true);
            setFlowError('');
            void submitLiveOAuthCallback(management, flowStep.flow_id, parsed)
              .then((next) => acceptFlowStep(next))
              .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)))
              .finally(() => setFlowBusy(false));
          }
        : undefined,
    saveAppCredentials:
      management && activeStepDomain
        ? (clientId: string, clientSecret: string) => {
            setFlowBusy(true);
            setFlowError('');
            void saveLiveApplicationCredentials(
              management,
              activeStepDomain,
              clientId,
              clientSecret,
            )
              .then(() => openFlowTarget({ ...flowTarget, domain: activeStepDomain }))
              .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)))
              .finally(() => setFlowBusy(false));
          }
        : undefined,
  };
}
