import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Camera, ChevronRight, House, Lightbulb, Search, Shield, Tv, X, Zap } from 'lucide-react';
import type { HausAccessory, HausModel, HassEntity } from '../model/types';
import { deviceDisplayName } from '../model/device-name';
import { scenePresentation } from '../model/scene-presentation';

interface CategoryItem {
  id: string;
  name: string;
}
type Result = {
  id: string;
  title: string;
  subtitle: string;
  kind: 'device' | 'camera' | 'room' | 'category' | 'scene';
  icon: ReactNode;
  accessory?: HausAccessory;
  entity?: HassEntity;
  routeId?: string;
};

export function Spotlight({
  query,
  model,
  categories,
  accessories,
  cameras,
  scenes,
  onQueryChange,
  onClose,
  onOpenAccessory,
  onOpenCamera,
  onOpenRoom,
  onOpenCategory,
  onOpenScenes,
}: {
  query: string;
  model: HausModel;
  categories: CategoryItem[];
  accessories: HausAccessory[];
  cameras: HassEntity[];
  scenes: HassEntity[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onOpenAccessory: (accessory: HausAccessory) => void;
  onOpenCamera: (camera: HassEntity) => void;
  onOpenRoom: (roomId: string) => void;
  onOpenCategory: (categoryId: string) => void;
  onOpenScenes: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return [];
    const matched: Result[] = [];
    for (const accessory of accessories) {
      const room = model.rooms.find((item) => item.id === accessory.areaId)?.name ?? 'Unassigned';
      const label = deviceDisplayName(accessory.name, room, accessory.name);
      if (
        `${label} ${room} ${accessory.manufacturer ?? ''} ${accessory.model ?? ''} ${accessory.primaryEntityId}`
          .toLocaleLowerCase()
          .includes(term)
      ) {
        matched.push({
          id: accessory.id,
          title: label,
          subtitle: `${room} · ${accessory.availability === 'available' ? accessory.state.state : accessory.availability}`,
          kind: accessory.primaryEntityId.startsWith('camera.') ? 'camera' : 'device',
          icon: accessory.primaryEntityId.startsWith('camera.') ? (
            <Camera size={17} />
          ) : (
            iconForCategory(accessory.category)
          ),
          accessory,
        });
      }
    }
    for (const camera of cameras) {
      const owner = model.accessories.find((item) => item.entityIds.includes(camera.entity_id));
      const room = model.rooms.find((item) => item.id === owner?.areaId)?.name ?? 'Unassigned';
      const label = String(camera.attributes.friendly_name ?? camera.entity_id);
      if (
        `${label} ${room} ${camera.entity_id}`.toLocaleLowerCase().includes(term) &&
        !matched.some(
          (item) =>
            item.entity?.entity_id === camera.entity_id ||
            item.accessory?.entityIds.includes(camera.entity_id),
        )
      ) {
        matched.push({
          id: camera.entity_id,
          title: label,
          subtitle: `${room} · Camera`,
          kind: 'camera',
          icon: <Camera size={17} />,
          entity: camera,
        });
      }
    }
    for (const room of model.rooms) {
      if (`${room.name} ${room.id}`.toLocaleLowerCase().includes(term)) {
        matched.push({
          id: room.id,
          title: room.name,
          subtitle: `${room.accessories.length} devices`,
          kind: 'room',
          icon: <House size={17} />,
          routeId: room.id,
        });
      }
    }
    for (const category of categories) {
      if (category.name.toLocaleLowerCase().includes(term)) {
        matched.push({
          id: category.id,
          title: category.name,
          subtitle: 'Device category',
          kind: 'category',
          icon: iconForCategory(category.id),
          routeId: category.id,
        });
      }
    }
    for (const scene of scenes) {
      const label = scenePresentation(scene).name;
      const room =
        model.rooms.find(
          (item) =>
            item.id ===
            model.scenePlacements.find((placement) => placement.sceneId === scene.entity_id)
              ?.areaId,
        )?.name ?? 'Home';
      if (`${label} ${room} ${scene.entity_id}`.toLocaleLowerCase().includes(term)) {
        matched.push({
          id: scene.entity_id,
          title: label,
          subtitle: `${room} · Scene`,
          kind: 'scene',
          icon: <Zap size={17} />,
          entity: scene,
        });
      }
    }
    return matched.slice(0, 12);
  }, [query, accessories, cameras, categories, model, scenes]);
  useEffect(() => setActiveIndex(0), [query]);
  const activate = (result: Result) => {
    onClose();
    if (result.kind === 'device' && result.accessory) onOpenAccessory(result.accessory);
    else if (result.kind === 'camera') {
      if (result.entity) onOpenCamera(result.entity);
      else if (result.accessory) onOpenAccessory(result.accessory);
    } else if (result.kind === 'room' && result.routeId) onOpenRoom(result.routeId);
    else if (result.kind === 'category' && result.routeId) onOpenCategory(result.routeId);
    else if (result.kind === 'scene') onOpenScenes();
  };
  return (
    <div
      className="spotlight-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="spotlight-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search your home"
      >
        <div className="spotlight-input-row">
          <Search size={20} aria-hidden="true" />
          <input
            autoFocus
            className="spotlight-input"
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="spotlight-results"
            aria-activedescendant={
              results[activeIndex] ? `spotlight-result-${activeIndex}` : undefined
            }
            placeholder="Search devices, rooms, scenes…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter' && results[activeIndex]) {
                event.preventDefault();
                activate(results[activeIndex]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>ESC</kbd>
          <button className="spotlight-close" aria-label="Close search" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div
          className="spotlight-results"
          id="spotlight-results"
          role="listbox"
          aria-label="Search results"
        >
          {!query.trim() ? (
            <div className="spotlight-hint">Search across devices, rooms, cameras, and scenes.</div>
          ) : results.length ? (
            results.map((result, index) => (
              <button
                key={`${result.kind}:${result.id}`}
                id={`spotlight-result-${index}`}
                className={`spotlight-result ${index === activeIndex ? 'is-active' : ''}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(result)}
              >
                <span className="spotlight-result-icon">{result.icon}</span>
                <span className="spotlight-result-copy">
                  <strong>{result.title}</strong>
                  <small>{result.subtitle}</small>
                </span>
                <ChevronRight size={15} className="spotlight-result-arrow" />
              </button>
            ))
          ) : (
            <div className="spotlight-hint">No matches in your home.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function iconForCategory(category: string) {
  if (category === 'lights') return <Lightbulb size={17} />;
  if (category === 'security') return <Shield size={17} />;
  if (category === 'media') return <Tv size={17} />;
  if (category === 'outlets') return <Zap size={17} />;
  return <House size={17} />;
}
