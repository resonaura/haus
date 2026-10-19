import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { House, Wifi, LoaderCircle, Radio, ArrowRight } from 'lucide-react';
import type { DiscoveredServer } from '../../../../shared/native';
import { message } from '../../hooks/useHaus';
import { Dialog } from '../../components/ui/Dialog';

export function ConnectDialog({
  onClose,
  connect,
  onConnected,
  currentUrl,
}: {
  onClose: () => void;
  connect: (url: string) => Promise<void>;
  onConnected: () => void;
  currentUrl?: string;
}) {
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [url, setUrl] = useState(currentUrl ?? '');
  const [searching, setSearching] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (window.hausNative)
      void window.hausNative
        .discover()
        .then((s) => {
          if (active) setServers(s);
        })
        .catch((e) => {
          if (active) setError(message(e));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    else setSearching(false);
    return () => {
      active = false;
    };
  }, []);
  const submit = async (value: string) => {
    setError('');
    setPending(true);
    try {
      await connect(value);
      onConnected();
    } catch (e) {
      setError(message(e));
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
        Connect Home Assistant and all your rooms, accessories, and scenes will feel right at home.
      </p>
      <div className="discovery-label">
        {searching ? (
          <>
            <LoaderCircle className="spin" size={15} />
            Looking for your home…
          </>
        ) : (
          <>
            <Radio size={15} />
            {servers.length ? 'FOUND ON YOUR NETWORK' : 'YOUR HOME ASSISTANT'}
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
        <label htmlFor="ha-url">Home Assistant address</label>
        <input
          id="ha-url"
          type="url"
          placeholder="http://homeassistant.local:8123"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending}
        />
        <p className="input-hint">You’ll sign in securely in your browser. No API token needed.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="connect-submit"
          isPending={pending}
          isDisabled={!url || pending}
        >
          {pending ? (
            <>
              <LoaderCircle size={17} className="spin" />
              Complete sign-in in your browser…
            </>
          ) : (
            <>
              Connect your home
              <ArrowRight size={17} />
            </>
          )}
        </Button>
      </form>
      <button className="connect-later" onClick={onClose}>
        Keep exploring for now
      </button>
    </Dialog>
  );
}
