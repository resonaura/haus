import { Button, ScrollShadow } from '@heroui/react';
import { Eye, EyeOff } from 'lucide-react';
import { SecondaryEntity } from '../devices/SecondaryEntity';
import { buildAction, isSegmentEntity, type HassEntity, type HausAccessory } from '../../model';
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
  onOpenRelated,
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
  const relatedControls = related
    .flatMap((accessory) => [
      ...(accessory.primaryEntityId === entity.entity_id ? [] : [accessory.state]),
      ...accessory.secondaryEntities,
    ])
    .filter((item) => {
      const domain = item.entity_id.split('.')[0];
      return (
        ['light', 'switch', 'input_boolean', 'select', 'number', 'button'].includes(domain) &&
        !isSegmentEntity(item)
      );
    });
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
      {relatedControls.length > 0 && (
        <section className="camera-related-section" aria-label="Other controls on this device">
          <h3>On this device</h3>
          <ScrollShadow
            className="camera-related-scroll"
            orientation="horizontal"
            hideScrollBar
            size={18}
          >
            <div className="camera-related">
              {relatedControls
                .filter((control) => control.entity_id.startsWith('light.'))
                .map((control) => (
                  <div className="camera-related-item" key={control.entity_id}>
                    <Button
                      variant="secondary"
                      onPress={() =>
                        void onAction(buildAction(control, 'toggle')).catch((e) => onError(e))
                      }
                    >
                      {String(control.attributes.friendly_name ?? control.entity_id)} ·{' '}
                      {control.state}
                    </Button>
                    {control.entity_id.split('.')[0] === 'light' && (
                      <Button variant="ghost" onPress={() => onOpenRelated(control.entity_id)}>
                        Adjust
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          </ScrollShadow>
          <details className="camera-device-settings">
            <summary>
              Camera settings ·{' '}
              {relatedControls.filter((item) => !item.entity_id.startsWith('light.')).length}{' '}
              controls
            </summary>
            {relatedControls
              .filter((item) => !item.entity_id.startsWith('light.'))
              .map((item) => (
                <SecondaryEntity
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
                  disabled={
                    item.state === 'unavailable' ||
                    (item.state === 'unknown' && !item.entity_id.startsWith('button.'))
                  }
                  onAction={(action) => void onAction(action).catch((reason) => onError(reason))}
                />
              ))}
          </details>
        </section>
      )}
    </aside>
  );
}
