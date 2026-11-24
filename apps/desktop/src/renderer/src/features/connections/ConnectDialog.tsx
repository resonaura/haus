/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import { Box, HausButton, HausForm, Pressable, Text } from '@haus/ui';
import { House, Wifi, LoaderCircle, Radio, ArrowRight } from 'lucide-react';
import type { DiscoveredServer } from '../../../../shared/native.js';
import { message } from '../../hooks/useHaus.js';
import { ConnectionField, Dialog } from '@haus/ui/components';

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
        await connect(pairingUrl, code.trim(), explicitHa);
      } else if (!explicitHa && (await beginPairing(value))) {
        setUrl(value);
        setPairingUrl(value);
        return;
      } else {
        await connect(value, undefined, explicitHa);
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
      <Box className="connect-illustration">
        <Text />
        <House size={55} strokeWidth={1.2} />
        <Text semantic="swatch">
          <Wifi size={19} />
        </Text>
      </Box>
      <Text semantic="p" className="dialog-description">
        {explicitHa
          ? 'Connect Home Assistant and all your rooms, accessories, and scenes will feel right at home.'
          : 'Connect your Haus Hub to bring all your rooms, accessories, and scenes together.'}
      </Text>
      <Box className="discovery-label">
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
      </Box>
      {servers.map((s) => (
        <Pressable
          className="discovered-server"
          key={s.url}
          onPress={() => void submit(s.url)}
          disabled={pending}
        >
          <Text className="home-avatar">
            <House size={20} />
          </Text>
          <Text>
            <Text semantic="strong">{s.name}</Text>
            <Text semantic="small">{s.url}</Text>
          </Text>
          <ArrowRight size={19} />
        </Pressable>
      ))}
      <HausForm onSubmit={() => void submit(url)}>
        <ConnectionField
          id="hub-url"
          label={explicitHa ? 'Home Assistant address' : 'Haus Hub address'}
          inputType="url"
          placeholder={explicitHa ? 'http://homeassistant.local:8123' : 'http://192.168.5.115:8790'}
          required
          value={url}
          onChange={setUrl}
          disabled={pending || Boolean(pairingUrl)}
          hint={
            explicitHa
              ? 'You’ll sign in securely in your browser. No API token needed.'
              : 'Enter your Haus Hub local endpoint. First connection pairs automatically.'
          }
        />
        {pairingUrl && (
          <ConnectionField
            id="hub-code"
            label="Pairing code"
            autoFocus
            autoComplete="off"
            placeholder="8 characters displayed on your other device"
            value={code}
            onChange={setCode}
            disabled={pending}
            hint="Enter the code shown on your already-connected Haus device."
          />
        )}
        {error && (
          <Text semantic="p" className="form-error" role="alert">
            {error}
          </Text>
        )}
        <HausButton
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
        </HausButton>
      </HausForm>
      <Pressable
        className="connect-explicit-toggle"
        onPress={() => {
          const next = !explicitHa;
          setExplicitHa(next);
          setUrl('');
          setError('');
        }}
      >
        {explicitHa
          ? '← Connect to a Haus Hub instead'
          : 'Have Home Assistant? Add or import it explicitly'}
      </Pressable>
      <Pressable className="connect-later" onPress={onClose}>
        Keep exploring for now
      </Pressable>
    </Dialog>
  );
}
