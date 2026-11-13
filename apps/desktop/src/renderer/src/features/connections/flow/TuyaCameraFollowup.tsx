/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import {
  AlertTriangle,
  Camera,
  Check,
  ExternalLink,
  Link,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { nativeApi, supervisor } from '../../../ha/management';
import { serverRequest } from '../../servers/server-api';
import {
  detectTuyaCameraCandidates,
  findTuyaBridgeAddon,
  type TuyaAddonCandidate,
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
  type TuyaCameraDetectionResult,
  type TuyaCameraRegistryDevice,
  type TuyaCameraRegistryEntity,
} from './tuya-cameras';

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
  onNoCameras,
  onComplete,
  onCancel,
}: {
  entryId?: string;
  entryTitle?: string;
  onNoCameras: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>('checking');
  const [detection, setDetection] = useState<TuyaCameraDetectionResult | null>(null);
  const [bridgeId, setBridgeId] = useState('');
  const [bridgeCameras, setBridgeCameras] = useState<TuyaBridgeCamera[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addon, setAddon] = useState<TuyaAddonCandidate | undefined>();
  const [pairUrl, setPairUrl] = useState('http://tuya-rtsp-bridge.local:6766');
  const [pairCode, setPairCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);

  const fetchSnapshotState = async (): Promise<{
    result: TuyaCameraDetectionResult;
    addonCandidate?: TuyaAddonCandidate;
  }> => {
    const [entities, devices, pairedRes, discoveredRes, addonsRes, storeRes] = await Promise.all([
      nativeApi()
        .request<TuyaCameraRegistryEntity[]>({ type: 'config/entity_registry/list' })
        .catch(() => []),
      nativeApi()
        .request<TuyaCameraRegistryDevice[]>({ type: 'config/device_registry/list' })
        .catch(() => []),
      serverRequest<{ providers: TuyaBridgeProvider[] }>('GET', '/api/providers').catch(() => ({
        providers: [],
      })),
      serverRequest<{ providers: TuyaBridgeProvider[] }>(
        'POST',
        '/api/providers/discover',
        {},
      ).catch(() => ({ providers: [] })),
      supervisor<{ addons?: TuyaAddonCandidate[] }>('/addons').catch(() => ({ addons: [] })),
      supervisor<{ addons?: TuyaAddonCandidate[] }>('/store').catch(() => ({ addons: [] })),
    ]);

    const pairedBridge = pairedRes.providers.find((item) => item.provider === 'tuya');
    const pairedBridgeCameras: Record<string, TuyaBridgeCamera[]> = {};
    if (pairedBridge?.id) {
      const preview = await serverRequest<{ cameras: TuyaBridgeCamera[] }>(
        'GET',
        `/api/providers/${pairedBridge.id}`,
      ).catch(() => null);
      if (preview?.cameras) pairedBridgeCameras[pairedBridge.id] = preview.cameras;
    }

    const result = detectTuyaCameraCandidates({
      entryId,
      entities,
      devices,
      pairedProviders: pairedRes.providers,
      discoveredProviders: discoveredRes.providers,
      pairedBridgeCameras,
    });
    const addonCandidate = findTuyaBridgeAddon(addonsRes.addons ?? [], storeRes.addons ?? []);
    return { result, addonCandidate };
  };

  useEffect(() => {
    active.current = true;
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { result, addonCandidate } = await fetchSnapshotState();
        if (!active.current) return;
        setAddon(addonCandidate);

        if (result.shouldPrompt) {
          setDetection(result);
          if (result.pairedBridge?.id) setBridgeId(result.pairedBridge.id);
          if (result.discoveredBridge?.url) setPairUrl(result.discoveredBridge.url);
          setStage('prompt');
          return;
        }
        if (result.hasEntryEntities || !entryId || attempt === 2) {
          onNoCameras();
          return;
        }
        await sleep(1200);
      }
    })();
    return () => {
      active.current = false;
    };
  }, [entryId]);

  const loadBridgeCameras = async (id: string) => {
    const res = await serverRequest<{ cameras: TuyaBridgeCamera[] }>('GET', `/api/providers/${id}`);
    if (!active.current) return;
    setBridgeId(id);
    setBridgeCameras(res.cameras);
    setSelectedIds(res.cameras.filter((c) => !c.imported).map((c) => c.physicalId));
    setStage(res.cameras.length > 0 ? 'select-cameras' : 'second-login');
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

  const handleConnectCameras = () =>
    void runAction(async () => {
      const { result, addonCandidate } = await fetchSnapshotState();
      if (!active.current) return;
      setDetection(result);
      setAddon(addonCandidate);

      if (result.pairedBridge?.id) {
        await loadBridgeCameras(result.pairedBridge.id);
        return;
      }
      const targetBridge = result.discoveredBridge;
      if (targetBridge) {
        const id = targetBridge.bridgeId ?? targetBridge.id;
        if (id) {
          const connected = await serverRequest<{ id?: string; manual?: boolean }>(
            'POST',
            '/api/providers/connect',
            { bridgeId: id },
          );
          if (!active.current) return;
          if (connected.manual) {
            if (targetBridge.url) setPairUrl(targetBridge.url);
            setStage('pair-bridge');
            return;
          }
          if (connected.id) {
            await loadBridgeCameras(connected.id);
            return;
          }
        }
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
        setStage('done');
        onComplete();
      }
    });

  const handleAddonStartOrInstall = () =>
    void runAction(async () => {
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
            {detection.cameras.length > 0
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

          <div className="tuya-followup-actions">
            <Button variant="ghost" isDisabled={busy} onPress={onCancel}>
              Skip for now
            </Button>
            <Button isPending={busy} isDisabled={busy} onPress={handleConnectCameras}>
              Connect cameras
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
            <Button variant="ghost" isDisabled={busy} onPress={onCancel}>
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
        <div className="tuya-followup-step">
          <div className="flow-warning-box" role="note">
            <AlertTriangle size={18} />
            <div>
              <strong>Complete your second Tuya QR sign-in</strong>
              <p>
                Your Tuya Camera Bridge is paired, but it does not list any cameras yet. Open the
                bridge login screen and scan a fresh Tuya QR code with the Smart Life or Tuya Smart
                app, then click Check cameras again.
              </p>
            </div>
          </div>
          <div className="tuya-followup-actions">
            <Button variant="ghost" isDisabled={busy} onPress={onCancel}>
              Finish later
            </Button>
            {addon && (addon.ingress || addon.webui) && (
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() =>
                  void nativeApi()
                    .openAddon(addon.slug)
                    .catch((e) => setError(String(e)))
                }
              >
                Open bridge login
                <ExternalLink size={14} />
              </Button>
            )}
            <Button
              isPending={busy}
              isDisabled={busy}
              onPress={() => void runAction(() => loadBridgeCameras(bridgeId))}
            >
              <RefreshCw size={14} />
              Check cameras again
            </Button>
          </div>
        </div>
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
            <Button variant="ghost" isDisabled={busy} onPress={onCancel}>
              Skip for now
            </Button>
            <Button type="submit" isPending={busy} isDisabled={busy}>
              Pair bridge
            </Button>
          </div>
        </form>
      )}

      {stage === 'addon-setup' && (
        <div className="tuya-followup-step">
          <div className="flow-warning-box" role="note">
            <AlertTriangle size={18} />
            <div>
              <strong>Tuya Camera Bridge needed</strong>
              <p>
                {addon
                  ? addon.installed
                    ? `The ${addon.name} add-on is installed on Home Assistant, but currently stopped. Start it, then complete the second Tuya QR sign-in for camera streams.`
                    : `Install ${addon.name} on Home Assistant and complete a second Tuya QR sign-in to stream P2P/RTSP video natively in Haus.`
                  : 'Install or start the Tuya RTSP/Camera Bridge, complete its second Tuya QR login, and pair its address below.'}
              </p>
            </div>
          </div>
          <div className="tuya-followup-actions">
            <Button variant="ghost" isDisabled={busy} onPress={onCancel}>
              Finish without cameras
            </Button>
            <Button variant="secondary" isDisabled={busy} onPress={() => setStage('pair-bridge')}>
              <Link size={14} />
              Pair bridge manually
            </Button>
            {addon && (
              <Button isPending={busy} isDisabled={busy} onPress={handleAddonStartOrInstall}>
                {addon.installed ? 'Start camera bridge' : 'Install camera bridge'}
              </Button>
            )}
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className="flow-result">
          <Check size={34} />
          <h3>Tuya cameras connected</h3>
          <div className="tuya-followup-actions">
            <Button onPress={onCancel}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
