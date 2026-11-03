/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import { Camera, ChevronRight, Link, Radio } from 'lucide-react';
import { serverRequest } from '../servers/server-api';

type Provider = {
  id?: string;
  bridgeId?: string;
  name?: string;
  provider: string;
  url: string;
  managed?: boolean;
};
type Candidate = {
  physicalId: string;
  name: string;
  available: boolean;
  existingCameraId?: string;
  imported: boolean;
};

export function NativeCameraSetup({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [providers, setProviders] = useState<Provider[]>();
  const [connected, setConnected] = useState<Provider[]>([]);
  const [bridgeId, setBridgeId] = useState('');
  const [cameras, setCameras] = useState<Candidate[]>();
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    active.current = true;
    void Promise.all([
      serverRequest<{ providers: Provider[] }>('GET', '/api/providers'),
      serverRequest<{ providers: Provider[] }>('POST', '/api/providers/discover', {}),
    ])
      .then(([paired, found]) => {
        if (!active.current) return;
        setConnected(paired.providers);
        setProviders([
          ...paired.providers,
          ...found.providers.filter(
            (item) => !paired.providers.some((paired) => paired.id === item.bridgeId),
          ),
        ]);
      })
      .catch(() => {
        if (active.current) {
          setProviders([]);
          setError(
            'Camera bridge discovery is unavailable. Check Haus Helper or enter a bridge address.',
          );
        }
      });
    return () => {
      active.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error ? reason.message : 'The camera bridge could not be connected.',
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const showCameras = async (id: string) => {
    const result = await serverRequest<{ cameras: Candidate[] }>('GET', `/api/providers/${id}`);
    if (active.current) {
      setBridgeId(id);
      setCameras(result.cameras);
    }
  };
  const choose = (provider: Provider) =>
    void run(async () => {
      const id = provider.id ?? provider.bridgeId!;
      if (connected.some((item) => item.id === id)) return showCameras(id);
      if (!provider.managed) {
        setUrl(provider.url);
        setManual(true);
        return;
      }
      const result = await serverRequest<{ id: string }>('POST', '/api/providers/connect', {
        bridgeId: id,
      });
      await showCameras(result.id);
    });
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog camera-setup-dialog">
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header>
              <span className="flow-eyebrow">CAMERA BRIDGES</span>
              <Modal.Heading>
                {cameras ? 'Your cameras, connected.' : 'Bring your cameras home.'}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {cameras ? (
                <>
                  <p className="flow-description">
                    Existing recordings stay with their camera. New cameras start in Stream only.
                  </p>
                  <div className="native-camera-candidates">
                    {cameras.map((camera) => (
                      <div key={camera.physicalId}>
                        <Camera aria-hidden="true" />
                        <span>
                          <strong>{camera.name}</strong>
                          <small>
                            {camera.imported
                              ? 'Already added'
                              : camera.existingCameraId
                                ? 'Existing camera · recordings preserved'
                                : 'New camera'}
                          </small>
                        </span>
                        <small>{camera.available ? 'Online' : 'Offline'}</small>
                      </div>
                    ))}
                  </div>
                  {!cameras.length && (
                    <p className="management-hint">
                      No cameras are available in this bridge yet. Add them in its app, then reopen
                      this page.
                    </p>
                  )}
                </>
              ) : manual ? (
                <form
                  id="native-camera-pair"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const result = await serverRequest<{ id: string }>(
                        'POST',
                        '/api/providers/enroll',
                        {
                          url: url.trim(),
                          code: code.trim(),
                          allowHttp: url.trim().startsWith('http:'),
                        },
                      );
                      setCode('');
                      await showCameras(result.id);
                    });
                  }}
                >
                  <p className="flow-description">
                    Open your Aqara or Tuya camera bridge and create a one-time Haus pairing code.
                  </p>
                  <TextField value={url} onChange={setUrl} isRequired>
                    <Label>Bridge address</Label>
                    <Input placeholder="http://camera-bridge.local:8580" autoComplete="off" />
                  </TextField>
                  <TextField value={code} onChange={setCode} isRequired>
                    <Label>Pairing code</Label>
                    <Input type="password" autoComplete="off" spellCheck={false} />
                  </TextField>
                </form>
              ) : (
                <>
                  <p className="flow-description">
                    Connect Aqara and Tuya bridges directly. Compatible Home Assistant add-ons
                    connect in one step.
                  </p>
                  <div className="setup-paths">
                    {providers?.map((provider) => (
                      <Button
                        key={provider.id ?? provider.bridgeId}
                        variant="secondary"
                        className="setup-path"
                        isDisabled={busy}
                        onPress={() => choose(provider)}
                      >
                        <Radio />
                        <span>
                          <strong>
                            {provider.name ??
                              `${provider.provider === 'aqara' ? 'Aqara' : 'Tuya'} Camera Bridge`}
                          </strong>
                          <small>
                            {provider.id
                              ? 'Connected · choose cameras'
                              : provider.managed
                                ? 'Found on Home Assistant'
                                : 'Found on your network'}
                          </small>
                        </span>
                        <ChevronRight />
                      </Button>
                    ))}
                    <Button
                      variant="secondary"
                      className="setup-path"
                      isDisabled={busy}
                      onPress={() => setManual(true)}
                    >
                      <Link />
                      <span>
                        <strong>Connect with an address</strong>
                        <small>A bridge on another server or network</small>
                      </span>
                      <ChevronRight />
                    </Button>
                  </div>
                  {!providers && (
                    <p className="management-hint" role="status">
                      Looking for camera bridges…
                    </p>
                  )}
                </>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={busy} onPress={onClose}>
                Cancel
              </Button>
              {manual && !cameras && (
                <Button type="submit" form="native-camera-pair" isPending={busy}>
                  Connect
                </Button>
              )}
              {cameras && (
                <Button
                  isDisabled={!cameras.length}
                  isPending={busy}
                  onPress={() =>
                    void run(async () => {
                      const ids = cameras
                        .filter((camera) => !camera.imported)
                        .map((camera) => camera.physicalId);
                      if (ids.length)
                        await serverRequest('POST', `/api/providers/${bridgeId}/import`, {
                          cameras: ids,
                        });
                      if (active.current) onDone();
                    })
                  }
                >
                  {cameras.every((camera) => camera.imported) ? 'Done' : 'Add cameras'}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
