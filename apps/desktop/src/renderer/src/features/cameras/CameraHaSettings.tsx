/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { serverRequest } from '../servers/server-api';

export function CameraHaSettings() {
  const [setup, setSetup] = useState<{ setupCode: string; expiresAt: number; url: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!setup) return;
    const timer = setTimeout(() => setSetup(undefined), Math.max(0, setup.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [setup]);
  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      setSetup(
        await serverRequest('POST', '/api/ha-integration', {
          action: 'setup',
          nativeEntities: true,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Home Assistant setup could not start.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="camera-homekit-settings" aria-label="Home Assistant cameras">
      <h3>Home Assistant cameras</h3>
      <p>
        Share responsive video, cached images, activity and supported camera controls with Home
        Assistant.
      </p>
      <Button variant="secondary" isPending={busy} onPress={() => void generate()}>
        Connect Home Assistant
      </Button>
      {setup && (
        <div className="camera-homekit-pairing">
          <span>
            Add resonaura/haus as an Integration in HACS, install Haus and restart Home Assistant.
            Then add Haus, or choose Reconfigure on your existing Haus integration, with this
            one-time code.
          </span>
          <code className="camera-ha-setup-code">{setup.setupCode}</code>
          <small>
            Helper address: {setup.url}. Expires in 10 minutes. Authorizes cameras and their native
            controls; no server management or HomeKit pairing access.
          </small>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
