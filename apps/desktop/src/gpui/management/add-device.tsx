/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceDemoConfigFlow,
  buildDemoOnboardingState,
  buildFlowStartPayload,
  computeCommissioningHint,
  detectSetupCodeFormat,
  extractFlowErrorMessage,
  isCompletedFlowStep,
  schemaDefaultsForFlow,
  startDemoConfigFlow,
  validateFlowFormValues,
  type FlowStartTarget,
  type FlowStepRecord,
  type IntegrationCatalogChoice,
  type ManagementPort,
  type OnboardingDiscoveredFlow,
} from '@haus/core/transport';
import type { CommissioningTransaction } from '@haus/core';
import type { Snapshot } from '@haus/ha/types';
import {
  AddDeviceModal,
  CommissioningModal,
  ConfigFlowModal,
  type CommissioningStage,
} from '@haus/ui/components';
import {
  cancelLiveCommissioningSession,
  fetchLiveOnboardingState,
  flowBasePath,
  moveCommissionedDeviceRoom,
  parseFlowStep,
  readLiveCommissioningSession,
  selectLiveCommissioningCandidate,
  startLiveCommissioningSession,
  submitLiveCommissioningCredentials,
} from './add-device-live.js';
import type { GpuiRpcRequest } from './integrations.js';

export type GpuiAddDeviceRequest =
  | { readonly mode: 'picker' }
  | { readonly mode: 'code'; readonly initialCode?: string }
  | { readonly mode: 'flow'; readonly target: FlowStartTarget };

export function GpuiAddDeviceModal({
  snapshot,
  demo,
  management,
  requestRpc,
  openExternal,
  initialRequest,
  onOpenApps,
  onClose,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly openExternal?: (url: string) => Promise<void>;
  readonly initialRequest: GpuiAddDeviceRequest;
  readonly onOpenApps: () => void;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}) {
  const [viewMode, setViewMode] = useState<'picker' | 'code' | 'flow'>(initialRequest.mode);
  const [searchQuery, setSearchQuery] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);

  const demoState = useMemo(() => (demo ? buildDemoOnboardingState() : undefined), [demo]);
  const [discovered, setDiscovered] = useState<readonly OnboardingDiscoveredFlow[]>(
    () => demoState?.discovered ?? [],
  );
  const [catalog, setCatalog] = useState<readonly IntegrationCatalogChoice[]>(
    () => demoState?.catalog ?? [],
  );

  // Commissioning state
  const [rawCode, setRawCode] = useState(
    initialRequest.mode === 'code' ? (initialRequest.initialCode ?? '') : '',
  );
  const detected = useMemo(() => detectSetupCodeFormat(rawCode), [rawCode]);
  const [commStage, setCommStage] = useState<CommissioningStage>('code_entry');
  const [commTx, setCommTx] = useState<CommissioningTransaction | null>(null);
  const [commBusy, setCommBusy] = useState(false);
  const [commError, setCommError] = useState<string | null>(null);
  const [commHint, setCommHint] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [demoPaired, setDemoPaired] = useState<readonly { readonly name: string }[]>([]);
  const commSessionIdRef = useRef<string | null>(null);
  const commPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commHighestSeqRef = useRef(0);

  // ConfigFlow state
  const [flowTarget, setFlowTarget] = useState<FlowStartTarget>(() =>
    initialRequest.mode === 'flow' ? initialRequest.target : {},
  );
  const [flowStep, setFlowStep] = useState<FlowStepRecord | null>(() =>
    demo && initialRequest.mode === 'flow' && initialRequest.target.domain
      ? startDemoConfigFlow(initialRequest.target.domain, initialRequest.target.title)
      : null,
  );
  const [flowValues, setFlowValues] = useState<Record<string, unknown>>(() =>
    flowStep?.data_schema ? schemaDefaultsForFlow(flowStep.data_schema) : {},
  );
  const [flowFieldErrors, setFlowFieldErrors] = useState<Record<string, string>>({});
  const [flowPickerQuery, setFlowPickerQuery] = useState('');
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowError, setFlowError] = useState('');
  const ownsFlowRef = useRef(false);
  const flowPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowTargetRef = useRef<FlowStartTarget>(flowTarget);
  flowTargetRef.current = flowTarget;
  const flowStepRef = useRef<FlowStepRecord | null>(flowStep);
  flowStepRef.current = flowStep;

  const stopPolling = useCallback(() => {
    if (commPollRef.current) clearTimeout(commPollRef.current);
    if (flowPollRef.current) clearTimeout(flowPollRef.current);
    commPollRef.current = null;
    flowPollRef.current = null;
  }, []);

  const loadDiscovery = useCallback(async () => {
    if (demo) {
      const next = buildDemoOnboardingState();
      setDiscovered(next.discovered);
      setCatalog(next.catalog);
      return;
    }
    setPickerLoading(true);
    try {
      const loaded = await fetchLiveOnboardingState({ management, requestRpc });
      setDiscovered(loaded.discovered);
      setCatalog(loaded.catalog);
    } finally {
      setPickerLoading(false);
    }
  }, [demo, management, requestRpc]);

  useEffect(() => {
    void loadDiscovery();
    return () => {
      stopPolling();
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
        void management.management({ method: 'DELETE', path: `${base}/${activeFlow.flow_id}` }).catch(() => {});
      }
      if (!demo && management && commSessionIdRef.current) {
        void cancelLiveCommissioningSession(management, commSessionIdRef.current);
      }
    };
  }, [demo, loadDiscovery, management, stopPolling]);

  const applyTransaction = useCallback(
    (tx: CommissioningTransaction) => {
      setCommTx(tx);
      if (Array.isArray(tx.events) && tx.events.length > 0) {
        commHighestSeqRef.current = Math.max(commHighestSeqRef.current, ...tx.events.map((e) => e.seq));
      }
      if (tx.state === 'DONE') {
        setCommStage('complete');
        stopPolling();
        onSaved?.();
      } else if (tx.state === 'FAILED') {
        setCommStage('error');
        setCommError(tx.error ?? 'Commissioning failed.');
        setCommHint(computeCommissioningHint(tx.error));
        stopPolling();
      } else if (tx.state === 'CANCELLED') {
        setCommStage('code_entry');
        stopPolling();
      } else if (tx.state === 'SELECT_CANDIDATE' && tx.candidates?.length && !tx.selectedCandidate) {
        setCommStage('candidate_selection');
      } else if (tx.state === 'OBTAIN_NETWORK_CREDENTIALS') {
        setCommStage('credentials');
      } else {
        setCommStage('pairing');
      }
    },
    [onSaved, stopPolling],
  );

  const pollCommissioning = useCallback(
    async (sessionId: string) => {
      if (commSessionIdRef.current !== sessionId || !management) return;
      try {
        const tx = await readLiveCommissioningSession(management, sessionId, commHighestSeqRef.current);
        if (commSessionIdRef.current !== sessionId) return;
        applyTransaction(tx);
        if (tx.state !== 'DONE' && tx.state !== 'FAILED' && tx.state !== 'CANCELLED') {
          commPollRef.current = setTimeout(() => void pollCommissioning(sessionId), 750);
        }
      } catch {
        if (commSessionIdRef.current === sessionId) {
          commPollRef.current = setTimeout(() => void pollCommissioning(sessionId), 1500);
        }
      }
    },
    [applyTransaction, management],
  );

  const handleStartCommissioning = async () => {
    if (!detected.valid) {
      setCommError(detected.error ?? detected.description);
      setCommHint(detected.honestLimitation ?? null);
      setCommStage('error');
      return;
    }
    if (demo) {
      if (detected.protocol === 'matter' || detected.protocol === 'improv' || detected.protocol === 'vendor') {
        setCommStage('credentials');
      } else {
        setDemoPaired([{ name: `${detected.label} Accessory` }]);
        setCommStage('complete');
      }
      return;
    }
    if (!management) {
      setCommError('Connect your Haus Hub to commission devices.');
      setCommStage('error');
      return;
    }
    setCommBusy(true);
    setCommError(null);
    setCommHint(null);
    commHighestSeqRef.current = 0;
    try {
      const tx = await startLiveCommissioningSession(management, rawCode.trim(), detected.protocol);
      commSessionIdRef.current = tx.commissioningId;
      applyTransaction(tx);
      void pollCommissioning(tx.commissioningId);
    } catch (err: unknown) {
      const msg = extractFlowErrorMessage(err);
      setCommError(msg);
      setCommHint(computeCommissioningHint(msg));
      setCommStage('error');
    } finally {
      setCommBusy(false);
    }
  };

  const acceptFlowStep = useCallback(
    (next: FlowStepRecord) => {
      setFlowStep(next);
      setFlowFieldErrors({});
      setFlowValues(schemaDefaultsForFlow(next.data_schema ?? []));
      if (isCompletedFlowStep(next)) onSaved?.();
      if ((next.type === 'progress' || next.type === 'external') && !demo && management) {
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
    (target: FlowStartTarget) => {
      setFlowTarget(target);
      setFlowError('');
      setViewMode('flow');
      if (demo) {
        if (target.domain) {
          ownsFlowRef.current = true;
          acceptFlowStep(startDemoConfigFlow(target.domain, target.title));
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
    [acceptFlowStep, demo, management],
  );

  useEffect(() => {
    if (!demo && initialRequest.mode === 'flow') openFlowTarget(initialRequest.target);
  }, [demo, initialRequest, openFlowTarget]);

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
      .management({ method: 'POST', path: `${flowBasePath(flowTarget)}/${flowStep.flow_id}`, data: payload })
      .then((res) => acceptFlowStep(parseFlowStep(res)))
      .catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)))
      .finally(() => setFlowBusy(false));
  };

  if (viewMode === 'code') {
    return (
      <CommissioningModal
        stage={commStage}
        rawCode={rawCode}
        detected={detected}
        demo={demo}
        busy={commBusy}
        candidates={(commTx?.candidates ?? []).map((c) => ({
          identifier: c.identifier,
          name: c.name ?? c.identifier,
          protocol: c.protocol,
          transport: c.transport,
          address: c.address,
          rssi: c.rssi,
        }))}
        events={commTx?.events ?? []}
        pairedDevices={
          demo
            ? demoPaired
            : (commTx?.pairedDevices ?? []).map((d) => ({ id: d.id, name: d.name }))
        }
        requiresThread={detected.protocol === 'matter'}
        rooms={snapshot.areas.map((a) => ({ id: a.area_id, name: a.name }))}
        selectedRoomId={selectedRoomId}
        errorMessage={commError}
        actionableHint={commHint}
        onCodeChange={(code) => {
          setRawCode(code);
          setCommError(null);
          setCommHint(null);
        }}
        onStart={() => void handleStartCommissioning()}
        onSelectCandidate={(candidateId) => {
          const sid = commSessionIdRef.current;
          if (!sid || !management) return;
          setCommBusy(true);
          void selectLiveCommissioningCandidate(management, sid, candidateId)
            .then(applyTransaction)
            .catch((err: unknown) => setCommError(extractFlowErrorMessage(err)))
            .finally(() => setCommBusy(false));
        }}
        onSubmitCredentials={(input) => {
          if (demo) {
            setDemoPaired([{ name: `${detected.label} (${input.ssid})` }]);
            setCommStage('complete');
            return;
          }
          const sid = commSessionIdRef.current;
          if (!sid || !management) return;
          setCommBusy(true);
          void submitLiveCommissioningCredentials(management, sid, input)
            .then(applyTransaction)
            .catch((err: unknown) => setCommError(extractFlowErrorMessage(err)))
            .finally(() => setCommBusy(false));
        }}
        onSelectRoom={setSelectedRoomId}
        onFinish={() => {
          const firstId = commTx?.pairedDevices?.[0]?.id;
          if (!demo && management && selectedRoomId && firstId) {
            setCommBusy(true);
            void moveCommissionedDeviceRoom(management, firstId, selectedRoomId).finally(() => {
              setCommBusy(false);
              onSaved?.();
              onClose();
            });
            return;
          }
          onClose();
        }}
        onRetry={() => {
          stopPolling();
          commSessionIdRef.current = null;
          setCommError(null);
          setCommHint(null);
          setCommStage('code_entry');
        }}
        onCancel={onClose}
      />
    );
  }

  if (viewMode === 'flow') {
    return (
      <ConfigFlowModal
        title={flowTarget.title ?? 'Set up integration'}
        step={flowStep}
        catalog={catalog}
        pickerQuery={flowPickerQuery}
        values={flowValues}
        fieldErrors={flowFieldErrors}
        busy={flowBusy}
        error={flowError || undefined}
        onPickerQueryChange={setFlowPickerQuery}
        onStartDomain={(c) => openFlowTarget({ ...flowTarget, domain: c.domain, title: c.title })}
        onChangeValues={setFlowValues}
        onSubmitForm={() => {
          const errs = validateFlowFormValues(flowStep?.data_schema ?? [], flowValues);
          if (Object.keys(errs).length > 0) {
            setFlowFieldErrors(errs);
            return;
          }
          submitFlow(flowValues);
        }}
        onSelectMenu={(optionKey) => submitFlow({ next_step_id: optionKey })}
        onOpenExternalUrl={(url) => {
          if (url && openExternal) {
            void openExternal(url).catch((err: unknown) => setFlowError(extractFlowErrorMessage(err)));
          }
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
      loading={pickerLoading}
      onQueryChange={setSearchQuery}
      onRescan={() => void loadDiscovery()}
      onSelectDiscovered={(item) =>
        openFlowTarget({ flowId: item.flowId, domain: item.domain, title: item.label })
      }
      onSelectCatalog={(choice) => openFlowTarget({ domain: choice.domain, title: choice.title })}
      onChooseCode={() => setViewMode('code')}
      onChooseBrowse={() => openFlowTarget({})}
      onChooseApps={() => {
        onClose();
        onOpenApps();
      }}
      onClose={onClose}
    />
  );
}
