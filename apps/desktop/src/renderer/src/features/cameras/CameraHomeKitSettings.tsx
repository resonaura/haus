/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Label, Switch } from '@heroui/react';
import { Home, ShieldCheck } from 'lucide-react';
import { cameraSettings } from '../../ha/camera-settings';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { serverRequest } from '../servers/server-api';
import type { ServersStatus } from '../servers/types';

type Pairing = { code: string; setupUri: string; expiresAt: number; paired: boolean };
export function CameraHomeKitSettings({ cameraId }: { cameraId: string }) {
  const camera = useCameraSettings(cameraId);
  const settings = camera?.homekit;
  const [servers, setServers] = useState<ServersStatus['servers']>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState<Pairing>();
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
      if (mounted.current) setPairing(value);
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : 'Pairing could not start.');
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
                {settings.state === 'paired'
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
          <Button variant="secondary" isPending={pending} onPress={() => void pair()}>
            {settings.state === 'paired' ? 'Show pairing information' : 'Connect to Apple Home'}
          </Button>
          {pairing && (
            <div className="camera-homekit-pairing" role="status">
              <span>
                {pairing.paired
                  ? 'Already paired'
                  : 'In Apple Home, choose Add Accessory → More options, then select this camera.'}
              </span>
              <code aria-label="HomeKit setup code">{pairing.code}</code>
              <small>
                Pairing is available for 10 minutes. An Apple home hub and iCloud+ enable Secure
                Video recording.
              </small>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
