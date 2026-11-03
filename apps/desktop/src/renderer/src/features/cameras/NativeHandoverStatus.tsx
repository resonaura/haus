/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Button } from '@heroui/react';
import { CheckCircle2, CircleHelp, Link2, Radio, ShieldCheck } from 'lucide-react';
import type { NativeHandover, NativeHandoverState } from './useNativeHandover';

const descriptions: Record<NativeHandoverState, { title: string; detail: string }> = {
  connected: {
    title: 'Connected to Home Assistant',
    detail:
      'Your cameras, supported controls and Activity are connected. Recordings stay with their cameras.',
  },
  ready: {
    title: 'Ready to finish connecting',
    detail:
      'Home Assistant has added every camera and supported control. Finish to confirm the connection.',
  },
  import_required: {
    title: 'Add the bridge’s cameras first',
    detail: 'Choose the cameras in Add device before connecting their controls to Home Assistant.',
  },
  integration_required: {
    title: 'Waiting for Home Assistant',
    detail:
      'Install or reconfigure the Haus integration with a new setup code. Continue when all supported controls have been added.',
  },
  migration_required: {
    title: 'Keep your existing devices connected',
    detail:
      'These older entities still need to be moved before finishing. Keep their IDs and references so your automations continue working.',
  },
  restoring: {
    title: 'Restoring the previous connection',
    detail:
      'MQTT will resume when the bridge responds. Its camera media and recordings remain connected to Haus.',
  },
  unavailable: {
    title: 'Waiting for the camera bridge',
    detail: 'The bridge is not responding. Your existing connection has not been changed.',
  },
};

export function NativeHandoverStatus({
  bridge,
  pending,
  disabled,
  onComplete,
}: {
  bridge: NativeHandover;
  pending: boolean;
  disabled: boolean;
  onComplete: (id: string) => void;
}) {
  const text = descriptions[bridge.state] ?? descriptions.unavailable;
  const Icon =
    bridge.state === 'connected'
      ? CheckCircle2
      : bridge.state === 'ready'
        ? ShieldCheck
        : bridge.state === 'migration_required'
          ? CircleHelp
          : bridge.state === 'unavailable'
            ? Radio
            : Link2;
  const legacy = [...new Set(bridge.cameras.flatMap((camera) => camera.legacyEntities))];
  return (
    <div className="camera-ha-handover" data-state={bridge.state}>
      <div className="camera-ha-handover-title">
        <Icon size={18} aria-hidden="true" />
        <strong>{text.title}</strong>
      </div>
      <p>{text.detail}</p>
      {bridge.state === 'migration_required' && legacy.length > 0 && (
        <details>
          <summary>Review existing entities · {legacy.length}</summary>
          <ul>
            {legacy.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {bridge.state === 'ready' && (
        <Button
          variant="secondary"
          isDisabled={disabled}
          isPending={pending}
          onPress={() => onComplete(bridge.bridgeId)}
        >
          Finish connecting
        </Button>
      )}
    </div>
  );
}
