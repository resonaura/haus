/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  HausButton,
  HausCode,
  HausSwitch,
  Row,
  SelectInput,
  Text,
  VectorGraphic,
} from '@haus/ui';
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
    <Box semantic="section" className="camera-homekit-settings" ariaLabel="Apple Home">
      <HausSwitch
        isSelected={settings?.enabled ?? false}
        isDisabled={!settings || pending}
        aria-label="Apple Home"
        label={
          <Row gapPx={6}>
            <Home size={17} aria-hidden="true" /> Apple Home
          </Row>
        }
        onChange={(enabled) => void save(enabled)}
      />
      <Text semantic="p">
        Live video, sound and Secure Video events from your camera’s shared activity sensor. Haus
        Hub keeps the Apple Home connection.
      </Text>
      {!settings && <Text semantic="p">Update Haus Hub to set up Apple Home cameras.</Text>}
      {settings?.enabled && (
        <>
          <Text semantic="label" className="camera-homekit-worker">
            Video processing
            <SelectInput
              value={settings.processor}
              disabled={pending}
              options={[
                { value: 'auto', label: 'NVR automatically · follow Live priorities' },
                ...servers.map((server) => ({
                  value: server.managedId ?? server.id,
                  label: server.name,
                })),
                { value: 'home', label: 'Haus Hub · uses local CPU' },
              ]}
              onChange={(next) => void save(true, next)}
            />
          </Text>
          <Box className="camera-analysis-placement" role="status">
            <ShieldCheck size={17} aria-hidden="true" />
            <Box>
              <Text semantic="strong">
                {paired
                  ? 'Connected to Apple Home'
                  : settings.state === 'pairing'
                    ? 'Ready to pair'
                    : settings.state === 'unavailable'
                      ? 'Waiting for media'
                      : 'Ready for setup'}
              </Text>
              <Text semantic="p">
                {settings.message ??
                  (settings.prebufferReady
                    ? `Pre-event footage ready${settings.processorName ? ` on ${settings.processorName}` : ''}.`
                    : 'Recording and audio preferences are managed in Apple Home.')}
              </Text>
            </Box>
          </Box>
          {!paired && !pairing && (
            <HausButton variant="secondary" isPending={pending} onPress={() => void pair()}>
              Add to Apple Home
            </HausButton>
          )}
          {!paired && pairing && (
            <Box className="camera-homekit-pairing" role="status">
              {qr && (
                <VectorGraphic
                  className="camera-homekit-qr"
                  viewWidth={qr.size}
                  viewHeight={qr.size}
                  background="white"
                  role="img"
                  ariaLabel="Apple Home pairing QR code"
                  shapeRendering="crispEdges"
                  paths={[{ d: qr.path, fill: 'black' }]}
                />
              )}
              <Text>
                On your iPhone, open Home → Add Accessory and scan this QR code. You can also enter
                the setup code manually.
              </Text>
              <HausCode ariaLabel="HomeKit setup code">{pairing.code}</HausCode>
              <Text semantic="small">
                Pairing is available for 10 minutes. An Apple home hub and iCloud+ enable Secure
                Video recording.
              </Text>
              {settings.pairingManagement && (
                <HausButton
                  variant="secondary"
                  isPending={pending}
                  onPress={() => void manage('close')}
                >
                  Stop pairing
                </HausButton>
              )}
            </Box>
          )}
        </>
      )}
      {paired &&
        settings?.pairingManagement &&
        (confirmReset ? (
          <Box className="camera-homekit-pairing">
            <Text semantic="p">
              Resetting disconnects this camera from every paired Apple Home controller. Remove the
              old camera from Apple Home before adding it again.
            </Text>
            <HausButton variant="danger" isPending={pending} onPress={() => void manage('reset')}>
              Reset pairing
            </HausButton>
            <HausButton
              variant="secondary"
              isDisabled={pending}
              onPress={() => setConfirmReset(false)}
            >
              Cancel
            </HausButton>
          </Box>
        ) : (
          <HausButton
            variant="secondary"
            isDisabled={pending}
            onPress={() => setConfirmReset(true)}
          >
            Manage pairing
          </HausButton>
        ))}
      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}
    </Box>
  );
}
