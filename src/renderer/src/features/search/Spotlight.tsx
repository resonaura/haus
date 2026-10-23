import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronRight, House, Lightbulb, Search, Shield, Tv, X, Zap } from 'lucide-react';
import type { HausAccessory, HausModel, HassEntity } from '../../model/types';
import { deviceDisplayName } from '../../model/device-name';
import { scenePresentation } from '../../model/scene-presentation';

export interface SpotlightAction {
  id: string;
  title: string;
  subtitle: string;
  keywords?: string;
  icon: ReactNode;
  onAction: () => void;
}

interface CategoryItem {
  id: string;
  name: string;
}
type Result = {
  id: string;
  title: string;
  subtitle: string;
  kind: 'device' | 'camera' | 'room' | 'category' | 'scene' | 'action';
  icon: ReactNode;
  accessory?: HausAccessory;
  entity?: HassEntity;
  routeId?: string;
  action?: SpotlightAction;
  section?: string;
};

interface SpotlightProps {
  isOpen?: boolean;
  scope?: string;
  favorites?: string[];
  actions?: SpotlightAction[];
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
}

/** Retain the surface through exit; release its focus trap before a next dialog. */
export function Spotlight({ isOpen = true, ...props }: SpotlightProps) {
  const [present, setPresent] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setPresent(true);
      return;
    }
    const timer = setTimeout(() => setPresent(false), 180);
    return () => clearTimeout(timer);
  }, [isOpen]);
  return present ? <SpotlightContent {...props} exiting={!isOpen} /> : null;
}

function readRecent(scope: string): string[] {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(`haus:spotlight:${scope}`) ?? '[]');
    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function SpotlightContent({
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
  scope = 'session',
  favorites = [],
  actions = [],
  exiting,
}: SpotlightProps & { exiting: boolean }) {
  const panel = useRef<HTMLElement>(null);
  useFocusTrap(panel, !exiting);
  const [recent] = useState(() => readRecent(scope));
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
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
    for (const action of actions) {
      if (
        `${action.title} ${action.subtitle} ${action.keywords ?? ''}`
          .toLocaleLowerCase()
          .includes(term)
      )
        matched.push({
          id: action.id,
          title: action.title,
          subtitle: action.subtitle,
          kind: 'action',
          icon: action.icon,
          action,
        });
    }
    if (term) return matched.slice(0, 16);
    const key = (item: Result) => `${item.kind}:${item.id}`;
    const recentItems = recent
      .flatMap((id) => {
        const item = matched.find((result) => key(result) === id);
        return item ? [{ ...item, section: 'Recent' }] : [];
      })
      .slice(0, 3);
    const used = new Set(recentItems.map(key));
    const suggestions = matched.filter((item) => !used.has(key(item)) && item.kind !== 'action');
    suggestions.sort((a, b) => {
      const favorite = (item: Result) =>
        favorites.includes(item.entity?.entity_id ?? '') ||
        item.accessory?.entityIds.some((id) => favorites.includes(id));
      return Number(Boolean(favorite(b))) - Number(Boolean(favorite(a)));
    });
    return [
      ...recentItems,
      ...suggestions.slice(0, 3).map((item) => ({ ...item, section: 'Suggestions' })),
      ...matched
        .filter((item) => item.kind === 'action' && !used.has(key(item)))
        .slice(0, 5)
        .map((item) => ({ ...item, section: 'Quick Actions' })),
    ];
  }, [query, accessories, cameras, categories, model, scenes, actions, favorites, recent]);
  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);
  useEffect(() => {
    panel.current
      ?.querySelector(`#spotlight-result-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);
  const activate = (result: Result) => {
    if (exiting) return;
    try {
      sessionStorage.setItem(
        `haus:spotlight:${scope}`,
        JSON.stringify(
          [
            `${result.kind}:${result.id}`,
            ...recent.filter((id) => id !== `${result.kind}:${result.id}`),
          ].slice(0, 8),
        ),
      );
    } catch {
      /* Private browsing may disable session storage. */
    }
    onClose();
    if (result.kind === 'device' && result.accessory) onOpenAccessory(result.accessory);
    else if (result.kind === 'camera') {
      if (result.entity) onOpenCamera(result.entity);
      else if (result.accessory) onOpenAccessory(result.accessory);
    } else if (result.kind === 'room' && result.routeId) onOpenRoom(result.routeId);
    else if (result.kind === 'category' && result.routeId) onOpenCategory(result.routeId);
    else if (result.kind === 'scene') onOpenScenes();
    else if (result.kind === 'action') result.action?.onAction();
  };
  // Keep the backdrop and panel as siblings. Nested backdrop-filter layers form
  // a backdrop root and prevent the panel from sampling the unfiltered page.
  return createPortal(
    <>
      <div
        className="spotlight-backdrop"
        data-state={exiting ? 'closing' : 'open'}
        aria-hidden="true"
        onMouseDown={() => {
          if (!exiting) onClose();
        }}
      />
      <section
        ref={panel}
        tabIndex={-1}
        className="spotlight-panel"
        data-state={exiting ? 'closing' : 'open'}
        data-spotlight
        role="dialog"
        aria-modal="true"
        aria-label="Search your home"
      >
        <div className="spotlight-input-row">
          <Search size={20} aria-hidden="true" />
          <input
            className="spotlight-input"
            type="text"
            role="combobox"
            aria-label="Search your home"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls="spotlight-results"
            aria-activedescendant={
              results[activeIndex] ? `spotlight-result-${activeIndex}` : undefined
            }
            placeholder="Search your home or choose an action…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, Math.min(results.length - 1, index + 1)));
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
          {results.length ? (
            results.map((result, index) => (
              <div
                key={`${result.kind}:${result.id}`}
                className="spotlight-result-group"
                role="presentation"
              >
                {result.section && result.section !== results[index - 1]?.section && (
                  <div className="spotlight-section" role="presentation">
                    {result.section}
                  </div>
                )}
                <button
                  id={`spotlight-result-${index}`}
                  className={`spotlight-result ${index === activeIndex ? 'is-active' : ''}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => activate(result)}
                >
                  <span className="spotlight-result-icon">{result.icon}</span>
                  <span className="spotlight-result-copy">
                    <strong>{result.title}</strong>
                    <small>{result.subtitle}</small>
                  </span>
                  <ChevronRight size={15} className="spotlight-result-arrow" />
                </button>
              </div>
            ))
          ) : (
            <div className="spotlight-hint" key={query} aria-live="polite">
              No matches in your home.
            </div>
          )}
        </div>
        <footer className="spotlight-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>esc</kbd> Close
          </span>
        </footer>
      </section>
    </>,
    document.body,
  );
}

function iconForCategory(category: string) {
  if (category === 'lights') return <Lightbulb size={17} />;
  if (category === 'security') return <Shield size={17} />;
  if (category === 'media') return <Tv size={17} />;
  if (category === 'outlets') return <Zap size={17} />;
  return <House size={17} />;
}
