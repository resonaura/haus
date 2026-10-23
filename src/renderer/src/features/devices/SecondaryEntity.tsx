import { useState } from 'react';
import { Button } from '@heroui/react';
import { buildAction, type HassEntity as Entity } from '../../model';
import { binaryStateDescription } from '../../model/device-appearance';
import { formatTemperature } from '../../model/format-temperature';
import { numeric, strings, humanize } from './controls/control-values';
type Action = ReturnType<typeof buildAction>;
type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];
export function SecondaryEntity({
  entity,
  disabled,
  onAction,
}: {
  entity: Entity;
  disabled: boolean;
  onAction: (action: Action) => void;
}) {
  const domain = entity.entity_id.split('.')[0];
  const attrs = entity.attributes;
  const [draft, setDraft] = useState(entity.state);
  const [localError, setLocalError] = useState('');
  const act = (intent: Intent, value?: Value) => {
    try {
      setLocalError('');
      onAction(buildAction(entity, intent, value));
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'This action is unavailable.');
    }
  };
  return (
    <div className="haus-secondary-entity">
      <div>
        <span>
          {typeof attrs.friendly_name === 'string'
            ? attrs.friendly_name
            : humanize(entity.entity_id.split('.')[1])}
        </span>
        <small>{entity.entity_id}</small>
      </div>
      {['switch', 'input_boolean'].includes(domain) ? (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={disabled}
          aria-label={`Toggle ${typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id}`}
          aria-pressed={entity.state === 'on'}
          onPress={() => act('toggle')}
        >
          {binaryStateDescription(entity) ?? humanize(entity.state)}
        </Button>
      ) : ['button', 'input_button'].includes(domain) ? (
        <Button size="sm" variant="secondary" isDisabled={disabled} onPress={() => act('press')}>
          Run
        </Button>
      ) : ['select', 'input_select'].includes(domain) ? (
        <select
          aria-label={
            typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
          }
          disabled={disabled}
          value={entity.state}
          onChange={(event) => act('select', event.target.value)}
        >
          {strings(attrs.options).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : ['number', 'input_number'].includes(domain) ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = Number(draft);
            if (Number.isFinite(next)) act('value', next);
          }}
        >
          <input
            type="number"
            aria-label={
              typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
            }
            value={draft}
            min={numeric(attrs.min, 0)}
            max={numeric(attrs.max, 100)}
            step={numeric(attrs.step, 1)}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" isDisabled={disabled}>
            Set
          </Button>
        </form>
      ) : (
        <b>
          {entity.attributes.device_class === 'temperature'
            ? (formatTemperature(entity.state, entity.attributes.suggested_display_precision) ??
              humanize(entity.state))
            : (binaryStateDescription(entity) ?? humanize(entity.state))}{' '}
          {typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : ''}
        </b>
      )}
      {localError && (
        <p role="alert" className="haus-inline-error">
          {localError}
        </p>
      )}
    </div>
  );
}
