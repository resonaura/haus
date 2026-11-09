/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { House, Wifi, LoaderCircle, Radio, ArrowRight } from 'lucide-react';
import type { DiscoveredServer } from '../../../../shared/native.js';
import { message } from '../../hooks/useHaus.js';
import { Dialog } from '../../components/ui/Dialog.js';

export function ConnectDialog({
  onClose,
  connect,
  beginPairing,
  onConnected,
  currentUrl,
}: {
  onClose: () => void;
  connect: (url: string, pairingCode?: string) => Promise<void>;
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

  useEffect(() => {
    let active = true;
    setSearching(true);
    setServers([]);
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') window.hausNative?.cancelDiscovery();
    };
    document.addEventListener('visibilitychange', cancelWhenHidden);
    if (window.hausNative) {
      void window.hausNative
        .discover({ explicitHa })
        .then((s) => {
          if (active) setServers(s);
        })
        .catch((e) => {
          if (active) setError(message(e));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    } else {
      setSearching(false);
    }
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      window.hausNative?.cancelDiscovery();
    };
  }, [explicitHa]);

  const submit = async (value: string) => {
    setError('');
    setPending(true);
    try {
      if (pairingUrl) {
        await connect(pairingUrl, code.trim());
      } else if (!explicitHa && (await beginPairing(value))) {
        setUrl(value);
        setPairingUrl(value);
        return;
      } else {
        await connect(value);
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
      <div className="connect-illustration">
        <span />
        <House size={55} strokeWidth={1.2} />
        <i>
          <Wifi size={19} />
        </i>
      </div>
      <p className="dialog-description">
        {explicitHa
          ? 'Connect Home Assistant and all your rooms, accessories, and scenes will feel right at home.'
          : 'Connect your Haus Hub to bring all your rooms, accessories, and scenes together.'}
      </p>
      <div className="discovery-label">
        {searching ? (
          <>
            <LoaderCircle className="spin" size={15} />
            {explicitHa ? 'Looking for Home Assistant…' : 'Looking for your Haus Hub…'}
          </>
        ) : (
          <>
            <Radio size={15} />
            {servers.length
              ? 'FOUND ON YOUR NETWORK'
              : explicitHa
                ? 'YOUR HOME ASSISTANT'
                : 'YOUR HAUS HUB'}
          </>
        )}
      </div>
      {servers.map((s) => (
        <button
          className="discovered-server"
          key={s.url}
          onClick={() => void submit(s.url)}
          disabled={pending}
        >
          <span className="home-avatar">
            <House size={20} />
          </span>
          <span>
            <strong>{s.name}</strong>
            <small>{s.url}</small>
          </span>
          <ArrowRight size={19} />
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(url);
        }}
      >
        <label htmlFor="hub-url">
          {explicitHa ? 'Home Assistant address' : 'Haus Hub address'}
        </label>
        <input
          id="hub-url"
          type="url"
          placeholder={explicitHa ? 'http://homeassistant.local:8123' : 'http://hub.local:8443'}
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending || Boolean(pairingUrl)}
        />
        <p className="input-hint">
          {explicitHa
            ? 'You’ll sign in securely in your browser. No API token needed.'
            : 'Enter your Haus Hub local endpoint to connect and pair.'}
        </p>
        {pairingUrl && (
          <>
            <label htmlFor="hub-code">Pairing code</label>
            <input
              id="hub-code"
              autoFocus
              autoComplete="off"
              placeholder="8 characters shown in the Hub log"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={pending}
            />
            <p className="input-hint">
              Your Hub printed a one-time code. Find it with “docker logs haus-hub”.
            </p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="connect-submit"
          isPending={pending}
          isDisabled={!url || pending || (Boolean(pairingUrl) && !code.trim())}
        >
          {pending ? (
            <>
              <LoaderCircle size={17} className="spin" />
              Connecting…
            </>
          ) : (
            <>
              {explicitHa
                ? 'Connect Home Assistant'
                : pairingUrl
                  ? 'Pair with this Hub'
                  : 'Connect your Haus Hub'}
              <ArrowRight size={17} />
            </>
          )}
        </Button>
      </form>
      <button
        type="button"
        className="connect-explicit-toggle"
        onClick={() => {
          const next = !explicitHa;
          setExplicitHa(next);
          setUrl('');
          setError('');
        }}
      >
        {explicitHa
          ? '← Connect to a Haus Hub instead'
          : 'Have Home Assistant? Add or import it explicitly'}
      </button>
      <button className="connect-later" onClick={onClose}>
        Keep exploring for now
      </button>
    </Dialog>
  );
}
