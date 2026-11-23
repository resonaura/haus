/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, HausScrollArea, Heading } from '@haus/ui';
import { Eye, EyeOff } from 'lucide-react';
import { CameraParameter } from './CameraParameter';
import { MotionCaptureSettings } from './MotionCaptureSettings';
import { CameraHomeKitSettings } from './CameraHomeKitSettings';
import { CameraOperatingSettings } from './CameraOperatingSettings';
import { cameraPtzButtonIds, isHiddenCameraControl } from './ptz-controls';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { HausIdProperties } from '../../components/ui/haus-id';
import {
  deriveDeviceHausAddress,
  deriveEndpointHausAddress,
  isSegmentEntity,
  type HassEntity,
  type HausAccessory,
} from '../../model';
import { deviceDisplayName } from '../../model/device-name';
import type { Action } from '../../hooks/useHaus';
export function CameraDeviceSettings({
  entity,
  related,
  hiddenFromHome,
  hiddenFromApp,
  onToggleHomeVisibility,
  onToggleAppVisibility,
  onAction,
  onError,
}: {
  entity: HassEntity;
  related: HausAccessory[];
  hiddenFromHome: boolean;
  hiddenFromApp: boolean;
  onToggleHomeVisibility: () => void;
  onToggleAppVisibility: () => void;
  onAction: (action: Action) => Promise<void>;
  onOpenRelated: (id: string) => void;
  onError: (reason: unknown) => void;
}) {
  const camera = useCameraSettings(entity.entity_id);
  const operatingIds = new Set(Object.values(camera?.operating ?? {}).map((control) => control.id));
  const relatedEntities = [
    ...new Map(
      related
        .flatMap((accessory) => [accessory.state, ...accessory.secondaryEntities])
        .map((item) => [item.entity_id, item]),
    ).values(),
  ];
  const ptzIds = cameraPtzButtonIds(relatedEntities);
  const relatedControls = [
    ...new Map(
      related
        .flatMap((accessory) => [
          ...(accessory.primaryEntityId === entity.entity_id ? [] : [accessory.state]),
          ...accessory.secondaryEntities,
        ])
        .filter((item) => {
          const domain = item.entity_id.split('.')[0];
          const role: unknown = item.attributes.haus_camera_role;
          const operating =
            (role === 'indicator' || role === 'nightVision') && camera?.operating?.[role];
          return (
            ['light', 'switch', 'input_boolean', 'select', 'number', 'button'].includes(domain) &&
            !operatingIds.has(item.entity_id) &&
            !ptzIds.has(item.entity_id) &&
            !isHiddenCameraControl(item) &&
            !operating &&
            !isSegmentEntity(item)
          );
        })
        .map((item) => [item.entity_id, item]),
    ).values(),
  ];
  const cameraAccessory = related.find(
    (item) =>
      item.primaryEntityId === entity.entity_id || item.entityIds.includes(entity.entity_id),
  );
  const cameraHausId =
    cameraAccessory?.hausId ??
    deriveDeviceHausAddress({
      category: 'camera',
      primaryDomain: 'camera',
      areaId: cameraAccessory?.areaId,
      deviceName: String(entity.attributes.friendly_name ?? entity.entity_id),
      deviceId: cameraAccessory?.deviceId ?? entity.entity_id,
    });
  const cameraEntityHausId =
    cameraAccessory?.entityHausIds?.[entity.entity_id] ??
    deriveEndpointHausAddress({
      domain: 'camera',
      category: 'camera',
      entityId: entity.entity_id,
      entityName:
        typeof entity.attributes.friendly_name === 'string'
          ? entity.attributes.friendly_name
          : undefined,
      deviceAddress: cameraHausId,
    });

  return (
    <Box semantic="aside" className="camera-settings-drawer" ariaLabel="Camera settings">
      <Heading level={3}>Camera settings</Heading>
      <MotionCaptureSettings cameraId={entity.entity_id} />
      <CameraOperatingSettings cameraId={entity.entity_id} />
      <CameraHomeKitSettings key={entity.entity_id} cameraId={entity.entity_id} />
      {relatedControls.length > 0 && (
        <Box
          semantic="section"
          className="camera-related-section"
          ariaLabel="Other controls on this device"
        >
          <Heading level={3}>On this device</Heading>
          <HausScrollArea
            className="camera-parameters-scroll"
            orientation="vertical"
            hideScrollBar
            size={24}
          >
            <Box className="camera-parameters">
              {relatedControls.map((item) => (
                <CameraParameter
                  key={item.entity_id}
                  entity={{
                    ...item,
                    attributes: {
                      ...item.attributes,
                      friendly_name: deviceDisplayName(
                        String(item.attributes.friendly_name ?? item.entity_id),
                        String(entity.attributes.friendly_name ?? ''),
                      ),
                    },
                  }}
                  onAction={(action) => void onAction(action).catch(onError)}
                />
              ))}
            </Box>
          </HausScrollArea>
        </Box>
      )}
      <Box className="camera-visibility">
        <HausButton variant="secondary" onPress={onToggleHomeVisibility}>
          {hiddenFromHome ? <Eye size={15} /> : <EyeOff size={15} />}
          {hiddenFromHome ? 'Show on Home' : 'Hide from Home view'}
        </HausButton>
        <HausButton variant="secondary" onPress={onToggleAppVisibility}>
          {hiddenFromApp ? <Eye size={15} /> : <EyeOff size={15} />}
          {hiddenFromApp ? 'Restore to app' : 'Hide from app'}
        </HausButton>
      </Box>
      <Box semantic="section" className="camera-identifiers" ariaLabel="Identifiers">
        <Heading level={3}>Identifiers</Heading>
        <HausIdProperties
          deviceHausId={cameraHausId}
          entityHausId={cameraEntityHausId}
          backendDeviceId={cameraAccessory?.deviceId}
          entityId={entity.entity_id}
        />
      </Box>
    </Box>
  );
}
