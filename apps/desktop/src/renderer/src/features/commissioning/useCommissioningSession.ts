/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Advertisement,
  CommissioningEvent,
  CommissioningTransaction,
  RequiredCredentialsPrompt,
} from '@haus/core';
import { rest } from '../../ha/management.js';
import { detectSetupCode } from './protocol-detect.js';
import type { CommissioningSessionHook, CommissioningUiStage, DetectedProtocol } from './types.js';

function computeActionableHint(error?: string): string | null {
  if (!error) return null;
  const lower = error.toLowerCase();
  if (lower.includes('deadline') || lower.includes('timeout')) {
    return 'The device pairing window closed. Power cycle the device or press its setup button to re-enter pairing mode, then retry.';
  }
  if (lower.includes('pin') || lower.includes('code') || lower.includes('auth')) {
    return 'The device rejected the setup passcode. Verify the digits printed on the device label and try again.';
  }
  if (lower.includes('weak') || lower.includes('banned')) {
    return 'This setup PIN pattern is disallowed by the security specification. Use the device’s unique factory PIN.';
  }
  if (lower.includes('network') || lower.includes('wifi') || lower.includes('ssid')) {
    return 'The device could not connect to the Wi-Fi network. Check the password and ensure the network is 2.4 GHz compatible.';
  }
  if (lower.includes('ble') || lower.includes('bluetooth') || lower.includes('radio')) {
    return 'Bluetooth communication was interrupted. Move the device closer to your computer or Hub and try again.';
  }
  if (lower.includes('candidate_not_found')) {
    return 'The selected device is no longer visible on the network. Check its power and retry discovery.';
  }
  return 'Review the error details and try pairing again.';
}

export function useCommissioningSession(initialCode = ''): CommissioningSessionHook {
  const [rawCode, setRawCode] = useState(initialCode);
  const [detected, setDetected] = useState<DetectedProtocol>(() => detectSetupCode(initialCode));
  const [transaction, setTransaction] = useState<CommissioningTransaction | null>(null);
  const [stage, setStage] = useState<CommissioningUiStage>('code_entry');
  const [events, setEvents] = useState<CommissioningEvent[]>([]);
  const [candidates, setCandidates] = useState<Advertisement[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Advertisement | null>(null);
  const [promptCredentials, setPromptCredentials] =
    useState<RequiredCredentialsPrompt | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionableHint, setActionableHint] = useState<string | null>(null);

  const activeIdRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highestSeqRef = useRef<number>(0);

  const setCode = useCallback((code: string) => {
    setRawCode(code);
    setDetected(detectSetupCode(code));
    setErrorMessage(null);
    setActionableHint(null);
  }, []);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const updateFromTransaction = useCallback((tx: CommissioningTransaction) => {
    setTransaction(tx);
    if (Array.isArray(tx.candidates)) {
      setCandidates([...tx.candidates]);
    }
    if (tx.selectedCandidate) {
      setSelectedCandidate(tx.selectedCandidate);
    }
    if (tx.requiresCredentials) {
      setPromptCredentials(tx.requiresCredentials);
    }
    if (Array.isArray(tx.events) && tx.events.length > 0) {
      setEvents((prev) => {
        const existingSeqs = new Set(prev.map((e) => e.seq));
        const newEvents = tx.events.filter((e) => !existingSeqs.has(e.seq));
        const combined = [...prev, ...newEvents].sort((a, b) => a.seq - b.seq);
        highestSeqRef.current = combined.length > 0 ? combined[combined.length - 1]!.seq : 0;
        return combined;
      });
    }

    // Determine current UI stage based on state
    switch (tx.state) {
      case 'DONE':
        setStage('complete');
        clearPolling();
        break;
      case 'FAILED':
        setStage('error');
        setErrorMessage(tx.error ?? 'Commissioning failed');
        setActionableHint(computeActionableHint(tx.error));
        clearPolling();
        break;
      case 'CANCELLED':
        setStage('code_entry');
        clearPolling();
        break;
      case 'SELECT_CANDIDATE':
        if (tx.candidates && tx.candidates.length > 0 && !tx.selectedCandidate) {
          setStage('candidate_selection');
        } else {
          setStage('pairing');
        }
        break;
      case 'OBTAIN_NETWORK_CREDENTIALS':
        setStage('credentials');
        break;
      default:
        setStage('pairing');
        break;
    }
  }, [clearPolling]);

  // Polling loop
  const pollSession = useCallback(
    async (sessionId: string) => {
      if (activeIdRef.current !== sessionId) return;
      try {
        const tx = await rest<CommissioningTransaction>(
          'GET',
          `commissioning/sessions/${encodeURIComponent(sessionId)}`,
          { sinceSeq: highestSeqRef.current },
        );
        if (activeIdRef.current === sessionId && tx) {
          updateFromTransaction(tx);
          if (tx.state !== 'DONE' && tx.state !== 'FAILED' && tx.state !== 'CANCELLED') {
            pollingRef.current = setTimeout(() => void pollSession(sessionId), 750);
          }
        }
      } catch {
        if (activeIdRef.current === sessionId) {
          pollingRef.current = setTimeout(() => void pollSession(sessionId), 1500);
        }
      }
    },
    [updateFromTransaction],
  );

  const startCommissioning = useCallback(async () => {
    const currentDetected = detectSetupCode(rawCode);
    if (!currentDetected.valid) {
      setErrorMessage(currentDetected.error ?? currentDetected.description);
      setActionableHint(currentDetected.honestLimitation ?? null);
      setStage('error');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setActionableHint(null);
    setEvents([]);
    setCandidates([]);
    setSelectedCandidate(null);
    setPromptCredentials(null);
    highestSeqRef.current = 0;

    try {
      const tx = await rest<CommissioningTransaction>('POST', 'commissioning/sessions', {
        code: rawCode.trim(),
        contextProtocol: currentDetected.protocol,
      });
      activeIdRef.current = tx.commissioningId;
      updateFromTransaction(tx);
      void pollSession(tx.commissioningId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setActionableHint(computeActionableHint(msg));
      setStage('error');
    } finally {
      setIsSubmitting(false);
    }
  }, [rawCode, updateFromTransaction, pollSession]);

  const selectCandidate = useCallback(
    async (candidateId: string) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      setIsSubmitting(true);
      try {
        const tx = await rest<CommissioningTransaction>(
          'POST',
          `commissioning/sessions/${encodeURIComponent(sessionId)}/select`,
          { candidateId },
        );
        updateFromTransaction(tx);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Candidate selection failed');
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateFromTransaction],
  );

  const submitCredentials = useCallback(
    async (ssid: string, password: string, threadDataset?: string, saveForReuse?: boolean) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      setIsSubmitting(true);
      try {
        const tx = await rest<CommissioningTransaction>(
          'POST',
          `commissioning/sessions/${encodeURIComponent(sessionId)}/credentials`,
          {
            ssid,
            password,
            ...(threadDataset ? { threadDataset } : {}),
            ...(saveForReuse !== undefined ? { saveForReuse } : {}),
          },
        );
        updateFromTransaction(tx);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Credential submission failed');
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateFromTransaction],
  );

  const submitManualAddress = useCallback(
    async (address: string, port?: number) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      setIsSubmitting(true);
      try {
        const tx = await rest<CommissioningTransaction>(
          'POST',
          `commissioning/sessions/${encodeURIComponent(sessionId)}/manual-address`,
          { address, port },
        );
        updateFromTransaction(tx);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Manual address failed');
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateFromTransaction],
  );

  const cancelCommissioning = useCallback(async () => {
    const sessionId = activeIdRef.current;
    clearPolling();
    activeIdRef.current = null;
    if (sessionId) {
      try {
        await rest('POST', `commissioning/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
      } catch {
        // Ignored on teardown
      }
    }
    setStage('code_entry');
    setTransaction(null);
  }, [clearPolling]);

  const retry = useCallback(() => {
    clearPolling();
    activeIdRef.current = null;
    setTransaction(null);
    setErrorMessage(null);
    setActionableHint(null);
    setStage('code_entry');
  }, [clearPolling]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      clearPolling();
      activeIdRef.current = null;
    };
  }, [clearPolling]);

  return {
    stage,
    transaction,
    detected,
    events,
    candidates,
    selectedCandidate,
    promptCredentials,
    isSubmitting,
    errorMessage,
    actionableHint,
    setCode,
    rawCode,
    startCommissioning,
    selectCandidate,
    submitCredentials,
    submitManualAddress,
    cancelCommissioning,
    retry,
  };
}
