/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useState } from 'react';
import { Box, HausSwitch, Text } from '@haus/ui';
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
    <Box semantic="section" ariaLabel="Home Assistant export">
      {status ? (
        <>
          <HausSwitch
            isSelected={status.enabled}
            isDisabled={!canEdit || saving || (!status.eligible && !status.enabled)}
            label="Expose to Home Assistant"
            onChange={(enabled) => void save(enabled)}
          />
          <Text semantic="p" className="registry-help">
            {status.eligible
              ? 'Share compatible controls and readings with Home Assistant through MQTT discovery.'
              : 'This device has no compatible controls or readings for MQTT discovery.'}
          </Text>
        </>
      ) : (
        !error && (
          <Text semantic="p" role="status">
            Loading Home Assistant export settings…
          </Text>
        )
      )}
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
    </Box>
  );
}
