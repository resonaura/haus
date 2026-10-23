import { Button } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { RemotePressGesture } from '../../model/remote-press';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  House,
  CornerUpLeft,
  Play,
  Pause,
  Check,
} from 'lucide-react';
import type { HassEntity, Snapshot } from '../../model';
import type { Action } from '../../hooks/useHaus';
export function MediaRemote({
  entities,
  snapshot,
  onAction,
}: {
  entities: HassEntity[];
  snapshot: Snapshot;
  onAction: (action: Action) => void;
}) {
  const remote = entities.find(
    (item) =>
      item.entity_id.startsWith('remote.') &&
      !snapshot.entities.find((entry) => entry.entity_id === item.entity_id)?.disabled_by,
  );
  const [heldKey, setHeldKey] = useState<string>();
  const actionRef = useRef(onAction);
  const remoteRef = useRef(remote);
  actionRef.current = onAction;
  remoteRef.current = remote;
  const [gesture] = useState(
    () =>
      new RemotePressGesture((command, held) => {
        const target = remoteRef.current;
        if (!target || ['unknown', 'unavailable'].includes(target.state)) return;
        if (held) setHeldKey(command);
        actionRef.current({
          domain: 'remote',
          service: 'send_command',
          target: { entity_id: target.entity_id },
          service_data: { command, ...(held ? { hold_secs: 1 } : {}) },
        });
      }),
  );
  useEffect(() => {
    const cancel = () => {
      gesture.cancel();
      setHeldKey(undefined);
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    cancel();
    return () => {
      gesture.cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [gesture, remote?.entity_id, remote?.state]);
  if (!remote || !snapshot.services.remote?.send_command) return null;
  const disabled = ['unknown', 'unavailable'].includes(remote.state);
  const pressProps = (command: string) => ({
    'data-held': heldKey === command || undefined,
    onPressStart: () => gesture.start(command),
    onPressEnd: () => {
      gesture.end(command);
      setHeldKey(undefined);
    },
    onPress: () => gesture.press(command),
    onBlur: () => {
      gesture.cancel();
      setHeldKey(undefined);
    },
  });
  const commands = [
    ['up', 'Up', ArrowUp],
    ['left', 'Left', ArrowLeft],
    ['select', 'Select', Check],
    ['right', 'Right', ArrowRight],
    ['down', 'Down', ArrowDown],
  ] as const;
  return (
    <section className="haus-tv-remote" aria-label="Apple TV remote">
      <h3>Remote</h3>
      <div className="haus-remote-pad">
        {commands.map(([command, label, Icon]) => (
          <Button
            key={command}
            className={`remote-${command}`}
            isIconOnly
            variant="ghost"
            aria-label={label}
            isDisabled={disabled}
            {...pressProps(command)}
          >
            <Icon size={23} strokeWidth={1.6} />
          </Button>
        ))}
      </div>
      <div className="haus-remote-actions">
        {(
          [
            ['menu', 'Back', CornerUpLeft],
            ['home', 'Home', House],
            ['play', 'Play', Play],
            ['pause', 'Pause', Pause],
          ] as const
        ).map(([command, label, Icon]) => (
          <Button
            key={command}
            isIconOnly
            variant="secondary"
            aria-label={label}
            isDisabled={disabled}
            {...pressProps(command)}
          >
            <Icon size={19} />
          </Button>
        ))}
      </div>
      <p className="haus-remote-hint">
        {disabled ? 'Remote unavailable' : 'Press and hold for more'}
      </p>
    </section>
  );
}
