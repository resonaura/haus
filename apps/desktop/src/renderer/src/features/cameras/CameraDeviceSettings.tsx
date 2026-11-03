/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button, ScrollShadow } from '@heroui/react';
import { Eye, EyeOff } from 'lucide-react';
import { CameraParameter } from './CameraParameter';
import { MotionCaptureSettings } from './MotionCaptureSettings';
import { CameraHomeKitSettings } from './CameraHomeKitSettings';
import { CameraHaSettings } from './CameraHaSettings';
import { CameraOperatingSettings } from './CameraOperatingSettings';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { isSegmentEntity, type HassEntity, type HausAccessory } from '../../model';
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
  const relatedControls = [
    ...new Map(
      related
        .flatMap((accessory) => [
          ...(accessory.primaryEntityId === entity.entity_id ? [] : [accessory.state]),
          ...accessory.secondaryEntities,
        ])
        .filter((item) => {
          const domain = item.entity_id.split('.')[0];
          return (
            ['light', 'switch', 'input_boolean', 'select', 'number', 'button'].includes(domain) &&
            !operatingIds.has(item.entity_id) &&
            !isSegmentEntity(item)
          );
        })
        .map((item) => [item.entity_id, item]),
    ).values(),
  ];
  return (
    <aside className="camera-settings-drawer" aria-label="Camera settings">
      <h3>Camera settings</h3>
      <div className="camera-visibility">
        <Button variant="secondary" onPress={onToggleHomeVisibility}>
          {hiddenFromHome ? <Eye size={15} /> : <EyeOff size={15} />}
          {hiddenFromHome ? 'Show on Home' : 'Hide from Home view'}
        </Button>
        <Button variant="secondary" onPress={onToggleAppVisibility}>
          {hiddenFromApp ? <Eye size={15} /> : <EyeOff size={15} />}
          {hiddenFromApp ? 'Restore to app' : 'Hide from app'}
        </Button>
      </div>
      <MotionCaptureSettings cameraId={entity.entity_id} />
      <CameraOperatingSettings cameraId={entity.entity_id} />
      <CameraHomeKitSettings cameraId={entity.entity_id} />
      <CameraHaSettings />
      {relatedControls.length > 0 && (
        <section className="camera-related-section" aria-label="Other controls on this device">
          <h3>On this device</h3>
          <ScrollShadow
            className="camera-parameters-scroll"
            orientation="vertical"
            hideScrollBar
            size={24}
          >
            <div className="camera-parameters">
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
            </div>
          </ScrollShadow>
        </section>
      )}
    </aside>
  );
}
