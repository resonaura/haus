/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useEffectEvent, useState } from 'react';
import { Box, HausButton, SelectInput, Text } from '@haus/ui';
import { AlertTriangle, Check, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { QrCodeField } from '../../../components/forms/QrCodeField';
import { nativeApi } from '../../../ha/management';
import { TUYA_REGION_OPTIONS, type TuyaAddonCandidate } from './tuya-cameras';
import {
  pollTuyaQr,
  readTuyaLoginState,
  startTuyaQr,
  tuyaQrFailure,
  type TuyaQrChallenge,
} from './tuya-qr';

const QR_POLL_INTERVAL_MS = 2_000;
const MAX_TRANSIENT_POLL_FAILURES = 3;

export function TuyaBridgeQrStep({
  isHub,
  bridgeId,
  addon,
  busy,
  onCamerasReady,
  onError,
  onCancel,
}: {
  isHub: boolean;
  bridgeId: string;
  addon?: TuyaAddonCandidate;
  busy: boolean;
  onCamerasReady: (signedIn: boolean) => Promise<void>;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const [region, setRegion] = useState('us');
  const [regions, setRegions] =
    useState<ReadonlyArray<{ id: string; label: string }>>(TUYA_REGION_OPTIONS);
  const [challenge, setChallenge] = useState<(TuyaQrChallenge & { bridgeId: string }) | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [waitingConfirm, setWaitingConfirm] = useState(false);
  const [retryingPoll, setRetryingPoll] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [request, setRequest] = useState<{ region?: string }>({});
  const reportError = useEffectEvent(onError);
  const loginConfirmed = useEffectEvent(async () => {
    setSignedIn(true);
    setChallenge(null);
    setWaitingConfirm(false);
    setRetryingPoll(false);
    await onCamerasReady(true);
  });

  useEffect(() => {
    if (!isHub || !bridgeId) return;
    let cancelled = false;
    setLoadingQr(true);
    setWaitingConfirm(false);
    setRetryingPoll(false);
    setSignedIn(false);
    setChallenge(null);
    reportError('');
    void (async () => {
      let operation: 'check' | 'start' = 'check';
      try {
        let targetRegion = request.region;
        if (!targetRegion) {
          const state = await readTuyaLoginState(bridgeId).catch((error: unknown) => {
            if (cancelled || !tuyaQrFailure(error, 'check').retryable) throw error;
            return readTuyaLoginState(bridgeId);
          });
          if (cancelled) return;
          if (state.regions?.length) {
            setRegions(
              state.regions.map((item) => ({ id: item.id, label: `${item.name} (${item.id})` })),
            );
          }
          if (state.loggedIn) {
            await loginConfirmed();
            return;
          }
          targetRegion = state.region || 'us';
          setRegion(targetRegion);
        }
        operation = 'start';
        const started = await startTuyaQr(bridgeId, targetRegion);
        if (cancelled) return;
        setChallenge({ ...started, bridgeId });
        setWaitingConfirm(true);
      } catch (error) {
        if (!cancelled) reportError(tuyaQrFailure(error, operation).message);
      } finally {
        if (!cancelled) setLoadingQr(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHub, bridgeId, request]);

  useEffect(() => {
    if (!isHub || !challenge || challenge.bridgeId !== bridgeId) return;
    let cancelled = false;
    let failures = 0;
    let timer: number;
    const check = async () => {
      try {
        const poll = await pollTuyaQr(bridgeId, challenge.token);
        if (cancelled) return;
        failures = 0;
        setRetryingPoll(false);
        if (poll.loggedIn) {
          await loginConfirmed();
          return;
        }
        if (poll.error) {
          setWaitingConfirm(false);
          reportError('Tuya ended this QR sign-in. Refresh QR to try again.');
          return;
        }
      } catch (error) {
        if (cancelled) return;
        const failure = tuyaQrFailure(error, 'poll');
        if (!failure.retryable || ++failures > MAX_TRANSIENT_POLL_FAILURES) {
          setRetryingPoll(false);
          setWaitingConfirm(false);
          reportError(failure.message);
          return;
        }
        setRetryingPoll(true);
      }
      if (!cancelled) timer = window.setTimeout(() => void check(), QR_POLL_INTERVAL_MS);
    };
    timer = window.setTimeout(() => void check(), QR_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isHub, bridgeId, challenge]);

  if (signedIn) {
    return (
      <Box className="tuya-followup-step">
        <Box className="tuya-install-progress" role="status">
          {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
          <Text>{busy ? 'Signed in to Tuya. Loading cameras…' : 'Signed in to Tuya.'}</Text>
        </Box>
        <Box className="tuya-followup-actions">
          <HausButton variant="ghost" isDisabled={busy} onPress={onCancel}>
            Finish later
          </HausButton>
          <HausButton isPending={busy} isDisabled={busy} onPress={() => void onCamerasReady(true)}>
            <RefreshCw size={14} />
            Check cameras again
          </HausButton>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="tuya-followup-step">
      <Box className="flow-warning-box" role="note">
        <AlertTriangle size={18} />
        <Box>
          <Text semantic="strong">Complete your second Tuya QR sign-in</Text>
          <Text semantic="p">
            {isHub
              ? 'Your Tuya Camera Bridge is paired. Choose your Tuya region if needed and scan this QR code in the Smart Life or Tuya Smart app to import your cameras.'
              : 'Your Tuya Camera Bridge is paired, but it does not list any cameras yet. Open the bridge login screen and scan a fresh Tuya QR code with the Smart Life or Tuya Smart app, then click Check cameras again.'}
          </Text>
        </Box>
      </Box>

      {isHub && (
        <>
          <Text semantic="label" className="tuya-region-row">
            <Text>Tuya account region</Text>
            <SelectInput
              value={region}
              disabled={loadingQr || busy}
              onChange={(nextValue) => {
                setRegion(nextValue);
                setRequest({ region: nextValue });
              }}
              options={regions.map((item) => ({ value: item.id, label: item.label }))}
            />
          </Text>

          {loadingQr && (
            <Box className="tuya-install-progress" role="status">
              <LoaderCircle size={15} className="spin" />
              <Text>Generating Tuya camera QR code…</Text>
            </Box>
          )}

          {challenge && (
            <QrCodeField
              label="Tuya Camera QR Sign-In"
              data={challenge.qrPayload}
              description="Open Smart Life or Tuya Smart, tap +, then Scan."
              showLink={false}
            />
          )}

          {waitingConfirm && challenge && (
            <Box className="tuya-install-progress" role="status">
              <LoaderCircle size={15} className="spin" />
              <Text>
                {retryingPoll
                  ? 'Reconnecting to Tuya Camera Bridge…'
                  : 'Waiting for confirmation in Smart Life / Tuya Smart…'}
              </Text>
            </Box>
          )}
        </>
      )}

      <Box className="tuya-followup-actions">
        <HausButton variant="ghost" isDisabled={busy} onPress={onCancel}>
          Finish later
        </HausButton>
        {!isHub && addon && (addon.ingress || addon.webui) && (
          <HausButton
            variant="secondary"
            isDisabled={busy}
            onPress={() =>
              void nativeApi()
                .openAddon(addon.slug)
                .catch((e) => onError(String(e)))
            }
          >
            Open bridge login
            <ExternalLink size={14} />
          </HausButton>
        )}
        {isHub && (
          <HausButton
            variant="secondary"
            isDisabled={busy || loadingQr}
            onPress={() => setRequest({ region })}
          >
            <RefreshCw size={14} />
            Refresh QR
          </HausButton>
        )}
        <HausButton isPending={busy} isDisabled={busy} onPress={() => void onCamerasReady(false)}>
          <RefreshCw size={14} />
          Check cameras again
        </HausButton>
      </Box>
    </Box>
  );
}
