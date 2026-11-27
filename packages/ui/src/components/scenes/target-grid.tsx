/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  captureSceneTarget,
  missingSceneTargetName,
  replaceSceneEntity,
  toggleSceneTargetState,
  type SceneEntityLike,
  type SceneTarget,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import { SceneTargetInspector, type SceneReplacementOption } from './target-inspector.js';
import {
  SceneMissingTile,
  ScenePresentTile,
  type SceneControllableDevice,
} from './target-tiles.js';

export type { SceneControllableDevice };

export function SceneTargetGrid({
  entities,
  devices,
  columns = 3,
  compactHeader = false,
  emptyTitle = 'What should this moment feel like?',
  emptySubtitle = 'Add lights, climate, covers, locks, or media accessories, then tap any card to fine-tune how it behaves.',
  removeLabel = 'Remove from scene',
  onChange,
}: {
  readonly entities: Record<string, unknown>;
  readonly devices: readonly SceneControllableDevice[];
  readonly columns?: number;
  readonly compactHeader?: boolean;
  readonly emptyTitle?: string;
  readonly emptySubtitle?: string;
  readonly removeLabel?: string;
  readonly onChange: (entities: Record<string, unknown>) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');

  const byId = useMemo(
    () => new Map(devices.map((item) => [item.entityId, item])),
    [devices],
  );
  const collator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
    [],
  );

  const query = search.trim().toLowerCase();
  const includedIds = Object.keys(entities);

  const missingIds = useMemo(
    () =>
      includedIds
        .filter((id) => !byId.has(id))
        .filter(
          (id) =>
            !adding ||
            !query ||
            `${missingSceneTargetName(id)} ${id} unavailable`.toLowerCase().includes(query),
        )
        .sort((a, b) => collator.compare(missingSceneTargetName(a), missingSceneTargetName(b))),
    [adding, byId, collator, includedIds, query],
  );

  const availableRooms = useMemo(() => {
    const names = new Set<string>();
    for (const dev of devices) {
      if (dev.pickerEligible || dev.entityId in entities) names.add(dev.roomName);
    }
    return [...names].sort(collator.compare);
  }, [collator, devices, entities]);

  const visibleDevices = useMemo(() => {
    const source = adding
      ? devices.filter((dev) => dev.entityId in entities || dev.pickerEligible)
      : devices.filter((dev) => dev.entityId in entities);
    return source
      .filter((dev) => {
        if (adding && roomFilter !== 'all' && dev.roomName !== roomFilter) return false;
        if (!query) return true;
        return `${dev.name} ${dev.roomName} ${dev.entityId}`.toLowerCase().includes(query);
      })
      .sort(
        (a, b) =>
          collator.compare(a.roomName, b.roomName) || collator.compare(a.name, b.name),
      );
  }, [adding, collator, devices, entities, query, roomFilter]);

  const groupedRooms = useMemo(() => {
    const map = new Map<string, SceneControllableDevice[]>();
    for (const dev of visibleDevices) {
      const list = map.get(dev.roomName) ?? [];
      list.push(dev);
      map.set(dev.roomName, list);
    }
    return [...map.entries()];
  }, [visibleDevices]);

  const replacementCandidates = useMemo<SceneReplacementOption[]>(
    () =>
      devices
        .filter((dev) => !(dev.entityId in entities) && dev.pickerEligible)
        .map((dev) => ({
          id: dev.entityId,
          name: dev.name,
          roomName: dev.roomName,
          domain: dev.entityId.split('.')[0] ?? 'other',
          category: dev.category,
          iconName: dev.iconName,
          entity: dev.entity,
        })),
    [devices, entities],
  );

  const removeTarget = (id: string) => {
    const next = { ...entities };
    delete next[id];
    onChange(next);
    if (selectedId === id) setSelectedId('');
  };

  const toggleInclude = (id: string) => {
    if (id in entities) {
      removeTarget(id);
      return;
    }
    const dev = byId.get(id);
    if (dev) onChange({ ...entities, [id]: captureSceneTarget(dev.entity) });
  };

  const updateTarget = (id: string, nextValue: SceneTarget) => {
    onChange({ ...entities, [id]: nextValue });
  };

  const quickToggle = (id: string) => {
    const dev = byId.get(id);
    if (!dev) return;
    updateTarget(id, toggleSceneTargetState(id, dev.entity, entities[id]));
  };

  const replaceMissing = (oldId: string, target: SceneEntityLike) => {
    onChange(replaceSceneEntity(entities, oldId, target));
    setSelectedId(target.entity_id);
  };

  const selectedDevice = selectedId ? byId.get(selectedId) : undefined;
  const showMissingInspector =
    !adding && Boolean(selectedId) && !selectedDevice && selectedId in entities;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={12} wrap>
        <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(180) } }}>
          <Heading level={3} size={compactHeader ? 13 : 14.5} weight={600}>
            {adding ? 'Choose accessories' : `Accessories (${includedIds.length})`}
          </Heading>
          {!compactHeader && (
            <Text size={11.5} tone="muted">
              {adding
                ? 'Tap cards to include or remove them. Each included accessory keeps its own target setting.'
                : 'Tap an icon to toggle power, or tap a card to adjust brightness, colour, or temperature.'}
            </Text>
          )}
        </Stack>
        <HausButton
          id="scene-toggle-picker"
          variant={adding ? 'primary' : 'secondary'}
          size="sm"
          onPress={() => {
            setAdding(!adding);
            setSelectedId('');
            setSearch('');
            setRoomFilter('all');
          }}
        >
          <UiIcon
            name={adding ? 'check' : 'plus'}
            size={14}
            color={adding ? '#101010' : undefined}
          />
          <Text
            size={12}
            style={
              adding
                ? { typography: { color: colorToken('accentForeground'), weight: 600 } }
                : undefined
            }
          >
            {adding ? 'Done choosing' : includedIds.length > 0 ? 'Add or remove' : 'Add accessories'}
          </Text>
        </HausButton>
      </Row>

      {adding && (
        <Stack gapPx={8}>
          <Row
            align="center"
            gapPx={8}
            style={{
              layout: { width: pct(100), minHeight: px(36), padding: insets(0, 12) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(11),
            }}
          >
            <UiIcon name="search" size={15} />
            <TextInput
              id="config-editor-accessory-search"
              ariaLabel="Search accessories"
              placeholder="Search accessories or rooms…"
              value={search}
              onChange={setSearch}
              style={{
                layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
                typography: { size: 12.5, color: colorToken('textPrimary') },
              }}
            />
          </Row>
          {availableRooms.length > 1 && (
            <Row gapPx={6} wrap>
              {['all', ...availableRooms].map((room) => {
                const active = roomFilter === room;
                return (
                  <Pressable
                    key={room}
                    ariaPressed={active}
                    onActivate={() => setRoomFilter(room)}
                    style={{
                      layout: { padding: insets(4, 10) },
                      material: new SolidMaterial(
                        active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                      ),
                      border: {
                        width: 1,
                        color: active ? colorToken('accent') : colorToken('border'),
                      },
                      corners: corners(999, 'round'),
                    }}
                  >
                    <Text size={11.5} weight={active ? 600 : 500}>
                      {room === 'all' ? 'All rooms' : room}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          )}
        </Stack>
      )}

      {!adding && includedIds.length === 0 && (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(26, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <UiIcon name="sliders-horizontal" size={24} />
          <Text size={13.5} weight={600}>
            {emptyTitle}
          </Text>
          <Text size={12} tone="muted" style={{ typography: { align: 'center', lineHeight: 1.45 } }}>
            {emptySubtitle}
          </Text>
          <HausButton variant="secondary" size="sm" onPress={() => setAdding(true)}>
            <UiIcon name="plus" size={14} />
            <Text size={12}>Choose accessories</Text>
          </HausButton>
        </Stack>
      )}

      {missingIds.length > 0 && (
        <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
          <Row align="center" gapPx={6}>
            <UiIcon name="alert-circle" size={14} color="#f59e0b" />
            <Heading level={4} size={12.5} weight={600}>
              Unavailable
            </Heading>
          </Row>
          <Text size={11.5} tone="muted">
            {adding
              ? 'These accessories are no longer in your home. Tap to remove them.'
              : 'Select an unavailable card to replace it with another accessory or remove it.'}
          </Text>
          <DashboardGrid columns={columns}>
            {missingIds.map((id) => (
              <SceneMissingTile
                key={id}
                id={id}
                setting={entities[id]}
                adding={adding}
                selected={!adding && selectedId === id}
                onRemove={() => removeTarget(id)}
                onSelectToggle={() => setSelectedId(selectedId === id ? '' : id)}
              />
            ))}
          </DashboardGrid>
          {showMissingInspector && (
            <SceneTargetInspector
              id={selectedId}
              name={missingSceneTargetName(selectedId)}
              roomName="Unavailable"
              value={entities[selectedId]}
              replacementCandidates={replacementCandidates}
              removeLabel={removeLabel}
              onChange={(next) => updateTarget(selectedId, next)}
              onReplace={(target) => replaceMissing(selectedId, target)}
              onRemove={() => removeTarget(selectedId)}
              onClose={() => setSelectedId('')}
            />
          )}
        </Stack>
      )}

      {groupedRooms.map(([roomName, items]) => {
        const inspectedInRoom =
          !adding && selectedDevice && selectedDevice.roomName === roomName
            ? selectedDevice
            : undefined;
        return (
          <Stack key={roomName} gapPx={8} style={{ layout: { width: pct(100) } }}>
            <Heading level={4} size={12.5} weight={600} tone="muted">
              {roomName}
            </Heading>
            <DashboardGrid columns={columns}>
              {items.map((dev) => (
                <ScenePresentTile
                  key={dev.entityId}
                  device={dev}
                  setting={entities[dev.entityId]}
                  included={dev.entityId in entities}
                  adding={adding}
                  selected={!adding && selectedId === dev.entityId}
                  onToggleInclude={() => toggleInclude(dev.entityId)}
                  onQuickToggle={() => quickToggle(dev.entityId)}
                  onSelectToggle={() =>
                    setSelectedId(selectedId === dev.entityId ? '' : dev.entityId)
                  }
                />
              ))}
            </DashboardGrid>
            {inspectedInRoom && inspectedInRoom.entityId in entities && (
              <SceneTargetInspector
                id={inspectedInRoom.entityId}
                name={inspectedInRoom.name}
                roomName={inspectedInRoom.roomName}
                entity={inspectedInRoom.entity}
                value={entities[inspectedInRoom.entityId]}
                replacementCandidates={replacementCandidates}
                removeLabel={removeLabel}
                onChange={(next) => updateTarget(inspectedInRoom.entityId, next)}
                onRemove={() => removeTarget(inspectedInRoom.entityId)}
                onClose={() => setSelectedId('')}
              />
            )}
          </Stack>
        );
      })}

      {adding && visibleDevices.length === 0 && missingIds.length === 0 && (
        <Text size={12} tone="muted">
          No matching accessories in your home.
        </Text>
      )}
    </Stack>
  );
}
