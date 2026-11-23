/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausSwitch, Text } from '@haus/ui';
import { buildAction, type HassEntity } from '../../model';
import { lightProfile } from '../../model/light-profile';
import { deviceAppearance } from '../../model/device-appearance';
import { LightColour } from '../devices/controls/LightColour';
import { ControlRange } from '../devices/controls/ControlRange';
import { numeric } from '../devices/controls/control-values';
import { SecondaryEntity } from '../devices/SecondaryEntity';

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
      <Box
        semantic="section"
        className="camera-light-parameter"
        surfaceTokens={{ '--device-color': deviceAppearance(entity).accent }}
      >
        <Box semantic="header">
          <Text semantic="strong">{label}</Text>
          <HausSwitch
            className="haus-color-switch"
            isSelected={entity.state === 'on'}
            aria-label={label}
            isDisabled={disabled}
            onChange={() => act('toggle')}
          />
        </Box>
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
      </Box>
    );
  }
  if (['number', 'input_number'].includes(domain)) {
    const unknown = ['unavailable', 'unknown'].includes(entity.state);
    return (
      <Box semantic="section" className="camera-number-parameter">
        <ControlRange
          label={label}
          min={numeric(entity.attributes.min, 0)}
          max={numeric(entity.attributes.max, 100)}
          step={numeric(entity.attributes.step, 1)}
          value={numeric(entity.state, numeric(entity.attributes.min, 0))}
          unit={String(entity.attributes.unit_of_measurement ?? '')}
          disabled={disabled}
          unknown={unknown}
          onCommit={(value) => onAction(buildAction(entity, 'value', value))}
        />
      </Box>
    );
  }
  return <SecondaryEntity entity={entity} disabled={disabled} onAction={onAction} />;
}
