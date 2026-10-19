import { useMemo, useState, type CSSProperties } from 'react';
import { Button } from '@heroui/react';
import { Check, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { normalizeHome, type Snapshot } from '../../model';
import { AccessoryIcon } from '../../components/icons/Icon';
import { deviceDisplayName } from '../../model/device-name';
import { deviceAppearance } from '../../model/device-appearance';
import {
  captureSceneTarget,
  sceneTargetSummary,
  targetConfig,
  type SceneTarget,
} from '../../model/scene-target';
import { SceneTargetControls } from './SceneTargetControls';
export function SceneTargets({
  entities,
  onChange,
  snapshot,
}: {
  entities: Record<string, any>;
  onChange: (entities: Record<string, any>) => void;
  snapshot: Snapshot;
}) {
  const [selected, setSelected] = useState(''),
    [adding, setAdding] = useState(false),
    [search, setSearch] = useState('');
  const model = useMemo(() => normalizeHome(snapshot), [snapshot]);
  const byId = useMemo(
    () => new Map(snapshot.states.map((entity) => [entity.entity_id, entity])),
    [snapshot.states],
  );
  const owners = useMemo(
    () =>
      new Map(
        model.accessories.flatMap((accessory) =>
          accessory.entityIds.map((id) => [id, accessory] as const),
        ),
      ),
    [model],
  );
  const rooms = useMemo(() => new Map(model.rooms.map((room) => [room.id, room.name])), [model]);
  const disabled = useMemo(
    () =>
      new Set(
        snapshot.entities.filter((entry) => entry.disabled_by).map((entry) => entry.entity_id),
      ),
    [snapshot.entities],
  );
  const owner = (id: string) => owners.get(id);
  const roomName = (id: string) => rooms.get(owner(id)?.areaId ?? '') ?? 'Other accessories';
  const name = (id: string) =>
    deviceDisplayName(String(byId.get(id)?.attributes.friendly_name ?? id), roomName(id));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const ids = Object.keys(entities).sort(
    (a, b) => collator.compare(roomName(a), roomName(b)) || collator.compare(name(a), name(b)),
  );
  const available = snapshot.states.filter(
    (item) =>
      /^(light|switch|climate|cover|media_player|fan|lock|input_boolean)\./.test(item.entity_id) &&
      !disabled.has(item.entity_id) &&
      `${name(item.entity_id)} ${roomName(item.entity_id)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const groups = [
    ...new Set((adding ? available.map((item) => item.entity_id) : ids).map(roomName)),
  ].sort(collator.compare);
  const remove = (id: string) => {
    const next = { ...entities };
    delete next[id];
    onChange(next);
    if (selected === id) setSelected('');
  };
  const toggle = (id: string) => {
    if (id in entities) remove(id);
    else {
      const entity = byId.get(id);
      if (entity) onChange({ ...entities, [id]: captureSceneTarget(entity) });
    }
  };
  const change = (id: string, value: SceneTarget) => onChange({ ...entities, [id]: value });
  return (
    <section className="scene-editor-accessories">
      <div className="scene-accessories-heading">
        <div>
          <h3>{adding ? 'Choose accessories' : 'Accessories'}</h3>
          <p>
            {adding
              ? 'Choose what this scene controls. Each selected accessory keeps its own setting.'
              : 'Choose a tile to set how it should look or behave.'}
          </p>
        </div>
        <Button
          variant="secondary"
          onPress={() => {
            setAdding(!adding);
            setSearch('');
          }}
        >
          {adding ? <Check size={16} /> : <Plus size={16} />}
          {adding ? 'Done' : 'Add or remove'}
        </Button>
      </div>
      {adding && (
        <label className="scene-accessory-search">
          <Search size={16} />
          <input
            aria-label="Find an accessory"
            placeholder="Search accessories or rooms"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      {!adding && !ids.length && (
        <div className="scene-accessories-empty">
          <SlidersHorizontal size={26} />
          <strong>What should this moment feel like?</strong>
          <p>Add lights and other accessories, then choose their settings.</p>
          <Button variant="secondary" onPress={() => setAdding(true)}>
            <Plus size={16} /> Add accessories
          </Button>
        </div>
      )}
      {groups.map((room) => (
        <div className="scene-editor-room" key={room}>
          <h4>{room}</h4>
          <div className="scene-target-grid">
            {(adding ? available.map((item) => item.entity_id) : ids)
              .filter((id) => roomName(id) === room)
              .map((id) => {
                const accessory = owner(id),
                  state = byId.get(id),
                  setting = targetConfig(entities[id]);
                const draft = state
                  ? {
                      ...state,
                      state: String(setting.state ?? state.state),
                      attributes: {
                        ...state.attributes,
                        ...setting,
                        color_mode:
                          setting.color_temp_kelvin || setting.color_temp
                            ? 'color_temp'
                            : setting.rgb_color
                              ? 'rgb'
                              : state.attributes.color_mode,
                      },
                    }
                  : undefined;
                const accent = draft ? deviceAppearance(draft).accent : 'var(--ink)';
                return (
                  <button
                    type="button"
                    key={id}
                    className="scene-target-tile"
                    aria-pressed={adding ? id in entities : selected === id}
                    data-included={id in entities || undefined}
                    style={{ '--scene-target-color': accent } as CSSProperties}
                    onClick={() => (adding ? toggle(id) : setSelected(selected === id ? '' : id))}
                  >
                    <span className="scene-target-icon">
                      {accessory ? (
                        <AccessoryIcon
                          accessory={
                            draft ? { ...accessory, primaryEntityId: id, state: draft } : accessory
                          }
                          size={24}
                        />
                      ) : (
                        <SlidersHorizontal size={24} />
                      )}
                    </span>
                    {adding && (
                      <span className="scene-target-selection">
                        {id in entities && <Check size={12} />}
                      </span>
                    )}
                    <strong>{name(id)}</strong>
                    <small>
                      {adding
                        ? id in entities
                          ? 'Included'
                          : 'Add to scene'
                        : sceneTargetSummary(id, entities[id])}
                    </small>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {adding && !available.length && <p className="editor-note">No matching accessories.</p>}
      {!adding && selected in entities && (
        <div className="scene-target-panel">
          <header>
            <h4>{name(selected)}</h4>
            <button
              type="button"
              aria-label="Close accessory settings"
              onClick={() => setSelected('')}
            >
              <X size={17} />
            </button>
          </header>
          <SceneTargetControls
            id={selected}
            entity={byId.get(selected)}
            value={targetConfig(entities[selected])}
            onChange={(next) => change(selected, next)}
            onRemove={() => remove(selected)}
          />
        </div>
      )}
    </section>
  );
}
