/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, HausButton, HausForm, HausSwitch, SelectInput, Text, TextInput } from '@haus/ui';
import { HausIdValue } from '../../components/ui/haus-id';
import { buildAction, type HassEntity as Entity } from '../../model';
import { binaryStateDescription } from '../../model/device-appearance';
import { deviceDisplayName } from '../../model/device-name';
import { formatTemperature } from '../../model/format-temperature';
import { numeric, strings, humanize } from './controls/control-values';
type Action = ReturnType<typeof buildAction>;
type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];
export function SecondaryEntity({
  entity,
  deviceName,
  hausId,
  disabled,
  onAction,
}: {
  entity: Entity;
  deviceName?: string;
  hausId?: string;
  disabled: boolean;
  onAction: (action: Action) => void;
}) {
  const domain = entity.entity_id.split('.')[0];
  const attrs = entity.attributes;
  const fallbackLabel = humanize(
    typeof attrs.device_class === 'string' && attrs.device_class
      ? attrs.device_class
      : entity.entity_id.split('.')[1],
  );
  const rawLabel = typeof attrs.friendly_name === 'string' ? attrs.friendly_name : fallbackLabel;
  const label = deviceName ? deviceDisplayName(rawLabel, deviceName, fallbackLabel) : rawLabel;
  const initialDraft = ['unavailable', 'unknown'].includes(entity.state) ? '' : entity.state;
  const [draft, setDraft] = useState(initialDraft);
  useEffect(() => {
    setDraft(initialDraft);
  }, [initialDraft]);
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
    <Box className="haus-secondary-entity">
      <Box>
        <Text>{label}</Text>
        {hausId && (
          <Text semantic="small" className="haus-id-inline">
            <HausIdValue value={hausId} label="Haus entity ID" />
          </Text>
        )}
        <Text semantic="small">{entity.entity_id}</Text>
      </Box>
      {['light', 'switch', 'input_boolean'].includes(domain) ? (
        <HausSwitch
          isSelected={entity.state === 'on'}
          isDisabled={disabled}
          aria-label={
            typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
          }
          onChange={() => act('toggle')}
        />
      ) : ['button', 'input_button'].includes(domain) ? (
        <HausButton
          size="sm"
          variant="secondary"
          isDisabled={disabled}
          onPress={() => act('press')}
        >
          Run
        </HausButton>
      ) : ['select', 'input_select'].includes(domain) ? (
        <SelectInput
          ariaLabel={
            typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
          }
          disabled={disabled}
          value={entity.state}
          options={strings(attrs.options).map((option) => ({ value: option, label: option }))}
          onChange={(next) => act('select', next)}
        />
      ) : ['number', 'input_number'].includes(domain) ? (
        <HausForm
          onSubmit={() => {
            const next = Number(draft);
            if (Number.isFinite(next)) act('value', next);
          }}
        >
          <TextInput
            inputType="number"
            ariaLabel={
              typeof attrs.friendly_name === 'string' ? attrs.friendly_name : entity.entity_id
            }
            value={draft}
            min={numeric(attrs.min, 0)}
            max={numeric(attrs.max, 100)}
            step={numeric(attrs.step, 1)}
            disabled={disabled}
            onChange={setDraft}
          />
          <HausButton type="submit" size="sm" variant="secondary" isDisabled={disabled}>
            Set
          </HausButton>
        </HausForm>
      ) : (
        <Text semantic="bold">
          {entity.attributes.device_class === 'temperature'
            ? (formatTemperature(entity.state, entity.attributes.suggested_display_precision) ??
              humanize(entity.state))
            : (binaryStateDescription(entity) ?? humanize(entity.state))}{' '}
          {typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : ''}
        </Text>
      )}
      {localError && (
        <Text semantic="p" role="alert" className="haus-inline-error">
          {localError}
        </Text>
      )}
    </Box>
  );
}
