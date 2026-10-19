import { Button } from '@heroui/react';
import { Power } from 'lucide-react';
import { buildAction, type HassEntity } from '../../model';
import { lightProfile } from '../../model/light-profile';
import { deviceAppearance } from '../../model/device-appearance';
import { LightColour } from '../devices/controls/LightColour';
import { ControlRange } from '../devices/controls/ControlRange';
import { numeric } from '../devices/controls/control-values';
import { SecondaryEntity } from '../devices/SecondaryEntity';
import type { CSSProperties } from 'react';

type Action = ReturnType<typeof buildAction>;
/** Camera controls share the same capability and commit rules as the main light controller. */
export function CameraParameter({
  entity,
  onAction,
}: {
  entity: HassEntity;
  onAction: (action: Action) => void;
}) {
  const domain = entity.entity_id.split('.')[0];
  const label = String(entity.attributes.friendly_name ?? 'Camera control');
  const disabled = ['unavailable', 'unknown'].includes(entity.state) && domain !== 'button';
  if (domain === 'light') {
    const capabilities = Object.entries(lightProfile(entity))
      .filter(([, value]) => value === true)
      .map(([key]) => key);
    const act = (
      intent: Parameters<typeof buildAction>[1],
      value?: Parameters<typeof buildAction>[2],
    ) => onAction(buildAction(entity, intent, value));
    return (
      <section
        className="camera-light-parameter"
        style={{ '--device-color': deviceAppearance(entity).accent } as CSSProperties}
      >
        <header>
          <strong>{label}</strong>
          <Button
            isIconOnly
            variant="secondary"
            aria-label={`Toggle ${label}`}
            aria-pressed={entity.state === 'on'}
            isDisabled={disabled}
            onPress={() => act('toggle')}
          >
            <Power size={18} />
          </Button>
        </header>
        {capabilities.includes('brightness') && (
          <ControlRange
            label="Brightness"
            value={Math.round(numeric(entity.attributes.brightness, 0) / 2.55)}
            disabled={disabled}
            onCommit={(value) => act('brightness', value)}
          />
        )}
        <LightColour
          entity={entity}
          capabilities={capabilities}
          disabled={disabled}
          act={act}
          initiallyExpanded
        />
      </section>
    );
  }
  if (['number', 'input_number'].includes(domain))
    return (
      <section className="camera-number-parameter">
        <ControlRange
          label={label}
          min={numeric(entity.attributes.min, 0)}
          max={numeric(entity.attributes.max, 100)}
          step={numeric(entity.attributes.step, 1)}
          value={numeric(entity.state, numeric(entity.attributes.min, 0))}
          unit={String(entity.attributes.unit_of_measurement ?? '')}
          disabled={disabled}
          onCommit={(value) => onAction(buildAction(entity, 'value', value))}
        />
      </section>
    );
  return <SecondaryEntity entity={entity} disabled={disabled} onAction={onAction} />;
}
