import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import type { EntityRegistryEntry, Snapshot } from '../../model';
import { nativeApi, rest, type FlowStep } from '../../ha/management';
import { IntegrationFlow } from './IntegrationFlow';
import {
  cameraSource,
  genericCameraInput,
  sourceEntities,
  type CameraSourceKind,
} from './camera-sources';

export function ManualCameraSetup({
  snapshot,
  existing,
  onClose,
  onDone,
}: {
  snapshot: Snapshot;
  existing: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [flow, setFlow] = useState<FlowStep>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('Camera');
  const [area, setArea] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [values, setValues] = useState({ stream: '', snapshot: '', talk: '' });
  const [entities, setEntities] = useState({ stream: '', snapshot: '', talk: '' });
  const pending = useRef(false);
  const active = useRef(true);
  const ownedFlow = useRef<string | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (ownedFlow.current)
        void rest('DELETE', `config/config_entries/flow/${ownedFlow.current}`).catch(() => {});
    };
  }, []);
  const requestedTalk = useRef<{ entityId: string } | { url: string } | undefined>(undefined);
  const talkBinding = () => {
    if (!values.talk && !entities.talk) return undefined;
    cameraSource(values.talk, entities.talk, 'talk', snapshot);
    return entities.talk ? { entityId: entities.talk } : { url: values.talk.trim() };
  };
  const cameras = useMemo(
    () =>
      snapshot.entities.filter(
        (entry) =>
          entry.entity_id.startsWith('camera.') &&
          !entry.entity_id.endsWith('_internal') &&
          !entry.disabled_by,
      ),
    [snapshot.entities],
  );
  const finish = async (step?: FlowStep) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    if (step?.type === 'create_entry') {
      ownedFlow.current = undefined;
      setFlow(step);
    }
    try {
      const talk = talkBinding();
      let id = cameraId;
      if (!id && step?.result?.entry_id) {
        for (let attempt = 0; attempt < 12; attempt++) {
          const registry = await nativeApi().request<EntityRegistryEntry[]>({
            type: 'config/entity_registry/list',
          });
          id =
            registry.find(
              (entry) =>
                entry.config_entry_id === step.result!.entry_id &&
                entry.entity_id.startsWith('camera.'),
            )?.entity_id ?? '';
          if (id || !active.current) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!active.current) return;
      if (!id) throw Error('The camera is still being added. Retry to finish its settings.');
      setCameraId(id);
      await nativeApi().request({
        type: 'config/entity_registry/update',
        entity_id: id,
        name: name.trim() || 'Camera',
        area_id: area || null,
      });
      if (!active.current) return;
      if (talk || requestedTalk.current) {
        await nativeApi().helper({
          method: 'PATCH',
          path: `/api/cameras/${id}`,
          data: { talkback: talk ?? null },
        });
      }
      if (active.current) onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Camera settings could not be saved.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const submit = async () => {
    if (existing || cameraId || flow?.type === 'create_entry') return void finish(flow);
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      requestedTalk.current = undefined;
      const stream = cameraSource(values.stream, entities.stream, 'stream', snapshot);
      const still = cameraSource(values.snapshot, entities.snapshot, 'snapshot', snapshot);
      if (!stream && !still) throw Error('Add a stream or snapshot address to continue.');
      if (values.talk || entities.talk) {
        requestedTalk.current = talkBinding();
        const status = await nativeApi().helper<{ features?: { customTalkback?: boolean } }>({
          method: 'GET',
          path: '/api/status',
        });
        if (!status.features?.customTalkback)
          throw Error('Update the Haus recording service to connect a custom microphone source.');
      }
      if (ownedFlow.current) {
        await rest('DELETE', `config/config_entries/flow/${ownedFlow.current}`).catch(() => {});
        ownedFlow.current = undefined;
      }
      if (!active.current) return;
      const first = await rest<FlowStep>('POST', 'config/config_entries/flow', {
        handler: 'generic',
      });
      ownedFlow.current = first.flow_id;
      if (!active.current) {
        void rest('DELETE', `config/config_entries/flow/${first.flow_id}`).catch(() => {});
        return;
      }
      if (first.type !== 'form')
        throw Error(first.reason ?? 'This server could not start camera setup.');
      const next = await rest<FlowStep>(
        'POST',
        `config/config_entries/flow/${first.flow_id}`,
        genericCameraInput(first, { stream, snapshot: still }),
      );
      if (!active.current) return;
      // The generic flow component now owns cancellation of this setup.
      ownedFlow.current = undefined;
      setFlow(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The camera could not be connected.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (flow && !cameraId && !error)
    return (
      <IntegrationFlow
        target={{ domain: 'generic', initialStep: flow }}
        snapshot={snapshot}
        onClose={onClose}
        onDone={(step) => {
          void finish(step);
        }}
      />
    );
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog camera-setup-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <span className="flow-eyebrow">{existing ? 'YOUR CAMERAS' : 'CUSTOM CAMERA'}</span>
              <Modal.Heading>
                {(cameraId || flow?.type === 'create_entry') && !existing
                  ? 'Finish camera settings'
                  : existing
                    ? 'Choose your camera'
                    : 'Make the connection.'}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form
                id="camera-setup"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                {existing && (
                  <label className="management-field">
                    <span>Camera</span>
                    <select
                      required
                      value={cameraId}
                      onChange={(event) => {
                        const id = event.target.value;
                        setCameraId(id);
                        const entry = snapshot.entities.find((item) => item.entity_id === id);
                        const device = snapshot.devices.find(
                          (item) => item.id === entry?.device_id,
                        );
                        setName(
                          entry?.name ??
                            snapshot.states.find((state) => state.entity_id === id)?.attributes
                              .friendly_name ??
                            'Camera',
                        );
                        setArea(String(entry?.area_id ?? device?.area_id ?? ''));
                      }}
                    >
                      <option value="">Choose camera</option>
                      {cameras.map((entry) => (
                        <option key={entry.entity_id} value={entry.entity_id}>
                          {entry.name ??
                            snapshot.states.find((state) => state.entity_id === entry.entity_id)
                              ?.attributes.friendly_name ??
                            entry.entity_id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <TextField value={name} onChange={setName} isRequired isDisabled={busy}>
                  <Label>Name</Label>
                  <Input maxLength={100} />
                </TextField>
                <label className="management-field">
                  <span>Room</span>
                  <select
                    value={area}
                    onChange={(event) => setArea(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">Unassigned</option>
                    {snapshot.areas.map((room) => (
                      <option key={room.area_id} value={room.area_id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!existing &&
                  (['stream', 'snapshot', 'talk'] as CameraSourceKind[])
                    .filter(
                      (kind) => (!cameraId && flow?.type !== 'create_entry') || kind === 'talk',
                    )
                    .map((kind) => {
                      const options = sourceEntities(snapshot, kind);
                      const title =
                        kind === 'stream'
                          ? 'Video stream'
                          : kind === 'snapshot'
                            ? 'Snapshot · optional'
                            : 'Microphone output · optional';
                      return (
                        <fieldset className="camera-source-field" key={kind}>
                          <legend>{title}</legend>
                          {!!options.length && (
                            <label className="management-field">
                              <span>Source</span>
                              <select
                                aria-label={`${title} source`}
                                value={entities[kind]}
                                onChange={(event) =>
                                  setEntities((old) => ({ ...old, [kind]: event.target.value }))
                                }
                              >
                                <option value="">Enter an address</option>
                                {options.map((state) => (
                                  <option key={state.entity_id} value={state.entity_id}>
                                    {state.attributes.friendly_name ?? state.entity_id}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {!entities[kind] && (
                            <TextField
                              value={values[kind]}
                              onChange={(value) => setValues((old) => ({ ...old, [kind]: value }))}
                              isDisabled={busy}
                            >
                              <Label>
                                {kind === 'stream'
                                  ? 'RTSP or HTTP address'
                                  : kind === 'snapshot'
                                    ? 'HTTP snapshot address'
                                    : 'RTMP talk address'}
                              </Label>
                              <Input type="text" autoComplete="off" spellCheck={false} />
                            </TextField>
                          )}
                          <small>
                            {kind === 'stream'
                              ? 'The camera address is checked by your home server before it is added.'
                              : kind === 'snapshot'
                                ? 'Leave empty to get snapshots from the video stream.'
                                : 'Audio is sent only while you press Talk. Leave empty if your camera does not support it.'}
                          </small>
                        </fieldset>
                      );
                    })}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose} isDisabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="camera-setup"
                isPending={busy}
                isDisabled={busy || (existing && !cameraId)}
              >
                {existing || cameraId || flow?.type === 'create_entry'
                  ? 'Save camera'
                  : 'Check connection'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
