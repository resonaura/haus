/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

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
      <section className="haus-entity-detail">
        <h3>About this accessory</h3>
        <dl>
          <div>
            <dt>Haus ID</dt>
            <dd>
              <HausIdValue value={deviceHausId} label="Haus device ID" />
            </dd>
          </div>
          <div>
            <dt>Haus entity ID</dt>
            <dd>
              <HausIdValue value={entityHausId} label="Haus entity ID" />
            </dd>
          </div>
          <div>
            <dt>Entity</dt>
            <dd>
              <HausIdCode value={entity.entity_id} />
            </dd>
          </div>
          {accessory.deviceId && (
            <div>
              <dt>Device ID</dt>
              <dd>
                <HausIdCode value={accessory.deviceId} />
              </dd>
            </div>
          )}
          <div>
            <dt>State</dt>
            <dd>{stateLabel}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{entity.last_updated ? new Date(entity.last_updated).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      </section>
      {accessory.secondaryEntities.length > 0 && (
        <section className="haus-secondary-entities">
          <h3>Related controls & diagnostics</h3>
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
        </section>
      )}
    </>
  );
}
