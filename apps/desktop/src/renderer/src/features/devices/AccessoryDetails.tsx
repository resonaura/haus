/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Heading } from '@haus/ui';
import { HausIdCode, HausIdValue } from '../../components/ui/haus-id';
import {
  buildAction,
  resolveDeviceHausId,
  resolveEntityHausId,
  type HassEntity,
  type HausAccessory,
  type Snapshot,
} from '../../model';
import { SecondaryEntity } from './SecondaryEntity';

type Action = ReturnType<typeof buildAction>;

/** Renders canonical Haus identifiers, backend metadata, and secondary entities for an accessory. */
export function AccessoryDetails({
  accessory,
  entity,
  snapshot,
  stateLabel,
  pending,
  onSecondaryAction,
}: {
  accessory: HausAccessory;
  entity: HassEntity;
  snapshot: Snapshot;
  stateLabel: string;
  pending: boolean;
  onSecondaryAction: (action: Action) => void;
}) {
  const deviceHausId =
    accessory.hausId ??
    (() => {
      const device = accessory.deviceId
        ? snapshot.devices.find((item) => item.id === accessory.deviceId)
        : undefined;
      return device
        ? resolveDeviceHausId(device, snapshot, {
            category: accessory.category,
            primaryEntity: accessory.state,
            areaId: accessory.areaId,
          })
        : resolveEntityHausId(entity.entity_id, snapshot, {
            entity,
            category: accessory.category,
          });
    })();

  const entityHausId =
    accessory.entityHausIds?.[entity.entity_id] ??
    resolveEntityHausId(entity.entity_id, snapshot, {
      entity,
      deviceHausId,
      category: accessory.category,
    });

  return (
    <>
      <Box semantic="section" className="haus-entity-detail">
        <Heading level={3}>About this accessory</Heading>
        <Box semantic="dl">
          <Box>
            <Box semantic="dt">Haus ID</Box>
            <Box semantic="dd">
              <HausIdValue value={deviceHausId} label="Haus device ID" />
            </Box>
          </Box>
          <Box>
            <Box semantic="dt">Haus entity ID</Box>
            <Box semantic="dd">
              <HausIdValue value={entityHausId} label="Haus entity ID" />
            </Box>
          </Box>
          <Box>
            <Box semantic="dt">Entity</Box>
            <Box semantic="dd">
              <HausIdCode value={entity.entity_id} />
            </Box>
          </Box>
          {accessory.deviceId && (
            <Box>
              <Box semantic="dt">Device ID</Box>
              <Box semantic="dd">
                <HausIdCode value={accessory.deviceId} />
              </Box>
            </Box>
          )}
          <Box>
            <Box semantic="dt">State</Box>
            <Box semantic="dd">{stateLabel}</Box>
          </Box>
          <Box>
            <Box semantic="dt">Updated</Box>
            <Box semantic="dd">
              {entity.last_updated ? new Date(entity.last_updated).toLocaleString() : '—'}
            </Box>
          </Box>
        </Box>
      </Box>
      {accessory.secondaryEntities.length > 0 && (
        <Box semantic="section" className="haus-secondary-entities">
          <Heading level={3}>Related controls & diagnostics</Heading>
          {accessory.secondaryEntities.map((secondary) => {
            const secondaryHausId =
              accessory.entityHausIds?.[secondary.entity_id] ??
              resolveEntityHausId(secondary.entity_id, snapshot, {
                entity: secondary,
                deviceHausId,
                category: accessory.category,
              });
            return (
              <SecondaryEntity
                key={secondary.entity_id}
                entity={secondary}
                deviceName={accessory.name}
                hausId={secondaryHausId}
                disabled={
                  pending ||
                  secondary.state === 'unavailable' ||
                  (secondary.state === 'unknown' &&
                    !['button', 'input_button'].includes(secondary.entity_id.split('.')[0]))
                }
                onAction={onSecondaryAction}
              />
            );
          })}
        </Box>
      )}
    </>
  );
}
