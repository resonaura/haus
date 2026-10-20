import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { Check, SlidersHorizontal, X } from 'lucide-react';
import { AccessoryIcon } from '../../components/icons/Icon';
import type { HassEntity, HausAccessory } from '../../model';
import { deviceAppearance } from '../../model/device-appearance';
import { sceneTargetEntity, sceneTargetSummary } from '../../model/scene-target';

export function SceneTargetTile({
  id,
  name,
  entity,
  accessory,
  setting,
  adding,
  included,
  selected,
  onToggle,
  onOpenChange,
  children,
}: {
  id: string;
  name: string;
  entity?: HassEntity;
  accessory?: HausAccessory;
  setting: unknown;
  adding: boolean;
  included: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<'right' | 'bottom'>('bottom');
  useLayoutEffect(() => {
    if (!selected) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      setPlacement(
        rect && Math.max(rect.left, window.innerWidth - rect.right) >= 368 ? 'right' : 'bottom',
      );
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [selected]);
  const draft = entity ? sceneTargetEntity(entity, included ? setting : {}) : undefined;
  const appearance = draft && deviceAppearance(draft);
  const style = {
    '--scene-target-color': appearance?.active ? appearance.accent : 'var(--muted-ink)',
  } as CSSProperties;
  const contents = (
    <>
      <span className="scene-target-icon">
        {accessory ? (
          <AccessoryIcon
            accessory={draft ? { ...accessory, primaryEntityId: id, state: draft } : accessory}
            size={24}
          />
        ) : (
          <SlidersHorizontal size={24} />
        )}
      </span>
      {adding && <span className="scene-target-selection">{included && <Check size={12} />}</span>}
      <strong>{name}</strong>
      <small>
        {adding ? (included ? 'Included' : 'Add to scene') : sceneTargetSummary(id, setting)}
      </small>
    </>
  );
  if (adding)
    return (
      <button
        type="button"
        className="scene-target-tile"
        aria-pressed={included}
        data-included={included || undefined}
        data-active={appearance?.active || undefined}
        style={style}
        onClick={onToggle}
      >
        {contents}
      </button>
    );
  return (
    <Popover isOpen={selected} onOpenChange={onOpenChange}>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="scene-target-tile"
        data-active={appearance?.active || undefined}
        style={style}
      >
        {contents}
      </Button>
      <Popover.Content className="scene-target-popover" placement={placement} offset={10}>
        <Popover.Dialog className="scene-target-panel">
          <header>
            <Popover.Heading>{name}</Popover.Heading>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Close accessory settings"
              onPress={() => onOpenChange(false)}
            >
              <X size={17} />
            </Button>
          </header>
          {children}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
