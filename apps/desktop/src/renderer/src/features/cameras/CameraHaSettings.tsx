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
      setSetup(await serverRequest('POST', '/api/ha-integration', { action: 'setup' }));
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
        The Haus integration provides cached images and responsive video in Home Assistant. It keeps
        the source cameras intact and prevents duplicate cameras in Haus.
      </p>
      <Button variant="secondary" isPending={busy} onPress={() => void generate()}>
        Connect Home Assistant
      </Button>
      {setup && (
        <div className="camera-homekit-pairing">
          <span>
            Add resonaura/haus as an Integration in HACS, install Haus and restart Home Assistant.
            Then add the Haus integration with this one-time code.
          </span>
          <code className="camera-ha-setup-code">{setup.setupCode}</code>
          <small>
            Helper address: {setup.url}. This code expires in 10 minutes and authorizes cameras
            only.
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
