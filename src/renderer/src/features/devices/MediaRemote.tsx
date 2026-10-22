import { Button } from '@heroui/react';
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
  if (!remote || !snapshot.services.remote?.send_command) return null;
  const disabled = ['unknown', 'unavailable'].includes(remote.state);
  const send = (command: string) =>
    onAction({
      domain: 'remote',
      service: 'send_command',
      target: { entity_id: remote.entity_id },
      service_data: { command },
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
            onPress={() => send(command)}
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
            onPress={() => send(command)}
          >
            <Icon size={19} />
          </Button>
        ))}
      </div>
      {disabled && <p>Remote unavailable</p>}
    </section>
  );
}
