/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState } from 'react';
import { Label, Switch } from '@heroui/react';
import { rest } from '../../../ha/management';

type ExportStatus = { eligible: boolean; enabled: boolean };

export function ExportSettings({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const [hub, setHub] = useState(false);
  const [status, setStatus] = useState<ExportStatus>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const session = await window.hausNative?.getSession();
        if (!current || session?.kind !== 'haus-hub') return;
        setHub(true);
        const value = await rest<ExportStatus>('GET', 'mqtt/exports', { deviceId });
        if (current) setStatus(value);
      } catch {
        if (current) setError('Couldn’t load Home Assistant export settings.');
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [deviceId]);

  async function save(enabled: boolean) {
    setSaving(true);
    setError('');
    try {
      setStatus(await rest<ExportStatus>('POST', 'mqtt/exports', { deviceId, enabled }));
    } catch {
      setError('Couldn’t save Home Assistant export settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!hub) return null;
  return (
    <section aria-label="Home Assistant export">
      {status ? (
        <>
          <Switch
            isSelected={status.enabled}
            isDisabled={!canEdit || saving || (!status.eligible && !status.enabled)}
            onChange={(enabled) => void save(enabled)}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Expose to Home Assistant</Label>
            </Switch.Content>
          </Switch>
          <p className="registry-help">
            {status.eligible
              ? 'Share compatible controls and readings with Home Assistant through MQTT discovery.'
              : 'This device has no compatible controls or readings for MQTT discovery.'}
          </p>
        </>
      ) : (
        !error && <p role="status">Loading Home Assistant export settings…</p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
