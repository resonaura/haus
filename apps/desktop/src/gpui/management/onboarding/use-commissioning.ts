/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeCommissioningHint,
  detectSetupCodeFormat,
  extractFlowErrorMessage,
  type ManagementPort,
} from '@haus/core/transport';
import type { CommissioningTransaction } from '@haus/core';
import type { CommissioningModalProps, CommissioningStage } from '@haus/ui/components';
import {
  cancelLiveCommissioningSession,
  moveCommissionedDeviceRoom,
  readLiveCommissioningSession,
  selectLiveCommissioningCandidate,
  startLiveCommissioningSession,
  submitLiveCommissioningCredentials,
} from '../add-device-live.js';

export function useGpuiCommissioning({
  initialCode = '',
  demo,
  management,
  rooms,
  onSaved,
  onClose,
}: {
  readonly initialCode?: string;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly onSaved?: () => void;
  readonly onClose: () => void;
}): CommissioningModalProps {
  const [rawCode, setRawCode] = useState(initialCode);
  const detected = useMemo(() => detectSetupCodeFormat(rawCode), [rawCode]);
  const [stage, setStage] = useState<CommissioningStage>('code_entry');
  const [tx, setTx] = useState<CommissioningTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionableHint, setActionableHint] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [demoPaired, setDemoPaired] = useState<readonly { readonly name: string }[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highestSeqRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopPolling();
      if (!demo && management && sessionIdRef.current) {
        void cancelLiveCommissioningSession(management, sessionIdRef.current);
      }
    },
    [demo, management, stopPolling],
  );

  const applyTransaction = useCallback(
    (next: CommissioningTransaction) => {
      setTx(next);
      if (Array.isArray(next.events) && next.events.length > 0) {
        highestSeqRef.current = Math.max(highestSeqRef.current, ...next.events.map((e) => e.seq));
      }
      if (next.state === 'DONE') {
        setStage('complete');
        stopPolling();
        onSaved?.();
      } else if (next.state === 'FAILED') {
        setStage('error');
        setErrorMessage(next.error ?? 'Commissioning failed.');
        setActionableHint(computeCommissioningHint(next.error));
        stopPolling();
      } else if (next.state === 'CANCELLED') {
        setStage('code_entry');
        stopPolling();
      } else if (
        next.state === 'SELECT_CANDIDATE' &&
        next.candidates?.length &&
        !next.selectedCandidate
      ) {
        setStage('candidate_selection');
      } else if (next.state === 'OBTAIN_NETWORK_CREDENTIALS') {
        setStage('credentials');
      } else {
        setStage('pairing');
      }
    },
    [onSaved, stopPolling],
  );

  const poll = useCallback(
    async (sessionId: string) => {
      if (sessionIdRef.current !== sessionId || !management) return;
      try {
        const next = await readLiveCommissioningSession(
          management,
          sessionId,
          highestSeqRef.current,
        );
        if (sessionIdRef.current !== sessionId) return;
        applyTransaction(next);
        if (next.state !== 'DONE' && next.state !== 'FAILED' && next.state !== 'CANCELLED') {
          pollRef.current = setTimeout(() => void poll(sessionId), 750);
        }
      } catch {
        if (sessionIdRef.current === sessionId) {
          pollRef.current = setTimeout(() => void poll(sessionId), 1500);
        }
      }
    },
    [applyTransaction, management],
  );

  const onStart = () => {
    if (!detected.valid) {
      setErrorMessage(detected.error ?? detected.description);
      setActionableHint(detected.honestLimitation ?? null);
      setStage('error');
      return;
    }
    if (demo) {
      if (
        detected.protocol === 'matter' ||
        detected.protocol === 'improv' ||
        detected.protocol === 'vendor'
      ) {
        setStage('credentials');
      } else {
        setDemoPaired([{ name: `${detected.label} Accessory` }]);
        setStage('complete');
      }
      return;
    }
    if (!management) {
      setErrorMessage('Connect your Haus Hub to commission devices.');
      setStage('error');
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    setActionableHint(null);
    highestSeqRef.current = 0;
    void startLiveCommissioningSession(management, rawCode.trim(), detected.protocol)
      .then((started) => {
        sessionIdRef.current = started.commissioningId;
        applyTransaction(started);
        void poll(started.commissioningId);
      })
      .catch((err: unknown) => {
        const msg = extractFlowErrorMessage(err);
        setErrorMessage(msg);
        setActionableHint(computeCommissioningHint(msg));
        setStage('error');
      })
      .finally(() => setBusy(false));
  };

  return {
    stage,
    rawCode,
    detected,
    demo,
    busy,
    candidates: (tx?.candidates ?? []).map((c) => ({
      identifier: c.identifier,
      name: c.name ?? c.identifier,
      protocol: c.protocol,
      transport: c.transport,
      address: c.address,
      rssi: c.rssi,
    })),
    events: tx?.events ?? [],
    pairedDevices: demo
      ? demoPaired
      : (tx?.pairedDevices ?? []).map((d) => ({ id: d.id, name: d.name })),
    requiresThread: detected.protocol === 'matter',
    rooms,
    selectedRoomId,
    errorMessage,
    actionableHint,
    onCodeChange: (code) => {
      setRawCode(code);
      setErrorMessage(null);
      setActionableHint(null);
    },
    onStart,
    onSelectCandidate: (candidateId) => {
      const sid = sessionIdRef.current;
      if (!sid || !management) return;
      setBusy(true);
      void selectLiveCommissioningCandidate(management, sid, candidateId)
        .then(applyTransaction)
        .catch((err: unknown) => setErrorMessage(extractFlowErrorMessage(err)))
        .finally(() => setBusy(false));
    },
    onSubmitCredentials: (input) => {
      if (demo) {
        setDemoPaired([{ name: `${detected.label} (${input.ssid})` }]);
        setStage('complete');
        return;
      }
      const sid = sessionIdRef.current;
      if (!sid || !management) return;
      setBusy(true);
      void submitLiveCommissioningCredentials(management, sid, input)
        .then(applyTransaction)
        .catch((err: unknown) => setErrorMessage(extractFlowErrorMessage(err)))
        .finally(() => setBusy(false));
    },
    onSelectRoom: setSelectedRoomId,
    onFinish: () => {
      const firstId = tx?.pairedDevices?.[0]?.id;
      if (!demo && management && selectedRoomId && firstId) {
        setBusy(true);
        void moveCommissionedDeviceRoom(management, firstId, selectedRoomId).finally(() => {
          setBusy(false);
          onSaved?.();
          onClose();
        });
        return;
      }
      onClose();
    },
    onRetry: () => {
      stopPolling();
      sessionIdRef.current = null;
      setErrorMessage(null);
      setActionableHint(null);
      setStage('code_entry');
    },
    onCancel: onClose,
  };
}
