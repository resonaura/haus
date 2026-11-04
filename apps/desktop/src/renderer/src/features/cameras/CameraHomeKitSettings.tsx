/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Label, Switch } from '@heroui/react';
import { Home, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { cameraSettings } from '../../ha/camera-settings';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { serverRequest } from '../servers/server-api';
import type { ServersStatus } from '../servers/types';

type Setup = { code: string; setupUri: string; expiresAt: number };
type Pairing = { paired: true } | (Setup & { paired: false });
export function CameraHomeKitSettings({ cameraId }: { cameraId: string }) {
  const camera = useCameraSettings(cameraId);
  const settings = camera?.homekit;
  const [servers, setServers] = useState<ServersStatus['servers']>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState<Setup>();
  const [confirmReset, setConfirmReset] = useState(false);
  const paired = settings?.paired ?? settings?.state === 'paired';
  const qr = useMemo(() => {
    if (!pairing || !/^X-HM:\/\/[0-9A-Z]{13}$/.test(pairing.setupUri)) return;
    const { modules } = QRCode.create(pairing.setupUri, { errorCorrectionLevel: 'M' });
    const path = [];
    for (let row = 0; row < modules.size; row++)
      for (let column = 0; column < modules.size; column++)
        if (modules.get(row, column)) path.push(`M${column + 4} ${row + 4}h1v1h-1z`);
    return { size: modules.size + 8, path: path.join('') };
  }, [pairing]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void serverRequest<ServersStatus>('GET', '/api/servers')
      .then((value) => {
        if (mounted.current)
          setServers(value.servers.filter((server) => server.roles?.includes('stream')));
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(
      () => setPairing(undefined),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pairing]);
  useEffect(() => {
    if (paired || !settings?.enabled) setPairing(undefined);
    if (!paired) setConfirmReset(false);
  }, [paired, settings?.enabled]);
  useEffect(() => {
    if (!settings?.enabled && !paired) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void cameraSettings.refresh(true).catch(() => {});
    };
    const timer = window.setInterval(refresh, 2500);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [settings?.enabled, paired]);
  const save = async (enabled: boolean, processor = settings?.processor ?? 'auto') => {
    setPending(true);
    setError('');
    setPairing(undefined);
    try {
      await serverRequest('POST', `/api/cameras/${cameraId}/homekit`, { enabled, processor });
      await cameraSettings.refresh(true);
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error ? reason.message : 'Apple Home settings could not be saved.',
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  const pair = async () => {
    setPending(true);
    setError('');
    try {
      const value = await serverRequest<Pairing>(
        'POST',
        `/api/cameras/${cameraId}/homekit/pair`,
        {},
      );
      if (mounted.current) setPairing(value.paired ? undefined : value);
      await cameraSettings.refresh(true);
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : 'Pairing could not start.');
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  const manage = async (action: 'close' | 'reset') => {
    setPending(true);
    setError('');
    try {
      await serverRequest('POST', `/api/cameras/${cameraId}/homekit/${action}`, {});
      if (mounted.current) {
        setPairing(undefined);
        setConfirmReset(false);
      }
      await cameraSettings.refresh(true);
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error ? reason.message : 'Apple Home pairing could not be changed.',
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return (
    <section className="camera-homekit-settings" aria-label="Apple Home">
      <Switch
        isSelected={settings?.enabled ?? false}
        isDisabled={!settings || pending}
        onChange={(enabled) => void save(enabled)}
      >
        <Switch.Content>
          <Label>
            <Home size={17} aria-hidden="true" /> Apple Home
          </Label>
        </Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
      <p>
        Live video, sound and Secure Video events from your camera’s shared activity sensor. Home
        Assistant keeps the Apple Home connection.
      </p>
      {!settings && <p>Update Haus Helper to set up Apple Home cameras.</p>}
      {settings?.enabled && (
        <>
          <label className="camera-homekit-worker">
            Video processing
            <select
              value={settings.processor}
              disabled={pending}
              onChange={(event) => void save(true, event.target.value)}
            >
              <option value="auto">NVR automatically · follow Live priorities</option>
              {servers.map((server) => (
                <option key={server.managedId ?? server.id} value={server.managedId ?? server.id}>
                  {server.name}
                </option>
              ))}
              <option value="home">Home Assistant · uses local CPU</option>
            </select>
          </label>
          <div className="camera-analysis-placement" role="status">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>
                {paired
                  ? 'Connected to Apple Home'
                  : settings.state === 'pairing'
                    ? 'Ready to pair'
                    : settings.state === 'unavailable'
                      ? 'Waiting for media'
                      : 'Ready for setup'}
              </strong>
              <p>
                {settings.message ??
                  (settings.prebufferReady
                    ? `Pre-event footage ready${settings.processorName ? ` on ${settings.processorName}` : ''}.`
                    : 'Recording and audio preferences are managed in Apple Home.')}
              </p>
            </div>
          </div>
          {!paired && !pairing && (
            <Button variant="secondary" isPending={pending} onPress={() => void pair()}>
              Add to Apple Home
            </Button>
          )}
          {!paired && pairing && (
            <div className="camera-homekit-pairing" role="status">
              {qr && (
                <svg
                  className="camera-homekit-qr"
                  viewBox={`0 0 ${qr.size} ${qr.size}`}
                  role="img"
                  aria-label="Apple Home pairing QR code"
                  shapeRendering="crispEdges"
                >
                  <rect width={qr.size} height={qr.size} fill="white" />
                  <path d={qr.path} fill="black" />
                </svg>
              )}
              <span>
                On your iPhone, open Home → Add Accessory and scan this QR code. You can also enter
                the setup code manually.
              </span>
              <code aria-label="HomeKit setup code">{pairing.code}</code>
              <small>
                Pairing is available for 10 minutes. An Apple home hub and iCloud+ enable Secure
                Video recording.
              </small>
              {settings.pairingManagement && (
                <Button
                  variant="secondary"
                  isPending={pending}
                  onPress={() => void manage('close')}
                >
                  Stop pairing
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {paired &&
        settings?.pairingManagement &&
        (confirmReset ? (
          <div className="camera-homekit-pairing">
            <p>
              Resetting disconnects this camera from every paired Apple Home controller. Remove the
              old camera from Apple Home before adding it again.
            </p>
            <Button variant="danger" isPending={pending} onPress={() => void manage('reset')}>
              Reset pairing
            </Button>
            <Button variant="secondary" isDisabled={pending} onPress={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" isDisabled={pending} onPress={() => setConfirmReset(true)}>
            Manage pairing
          </Button>
        ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
