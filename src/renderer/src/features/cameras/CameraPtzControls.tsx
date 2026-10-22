import { Button } from '@heroui/react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleStop,
  Home,
  Move,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAction, type HassEntity } from '../../model';
import type { Action } from '../../hooks/useHaus';
import { cameraPtzButtons } from './ptz-controls';

export function CameraPtzControls({
  entities,
  onAction,
  onError,
}: {
  entities: HassEntity[];
  onAction: (action: Action) => Promise<void>;
  onError: (reason: unknown) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const controls = useMemo(() => cameraPtzButtons(entities), [entities]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (!controls) return null;

  const press = (entity: HassEntity | undefined) => {
    if (!entity || entity.state === 'unavailable') return;
    void onAction(buildAction(entity, 'press')).catch(onError);
  };
  const control = (
    entity: HassEntity | undefined,
    label: string,
    icon: ReactNode,
    className = '',
  ) => (
    <Button
      key={label}
      isIconOnly
      variant="ghost"
      className={`camera-ptz-button ${className}`}
      aria-label={label}
      isDisabled={!entity || entity.state === 'unavailable'}
      onPress={() => press(entity)}
    >
      {icon}
    </Button>
  );

  return (
    <div className="camera-ptz" ref={root}>
      <Button
        isIconOnly
        variant="ghost"
        className="camera-ptz-trigger"
        aria-label="Camera movement controls"
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
      >
        <Move size={19} />
      </Button>
      {open && (
        <section className="camera-ptz-panel" aria-label="Camera movement controls">
          <header>
            <span>Camera movement</span>
            {controls.home &&
              control(
                controls.home,
                'Return camera to home position',
                <Home size={16} />,
                'is-home',
              )}
          </header>
          <div className="camera-ptz-pad">
            <span />
            {control(controls.up, 'Tilt camera up', <ChevronUp size={21} />)}
            <span />
            {control(controls.left, 'Pan camera left', <ChevronLeft size={21} />)}
            {controls.stop ? (
              control(controls.stop, 'Stop camera movement', <CircleStop size={18} />, 'is-stop')
            ) : (
              <span className="camera-ptz-center" aria-hidden="true">
                <Move size={17} />
              </span>
            )}
            {control(controls.right, 'Pan camera right', <ChevronRight size={21} />)}
            <span />
            {control(controls.down, 'Tilt camera down', <ChevronDown size={21} />)}
            <span />
          </div>
          {(controls.zoomOut || controls.zoomIn) && (
            <div className="camera-ptz-zoom">
              {controls.zoomOut && control(controls.zoomOut, 'Zoom out', <ZoomOut size={17} />)}
              {controls.zoomIn && control(controls.zoomIn, 'Zoom in', <ZoomIn size={17} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
