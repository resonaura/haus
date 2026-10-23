import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollShadow } from '@heroui/react';
import type { ContextMenuItem } from '../../../../shared/native';
import type { HassEntity } from '../../model';
import type { Preferences } from '../../model/preferences';
import {
  CAMERA_ORDER_SCOPE,
  cameraOrderPatch,
  moveCamera,
  orderCameras,
} from '../../model/camera-order';
import { ContextMenu } from '../../components/ui/ContextMenu';
import { triggerHaptic } from '../../components/ui/haptics';
import { CameraCard } from './CameraCard';
import { useCameraReorderPreview } from './useCameraReorderPreview';
import './styles/collection.scss';

type Drag = { id: string; over: string };
type Props = {
  cameras: HassEntity[];
  allCameraIds: string[];
  demo: boolean;
  paused: boolean;
  horizontal: boolean;
  homeOverview?: boolean;
  preferences: Preferences;
  savePreferences: (patch: Partial<Preferences>) => void;
  roomName: (camera: HassEntity) => string | undefined;
  homeHidden: (camera: HassEntity) => boolean;
  appHidden: (camera: HassEntity) => boolean;
  onOpen: (camera: HassEntity) => void;
  onToggleHome: (camera: HassEntity) => void;
  onToggleApp: (camera: HassEntity) => void;
  onError: (error: unknown) => void;
};

export function CameraCollection(props: Props) {
  const saved = props.preferences.deviceOrder?.[CAMERA_ORDER_SCOPE];
  const ordered = useMemo(() => orderCameras(props.cameras, saved), [props.cameras, saved]);
  const ids = ordered.map((camera) => camera.entity_id);
  const [drag, setDrag] = useState<Drag | null>(null);
  const currentDrag = useRef(drag);
  currentDrag.current = drag;
  const preview = drag ? moveCamera(ids, drag.id, drag.over) : ids;
  const byId = new Map(ordered.map((camera) => [camera.entity_id, camera]));
  const nodes = useCameraReorderPreview(preview.join('\0'));
  const suppressOpen = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  const [menu, setMenu] = useState<{
    camera: HassEntity;
    items: ContextMenuItem[];
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, []);
  const commit = (next: string[], camera: HassEntity) => {
    props.savePreferences({
      deviceOrder: {
        ...props.preferences.deviceOrder,
        [CAMERA_ORDER_SCOPE]: cameraOrderPatch(saved, props.allCameraIds, next),
      },
    });
    const name = String(camera.attributes.friendly_name ?? 'Camera');
    setAnnouncement(
      `${name} moved to position ${next.indexOf(camera.entity_id) + 1} of ${next.length}.`,
    );
  };
  const move = (camera: HassEntity, direction: number) => {
    const index = ids.indexOf(camera.entity_id),
      target = ids[index + direction];
    if (target) commit(moveCamera(ids, camera.entity_id, target), camera);
  };
  const action = (id: string, camera: HassEntity) => {
    setMenu(null);
    if (id === 'details') props.onOpen(camera);
    if (id === 'toggle-home') props.onToggleHome(camera);
    if (id === 'hide-app') props.onToggleApp(camera);
    if (id === 'earlier') move(camera, -1);
    if (id === 'later') move(camera, 1);
  };
  const showMenu = async (camera: HassEntity, x: number, y: number) => {
    const index = ids.indexOf(camera.entity_id);
    const items: ContextMenuItem[] = [
      { id: 'details', label: 'Camera Details…' },
      { id: 'earlier', label: 'Move Earlier', enabled: index > 0 },
      { id: 'later', label: 'Move Later', enabled: index < ids.length - 1 },
      { id: 'separator', label: '', type: 'separator' },
      {
        id: 'toggle-home',
        label: props.homeHidden(camera) ? 'Show on Home View' : 'Hide from Home View',
      },
      { id: 'hide-app', label: props.appHidden(camera) ? 'Restore to Haus' : 'Hide from Haus' },
    ];
    if (window.hausNative?.showContextMenu) {
      try {
        const selected = await window.hausNative.showContextMenu(items);
        if (selected) action(selected, camera);
      } catch (error) {
        props.onError(error);
      }
    } else
      setMenu({
        camera,
        items,
        x: Math.max(10, Math.min(x, window.innerWidth - 220)),
        y: Math.max(10, Math.min(y, window.innerHeight - 230)),
      });
  };
  const cards = (
    <div
      className={
        props.homeOverview
          ? 'accessory-grid home-device-grid camera-collection is-home'
          : `camera-grid camera-collection ${props.horizontal ? 'camera-rail' : ''}`
      }
      role="list"
      aria-label="Cameras"
    >
      {preview.map((id, index) => {
        const camera = byId.get(id)!;
        return (
          <div
            key={id}
            ref={(node) => {
              if (node) nodes.current.set(id, node);
              else nodes.current.delete(id);
            }}
            className={`camera-collection-item ${drag?.id === id ? 'is-dragging' : ''}`}
            role="listitem"
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-haus-camera', id);
              event.dataTransfer.effectAllowed = 'move';
              const bounds = event.currentTarget.getBoundingClientRect();
              event.dataTransfer.setDragImage(
                event.currentTarget,
                bounds.width / 2,
                bounds.height / 2,
              );
              currentDrag.current = { id, over: id };
              setDrag({ id, over: id });
            }}
            onDragOver={(event) => {
              if (!currentDrag.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (currentDrag.current.id !== id && currentDrag.current.over !== id) {
                triggerHaptic('alignment');
                currentDrag.current = { id: currentDrag.current.id, over: id };
                setDrag({ id: currentDrag.current.id, over: id });
              }
            }}
            onDragEnd={() => {
              currentDrag.current = null;
              setDrag(null);
            }}
            onDrop={(event) => {
              const active = currentDrag.current;
              if (!active || event.dataTransfer.getData('application/x-haus-camera') !== active.id)
                return;
              event.preventDefault();
              const source = byId.get(active.id);
              if (source && active.id !== active.over)
                commit(moveCamera(ids, active.id, active.over), source);
              suppressOpen.current = performance.now() + 200;
              currentDrag.current = null;
              setDrag(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void showMenu(camera, event.clientX, event.clientY);
            }}
            onKeyDown={(event) => {
              if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                move(camera, event.key === 'ArrowLeft' ? -1 : 1);
              }
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                void showMenu(camera, bounds.left + 12, bounds.top + 12);
              }
            }}
          >
            <CameraCard
              entity={camera}
              demo={props.demo}
              index={index}
              paused={props.paused}
              room={props.roomName(camera)}
              onOpen={() => {
                if (performance.now() >= suppressOpen.current) props.onOpen(camera);
              }}
            />
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      {props.horizontal && !props.homeOverview ? (
        <ScrollShadow
          isEnabled={!props.paused}
          className="camera-scroll"
          orientation="horizontal"
          hideScrollBar
          size={36}
        >
          {cards}
        </ScrollShadow>
      ) : (
        cards
      )}
      <span className="camera-order-announcement" role="status">
        {announcement}
      </span>
      {menu && (
        <ContextMenu
          items={menu.items}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onAction={(id) => action(id, menu.camera)}
        />
      )}
    </>
  );
}
