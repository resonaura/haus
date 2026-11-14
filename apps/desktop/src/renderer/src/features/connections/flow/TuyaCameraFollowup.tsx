/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { AlertTriangle, Camera, Check, LoaderCircle } from 'lucide-react';
import { supervisor } from '../../../ha/management';
import { serverRequest } from '../../servers/server-api';
import { TuyaBridgeQrStep } from './TuyaBridgeQrStep';
import { TuyaBridgeSetupStep } from './TuyaBridgeSetupStep';
import {
  providerBridgeId,
  resolveTuyaFollowupStage,
  type TuyaAddonCandidate,
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
  type TuyaCameraDetectionResult,
  type TuyaStandaloneBridgeState,
} from './tuya-cameras';
import {
  fetchTuyaFollowupSnapshot,
  installAndPairStandaloneTuyaBridge,
  type TuyaFollowupSnapshot,
} from './tuya-standalone-bridge';
import { notifyPendingTuyaCamerasChanged } from './tuya-camera-pending';

type Stage =
  | 'checking'
  | 'prompt'
  | 'select-cameras'
  | 'second-login'
  | 'pair-bridge'
  | 'addon-setup'
  | 'done';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function TuyaCameraFollowup({
  entryId,
  entryTitle,
  resumed = false,
  focusDeviceName,
  onNoCameras,
  onComplete,
  onCancel,
}: {
  entryId?: string;
  entryTitle?: string;
  resumed?: boolean;
  focusDeviceName?: string;
  onNoCameras: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>('checking');
  const [isHub, setIsHub] = useState(false);
  const [detection, setDetection] = useState<TuyaCameraDetectionResult | null>(null);
  const [bridgeId, setBridgeId] = useState('');
  const [bridgeCameras, setBridgeCameras] = useState<TuyaBridgeCamera[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addon, setAddon] = useState<TuyaAddonCandidate | undefined>();
  const [standaloneBridge, setStandaloneBridge] = useState<TuyaStandaloneBridgeState | undefined>();
  const [installStatus, setInstallStatus] = useState('');
  const [pairUrl, setPairUrl] = useState('http://tuya-rtsp-bridge.local:6766');
  const [pairCode, setPairCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);

  const handleCancel = () => {
    notifyPendingTuyaCamerasChanged();
    onCancel();
  };

  const applySnapshot = (snap: TuyaFollowupSnapshot) => {
    setIsHub(snap.hubSession);
    setDetection(snap.result);
    setAddon(snap.addonCandidate);
    setStandaloneBridge(snap.standaloneCandidate);
    const pid = providerBridgeId(snap.result.pairedBridge);
    if (pid) setBridgeId(pid);
    if (snap.result.discoveredBridge?.url) setPairUrl(snap.result.discoveredBridge.url);
  };

  useEffect(() => {
    active.current = true;
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const snap = await fetchTuyaFollowupSnapshot(entryId);
        if (!active.current) return;
        applySnapshot(snap);

        if (snap.result.shouldPrompt) {
          const initialStage = resolveTuyaFollowupStage(snap.result, resumed);
          if (initialStage === 'select-cameras') {
            setBridgeCameras(snap.result.bridgeCameras);
            setSelectedIds(snap.result.unimportedBridgeCameras.map((cam) => cam.physicalId));
          }
          setStage(initialStage);
          return;
        }
        if (snap.result.hasEntryEntities || !entryId || attempt === 2) {
          onNoCameras();
          return;
        }
        await sleep(1200);
      }
    })();
    return () => {
      active.current = false;
    };
  }, [entryId, resumed]);

  const loadBridgeCameras = async (id: string, warnWhenEmpty = false) => {
    const res = await serverRequest<{ cameras: TuyaBridgeCamera[] }>('GET', `/api/providers/${id}`);
    if (!active.current) return;
    setBridgeId(id);
    setBridgeCameras(res.cameras);
    setSelectedIds(res.cameras.filter((c) => !c.imported).map((c) => c.physicalId));
    if (res.cameras.length > 0) {
      setStage('select-cameras');
      return;
    }
    if (warnWhenEmpty) {
      setError(
        'No cameras reported by the bridge yet. Confirm the QR login in the Tuya app and retry.',
      );
    }
    setStage('second-login');
  };

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      if (active.current) {
        setError(err instanceof Error ? err.message : 'Unable to continue camera setup.');
      }
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const connectDiscoveredBridge = async (targetBridge: TuyaBridgeProvider): Promise<boolean> => {
    const id = targetBridge.bridgeId ?? targetBridge.id;
    if (!id) return false;
    const connected = await serverRequest<{ id?: string; manual?: boolean }>(
      'POST',
      '/api/providers/connect',
      { bridgeId: id },
    );
    if (!active.current) return true;
    if (connected.manual) {
      if (targetBridge.url) setPairUrl(targetBridge.url);
      setStage('pair-bridge');
      return true;
    }
    if (connected.id) {
      await loadBridgeCameras(connected.id);
      return true;
    }
    return false;
  };

  const handleConnectCameras = () =>
    void runAction(async () => {
      const snap = await fetchTuyaFollowupSnapshot(entryId);
      if (!active.current) return;
      applySnapshot(snap);

      const pid = providerBridgeId(snap.result.pairedBridge);
      if (pid) {
        await loadBridgeCameras(pid);
        return;
      }
      if (
        snap.result.discoveredBridge &&
        (await connectDiscoveredBridge(snap.result.discoveredBridge))
      ) {
        return;
      }
      setStage('addon-setup');
    });

  const handleEnrollBridge = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      const trimmedUrl = pairUrl.trim();
      const enrolled = await serverRequest<{ id: string }>('POST', '/api/providers/enroll', {
        url: trimmedUrl,
        code: pairCode.trim(),
        allowHttp: trimmedUrl.startsWith('http:'),
      });
      setPairCode('');
      await loadBridgeCameras(enrolled.id);
    });
  };

  const handleImportSelected = () =>
    void runAction(async () => {
      if (selectedIds.length > 0) {
        await serverRequest('POST', `/api/providers/${bridgeId}/import`, { cameras: selectedIds });
      }
      if (active.current) {
        notifyPendingTuyaCamerasChanged();
        setStage('done');
        onComplete();
      }
    });

  const handleAddonStartOrInstall = () =>
    void runAction(async () => {
      if (isHub && standaloneBridge) {
        const paired = await installAndPairStandaloneTuyaBridge({
          entryId,
          initialBridge: standaloneBridge,
          isActive: () => active.current,
          onStatus: setInstallStatus,
          onSnapshot: applySnapshot,
          onPaired: (id) => loadBridgeCameras(id),
          onManualPair: (url) => {
            if (url) setPairUrl(url);
            setStage('pair-bridge');
          },
        });
        if (!paired && active.current) {
          setError(
            'Tuya Camera Bridge started, but automatic local pairing has not answered yet. Click Connect camera bridge or Pair bridge manually.',
          );
        }
        return;
      }
      if (!addon) return;
      if (!addon.installed) {
        await supervisor(`/store/addons/${addon.slug}/install`, 'post');
      }
      await supervisor(`/addons/${addon.slug}/start`, 'post');
      await sleep(1500);
      await handleConnectCameras();
    });

  return (
    <div className="tuya-followup">
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {stage === 'checking' && (
        <div className="management-loading">
          <LoaderCircle className="spin" />
          <span>Checking {entryTitle || 'Tuya'} for cameras…</span>
        </div>
      )}

      {stage === 'prompt' && detection && (
        <div className="tuya-followup-step">
          <p className="flow-description">
            {resumed && focusDeviceName
              ? `Finish setting up ${focusDeviceName} so live video, two-way audio, and recordings work in Haus.`
              : detection.cameras.length > 0
                ? `Haus detected ${detection.cameras.length} Tuya ${
                    detection.cameras.length === 1 ? 'camera' : 'cameras'
                  }. Would you like to connect them to native live video, two-way audio, and recordings now?`
                : 'A Tuya Camera Bridge was found for your home. Would you like to connect your Tuya cameras now?'}
          </p>

          {detection.cameras.length > 0 && (
            <div className="tuya-camera-list">
              {detection.cameras.map((cam) => (
                <div key={cam.id} className="tuya-camera-chip">
                  <Camera size={15} />
                  <span>{cam.name}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flow-warning-box" role="note">
            <AlertTriangle size={18} />
            <div>
              <strong>A second sign-in will be required</strong>
              <p>
                Tuya issues single-client, one-time QR codes. The login you just scanned only
                authorizes Home Assistant&apos;s Tuya integration — it cannot be shared with the
                native camera bridge. You will scan one more Tuya QR code (or pair the camera
                bridge) in the next step.
              </p>
            </div>
          </div>

          <p className="management-field-desc">
            You can skip for now and finish setup anytime from any Tuya camera in Devices or
            Integrations.
          </p>

          <div className="tuya-followup-actions">
            <Button variant="ghost" isDisabled={busy} onPress={handleCancel}>
              Skip for now
            </Button>
            <Button isPending={busy} isDisabled={busy} onPress={handleConnectCameras}>
              {resumed ? 'Finish setup' : 'Connect cameras'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'select-cameras' && (
        <div className="tuya-followup-step">
          <p className="flow-description">
            Choose which Tuya cameras to import into Haus. Existing recordings remain linked to each
            camera.
          </p>
          <div className="tuya-camera-select-list">
            {bridgeCameras.map((cam) => {
              const checked = selectedIds.includes(cam.physicalId);
              return (
                <label key={cam.physicalId} className="management-check tuya-camera-select-row">
                  <input
                    type="checkbox"
                    disabled={cam.imported || busy}
                    checked={cam.imported || checked}
                    onChange={(event) => {
                      const nextChecked = event.target.checked;
                      setSelectedIds((prev) =>
                        nextChecked
                          ? Array.from(new Set([...prev, cam.physicalId]))
                          : prev.filter((id) => id !== cam.physicalId),
                      );
                    }}
                  />
                  <span>
                    <strong>{cam.name}</strong>
                    <small className="management-field-desc">
                      {cam.imported
                        ? 'Already added'
                        : cam.existingCameraId
                          ? 'Existing camera · recordings preserved'
                          : cam.available
                            ? 'Ready to import'
                            : 'Offline on bridge'}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="tuya-followup-actions">
            <Button variant="ghost" isDisabled={busy} onPress={handleCancel}>
              Skip for now
            </Button>
            <Button
              isPending={busy}
              isDisabled={
                busy || (bridgeCameras.some((c) => !c.imported) && selectedIds.length === 0)
              }
              onPress={handleImportSelected}
            >
              {bridgeCameras.every((c) => c.imported) ? 'Done' : 'Add cameras'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'second-login' && (
        <TuyaBridgeQrStep
          isHub={isHub}
          bridgeId={bridgeId}
          addon={addon}
          busy={busy}
          onCamerasReady={() => runAction(() => loadBridgeCameras(bridgeId, true))}
          onError={setError}
          onCancel={handleCancel}
        />
      )}

      {stage === 'pair-bridge' && (
        <form className="tuya-followup-step" onSubmit={handleEnrollBridge}>
          <div className="flow-warning-box" role="note">
            <AlertTriangle size={18} />
            <div>
              <strong>Second sign-in required for camera streams</strong>
              <p>
                Pair your Tuya Camera Bridge with a one-time Haus pairing code. After pairing,
                ensure the bridge itself is signed in with its separate Tuya QR session.
              </p>
            </div>
          </div>
          <label className="management-field">
            <span>
              Bridge address <i aria-label="required">*</i>
            </span>
            <input
              type="url"
              required
              autoComplete="off"
              value={pairUrl}
              onChange={(event) => setPairUrl(event.target.value)}
            />
          </label>
          <label className="management-field">
            <span>
              Pairing code <i aria-label="required">*</i>
            </span>
            <input
              type="password"
              required
              autoComplete="off"
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value)}
            />
          </label>
          <div className="tuya-followup-actions">
            <Button variant="ghost" isDisabled={busy} onPress={handleCancel}>
              Skip for now
            </Button>
            <Button type="submit" isPending={busy} isDisabled={busy}>
              Pair bridge
            </Button>
          </div>
        </form>
      )}

      {stage === 'addon-setup' && (
        <TuyaBridgeSetupStep
          addon={addon}
          standaloneBridge={standaloneBridge}
          installStatus={installStatus}
          busy={busy}
          onInstallOrStart={handleAddonStartOrInstall}
          onManualPair={() => setStage('pair-bridge')}
          onCancel={handleCancel}
        />
      )}

      {stage === 'done' && (
        <div className="flow-result">
          <Check size={34} />
          <h3>Tuya cameras connected</h3>
          <div className="tuya-followup-actions">
            <Button onPress={handleCancel}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
