/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Check, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { normalizeHome, type HassEntity, type Snapshot } from '../../model';
import { accessoryDisplayName } from '../../model/accessory-name';
import { deviceDisplayName } from '../../model/device-name';
import { captureSceneTarget, targetConfig, type SceneTarget } from '../../model/scene-target';
import { isScenePickerTarget } from '../../model/scene-picker';
import { SceneTargetControls } from './SceneTargetControls';
import { SceneTargetTile } from './SceneTargetTile';
import type { SceneReplacementCandidate } from './SceneTargetReplace';
import {
  missingSceneTargetName,
  replaceSceneEntity,
  scenePreviewAccessory,
  toggleSceneTargetState,
} from './scene-target-helpers';

export function SceneTargets({
  entities,
  onChange,
  snapshot,
}: {
  entities: Record<string, unknown>;
  onChange: (entities: Record<string, unknown>) => void;
  snapshot: Snapshot;
}) {
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
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
  const name = (id: string) => {
    const entity = byId.get(id);
    if (!entity) return missingSceneTargetName(id);
    const acc = owner(id);
    const room = rooms.get(acc?.areaId ?? '');
    if (acc && acc.primaryEntityId === id) return accessoryDisplayName(acc, room);
    return deviceDisplayName(String(entity.attributes.friendly_name ?? id), roomName(id));
  };
  const collator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
    [],
  );

  const query = search.trim().toLowerCase();
  const allEntityIds = Object.keys(entities);
  const missingIds = allEntityIds
    .filter((id) => !byId.has(id))
    .filter(
      (id) => !adding || !query || `${name(id)} ${id} unavailable`.toLowerCase().includes(query),
    )
    .sort((a, b) => collator.compare(name(a), name(b)));
  const presentIds = allEntityIds
    .filter((id) => byId.has(id))
    .sort(
      (a, b) => collator.compare(roomName(a), roomName(b)) || collator.compare(name(a), name(b)),
    );
  const available = snapshot.states.filter(
    (item) =>
      (item.entity_id in entities ||
        isScenePickerTarget(item, registry.get(item.entity_id), owner(item.entity_id))) &&
      (!query ||
        `${name(item.entity_id)} ${roomName(item.entity_id)}`.toLowerCase().includes(query)),
  );
  const visiblePresentIds = adding ? available.map((item) => item.entity_id) : presentIds;
  const groups = [...new Set(visiblePresentIds.map(roomName))].sort(collator.compare);

  const replacementCandidates = useMemo<SceneReplacementCandidate[]>(
    () =>
      snapshot.states
        .filter(
          (item) =>
            !(item.entity_id in entities) &&
            isScenePickerTarget(item, registry.get(item.entity_id), owner(item.entity_id)),
        )
        .map((entity) => {
          const acc = owner(entity.entity_id);
          const room = rooms.get(acc?.areaId ?? '') ?? 'Other accessories';
          return {
            id: entity.entity_id,
            name: name(entity.entity_id),
            room,
            domain: entity.entity_id.split('.')[0],
            entity,
            accessory: scenePreviewAccessory(entity.entity_id, entity, acc, undefined, false),
          };
        }),
    [snapshot.states, entities, registry, owners, rooms],
  );

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
  const quickToggle = (id: string) => {
    const entity = byId.get(id);
    if (!entity) return;
    change(id, toggleSceneTargetState(id, entity, entities[id]));
  };
  const replace = (oldId: string, target: HassEntity) => {
    onChange(replaceSceneEntity(entities, oldId, target));
    setSelected(target.entity_id);
  };

  const renderTile = (id: string) => {
    const entity = byId.get(id);
    const acc = owner(id);
    const room = rooms.get(acc?.areaId ?? '') ?? 'Other';
    return (
      <SceneTargetTile
        key={id}
        id={id}
        name={name(id)}
        room={room}
        entity={entity}
        accessory={acc}
        setting={entities[id]}
        adding={adding}
        included={id in entities}
        selected={selected === id}
        onToggle={() => toggle(id)}
        onQuickToggle={() => quickToggle(id)}
        onOpenChange={(open) =>
          setSelected((current) => (open ? id : current === id ? '' : current))
        }
      >
        {/* Popover mounts these only while open/exiting; retain its closing geometry. */}
        <SceneTargetControls
          id={id}
          entity={entity}
          value={targetConfig(entities[id])}
          candidates={replacementCandidates}
          onChange={(next) => change(id, next)}
          onReplace={(target) => replace(id, target)}
          onRemove={() => remove(id)}
        />
      </SceneTargetTile>
    );
  };

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
            setSelected('');
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
      {!adding && !allEntityIds.length && (
        <div className="scene-accessories-empty">
          <SlidersHorizontal size={26} />
          <strong>What should this moment feel like?</strong>
          <p>Add lights and other accessories, then choose their settings.</p>
          <Button variant="secondary" onPress={() => setAdding(true)}>
            <Plus size={16} /> Add accessories
          </Button>
        </div>
      )}
      {missingIds.length > 0 && (
        <div className="scene-editor-room scene-unavailable-group">
          <h4>Unavailable</h4>
          <p className="scene-unavailable-hint">
            {adding
              ? 'These accessories no longer exist in your home. Deselect to remove them.'
              : 'These accessories no longer exist in your home. Select a card to replace it with another device or remove it.'}
          </p>
          <div className="accessory-grid scene-target-grid">{missingIds.map(renderTile)}</div>
        </div>
      )}
      {groups.map((room) => (
        <div className="scene-editor-room" key={room}>
          <h4>{room}</h4>
          <div className="accessory-grid scene-target-grid">
            {visiblePresentIds
              .filter((id) => roomName(id) === room)
              .sort((a, b) => collator.compare(name(a), name(b)))
              .map(renderTile)}
          </div>
        </div>
      ))}
      {adding && !available.length && !missingIds.length && (
        <p className="editor-note">No matching accessories.</p>
      )}
    </section>
  );
}
