/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { AlertTriangle, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { QrCodeField } from '../../../components/forms/QrCodeField';
import { nativeApi } from '../../../ha/management';
import { serverRequest } from '../../servers/server-api';
import { TUYA_REGION_OPTIONS, type TuyaAddonCandidate } from './tuya-cameras';

interface LoginStateResponse {
  loggedIn?: boolean;
  region?: string;
  regions?: Array<{ id: string; name: string }>;
}

interface QrStartResponse {
  token: string;
  qrPayload: string;
}

interface QrPollResponse {
  loggedIn?: boolean;
  error?: string;
}

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
  onCamerasReady: () => Promise<void>;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const [region, setRegion] = useState('us');
  const [regions, setRegions] =
    useState<ReadonlyArray<{ id: string; label: string }>>(TUYA_REGION_OPTIONS);
  const [qrPayload, setQrPayload] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
  const [waitingConfirm, setWaitingConfirm] = useState(false);
  const [nonce, setNonce] = useState(0);

  const loadQrChallenge = async (requestedRegion?: string) => {
    if (!isHub || !bridgeId) return;
    setLoadingQr(true);
    setWaitingConfirm(false);
    setQrPayload('');
    setQrToken('');
    onError('');
    try {
      let targetRegion = requestedRegion;
      if (!targetRegion) {
        const state = await serverRequest<LoginStateResponse>(
          'GET',
          `/api/providers/${bridgeId}/login-state`,
        );
        if (state.regions && state.regions.length > 0) {
          setRegions(
            state.regions.map((item) => ({ id: item.id, label: `${item.name} (${item.id})` })),
          );
        }
        if (state.loggedIn) {
          await onCamerasReady();
          return;
        }
        targetRegion = state.region || 'us';
        setRegion(targetRegion);
      }
      const started = await serverRequest<QrStartResponse>(
        'POST',
        `/api/providers/${bridgeId}/login/qr`,
        {
          region: targetRegion,
        },
      );
      setQrPayload(started.qrPayload);
      setQrToken(started.token);
      setWaitingConfirm(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to start bridge QR sign-in.');
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    if (!isHub || !bridgeId) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadQrChallenge(nonce > 0 ? region : undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [isHub, bridgeId, nonce]);

  useEffect(() => {
    if (!isHub || !bridgeId || !qrToken) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const poll = await serverRequest<QrPollResponse>(
            'GET',
            `/api/providers/${bridgeId}/login/qr/poll?token=${encodeURIComponent(qrToken)}`,
          );
          if (cancelled) return;
          if (poll.loggedIn) {
            window.clearInterval(timer);
            setWaitingConfirm(false);
            await onCamerasReady();
            return;
          }
          if (poll.error) {
            window.clearInterval(timer);
            setWaitingConfirm(false);
            onError(poll.error);
          }
        } catch (err) {
          if (cancelled) return;
          window.clearInterval(timer);
          setWaitingConfirm(false);
          onError(err instanceof Error ? err.message : 'Failed while checking QR login status.');
        }
      })();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isHub, bridgeId, qrToken]);

  return (
    <div className="tuya-followup-step">
      <div className="flow-warning-box" role="note">
        <AlertTriangle size={18} />
        <div>
          <strong>Complete your second Tuya QR sign-in</strong>
          <p>
            {isHub
              ? 'Your Tuya Camera Bridge is paired. Choose your Tuya region if needed and scan this QR code in the Smart Life or Tuya Smart app to import your cameras.'
              : 'Your Tuya Camera Bridge is paired, but it does not list any cameras yet. Open the bridge login screen and scan a fresh Tuya QR code with the Smart Life or Tuya Smart app, then click Check cameras again.'}
          </p>
        </div>
      </div>

      {isHub && (
        <>
          <label className="tuya-region-row">
            <span>Tuya account region</span>
            <select
              value={region}
              disabled={loadingQr || busy}
              onChange={(event) => {
                setRegion(event.target.value);
                setNonce((n) => n + 1);
              }}
            >
              {regions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {loadingQr && (
            <div className="tuya-install-progress" role="status">
              <LoaderCircle size={15} className="spin" />
              <span>Generating Tuya camera QR code…</span>
            </div>
          )}

          {qrPayload && (
            <QrCodeField
              label="Tuya Camera QR Sign-In"
              data={qrPayload}
              description="Open Smart Life / Tuya Smart -> Home -> '+' -> Scan."
            />
          )}

          {waitingConfirm && qrPayload && (
            <div className="tuya-install-progress" role="status">
              <LoaderCircle size={15} className="spin" />
              <span>Waiting for confirmation in Smart Life / Tuya Smart…</span>
            </div>
          )}
        </>
      )}

      <div className="tuya-followup-actions">
        <Button variant="ghost" isDisabled={busy} onPress={onCancel}>
          Finish later
        </Button>
        {!isHub && addon && (addon.ingress || addon.webui) && (
          <Button
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
          </Button>
        )}
        {isHub && (
          <Button
            variant="secondary"
            isDisabled={busy || loadingQr}
            onPress={() => setNonce((n) => n + 1)}
          >
            <RefreshCw size={14} />
            Refresh QR
          </Button>
        )}
        <Button isPending={busy} isDisabled={busy} onPress={() => void onCamerasReady()}>
          <RefreshCw size={14} />
          Check cameras again
        </Button>
      </div>
    </div>
  );
}
