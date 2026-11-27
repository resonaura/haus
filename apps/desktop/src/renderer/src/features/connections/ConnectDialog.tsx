/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useState } from 'react';
import { ConnectHomePanel, Dialog } from '@haus/ui/components';
import type { DiscoveredServer } from '../../../../shared/native.js';
import { message } from '../../hooks/useHaus.js';

export function ConnectDialog({
  onClose,
  connect,
  beginPairing,
  onConnected,
  currentUrl,
}: {
  onClose: () => void;
  connect: (url: string, pairingCode?: string, explicitHa?: boolean) => Promise<void>;
  beginPairing: (url: string) => Promise<boolean>;
  onConnected: () => void;
  currentUrl?: string;
}) {
  const [explicitHa, setExplicitHa] = useState(
    Boolean(currentUrl && (currentUrl.includes(':8123') || currentUrl.includes('homeassistant'))),
  );
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [url, setUrl] = useState(currentUrl ?? '');
  const [searching, setSearching] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [pairingUrl, setPairingUrl] = useState('');

  const runScan = useCallback((targetExplicitHa: boolean) => {
    if (!window.hausNative) {
      setSearching(false);
      return () => {};
    }
    let active = true;
    setSearching(true);
    setServers([]);
    void window.hausNative
      .discover({ explicitHa: targetExplicitHa })
      .then((found) => {
        if (active) setServers(found);
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setSearching(false);
      });
    return () => {
      active = false;
      window.hausNative?.cancelDiscovery();
    };
  }, []);

  useEffect(() => {
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') window.hausNative?.cancelDiscovery();
    };
    document.addEventListener('visibilitychange', cancelWhenHidden);
    const stopScan = runScan(explicitHa);
    return () => {
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      stopScan();
    };
  }, [explicitHa, runScan]);

  const submit = async (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setError('');
    setPending(true);
    try {
      if (pairingUrl) {
        await connect(pairingUrl, code.trim(), explicitHa);
      } else if (!explicitHa && (await beginPairing(clean))) {
        setUrl(clean);
        setPairingUrl(clean);
        return;
      } else {
        await connect(clean, undefined, explicitHa);
      }
      onConnected();
    } catch (e) {
      setError(message(e));
      if (pairingUrl) {
        setPairingUrl('');
        setCode('');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title="Let’s bring your home closer." onClose={onClose} className="connect-dialog">
      <ConnectHomePanel
        showHeader={false}
        servers={servers}
        scanning={searching}
        pending={pending}
        explicitHa={explicitHa}
        url={url}
        code={code}
        pairingUrl={pairingUrl || null}
        error={error || null}
        onUrlChange={setUrl}
        onCodeChange={setCode}
        onSubmit={(address) => void submit(address)}
        onScan={() => {
          setError('');
          runScan(explicitHa);
        }}
        onCancelPairing={() => {
          setPairingUrl('');
          setCode('');
          setError('');
        }}
        onToggleExplicitHa={(next) => {
          setExplicitHa(next);
          setUrl('');
          setPairingUrl('');
          setCode('');
          setError('');
        }}
        onClose={onClose}
      />
    </Dialog>
  );
}
