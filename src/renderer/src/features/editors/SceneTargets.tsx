import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Check, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { normalizeHome, type Snapshot } from '../../model';
import { deviceDisplayName } from '../../model/device-name';
import { captureSceneTarget, targetConfig, type SceneTarget } from '../../model/scene-target';
import { SceneTargetControls } from './SceneTargetControls';
import { SceneTargetTile } from './SceneTargetTile';
import { isScenePickerTarget } from '../../model/scene-picker';
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
  const registry = useMemo(
    () => new Map(snapshot.entities.map((entry) => [entry.entity_id, entry])),
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
      (item.entity_id in entities ||
        isScenePickerTarget(item, registry.get(item.entity_id), owner(item.entity_id))) &&
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
              .sort((a, b) => collator.compare(name(a), name(b)))
              .map((id) => (
                <SceneTargetTile
                  key={id}
                  id={id}
                  name={name(id)}
                  entity={byId.get(id)}
                  accessory={owner(id)}
                  setting={entities[id]}
                  adding={adding}
                  included={id in entities}
                  selected={selected === id}
                  onToggle={() => toggle(id)}
                  onOpenChange={(open) =>
                    setSelected((current) => (open ? id : current === id ? '' : current))
                  }
                >
                  {selected === id && (
                    <SceneTargetControls
                      id={id}
                      entity={byId.get(id)}
                      value={targetConfig(entities[id])}
                      onChange={(next) => change(id, next)}
                      onRemove={() => remove(id)}
                    />
                  )}
                </SceneTargetTile>
              ))}
          </div>
        </div>
      ))}
      {adding && !available.length && <p className="editor-note">No matching accessories.</p>}
    </section>
  );
}
