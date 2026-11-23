/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, type ReactNode } from 'react';
import { Box, HausButton, Heading, Pressable, Text } from '@haus/ui';
import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import { categoryIcons } from '../../components/icons/Icon';
import { accessoriesForCategory, categories } from '../../model/categories';
import { titleCase } from '../../model/presentation';
import type { Area, HausAccessory, Snapshot } from '../../model';
import type { RegistryController } from '../../ha/registry';
import { RoomAddDevicesDialog } from './RoomAddDevicesDialog';
import { RoomDelete } from './RoomDelete';
import { RoomEditor } from './RoomEditor';

export function RoomHeaderActions({
  roomId,
  snapshot,
  registry,
  notify,
  onDeleted,
}: {
  roomId: string;
  snapshot: Snapshot;
  registry: RegistryController;
  notify: (message: string) => void;
  onDeleted: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const area = snapshot.areas.find((item) => item.area_id === roomId);
  if (!snapshot.user.is_admin || roomId === 'unassigned' || !area) return null;

  return (
    <>
      <HausButton variant="secondary" onPress={() => setAdding(true)}>
        <Plus size={15} />
        <Text>Add devices</Text>
      </HausButton>
      <Pressable
        type="button"
        className="icon-button"
        ariaLabel={`Settings for ${area.name}`}
        title="Room settings"
        onPress={() => setEditing(true)}
      >
        <Pencil size={16} />
      </Pressable>
      <Pressable
        type="button"
        className="icon-button"
        ariaLabel={`Remove ${area.name}`}
        title="Remove room"
        onPress={() => setDeleting(true)}
      >
        <Trash2 size={16} />
      </Pressable>
      {adding && (
        <RoomAddDevicesDialog
          room={area}
          snapshot={snapshot}
          registry={registry}
          onClose={() => setAdding(false)}
          onAdded={(ids) =>
            notify(
              `${ids.length} ${ids.length === 1 ? 'device' : 'devices'} moved to ${area.name}.`,
            )
          }
        />
      )}
      {editing && (
        <RoomEditor
          room={area}
          areas={snapshot.areas}
          registry={registry}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            notify(`${saved.name} updated.`);
          }}
        />
      )}
      {deleting && (
        <RoomDelete
          room={area}
          snapshot={snapshot}
          registry={registry}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            notify('Room removed. Devices remain connected.');
            onDeleted();
          }}
        />
      )}
    </>
  );
}

export function RoomEmptyAction({
  roomId,
  snapshot,
  registry,
  notify,
}: {
  roomId: string;
  snapshot: Snapshot;
  registry: RegistryController;
  notify: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const area = snapshot.areas.find((item) => item.area_id === roomId);
  if (!snapshot.user.is_admin || roomId === 'unassigned' || !area) return null;

  return (
    <>
      <Box className="room-empty-action">
        <HausButton variant="secondary" onPress={() => setAdding(true)}>
          <Plus size={15} />
          Add devices to {area.name}
        </HausButton>
      </Box>
      {adding && (
        <RoomAddDevicesDialog
          room={area}
          snapshot={snapshot}
          registry={registry}
          onClose={() => setAdding(false)}
          onAdded={(ids) =>
            notify(
              `${ids.length} ${ids.length === 1 ? 'device' : 'devices'} moved to ${area.name}.`,
            )
          }
        />
      )}
    </>
  );
}

export function RoomCreateDialog({
  areas,
  registry,
  onClose,
  onCreated,
}: {
  areas: Area[];
  registry: RegistryController;
  onClose: () => void;
  onCreated: (area: Area) => void;
}) {
  return <RoomEditor areas={areas} registry={registry} onClose={onClose} onSaved={onCreated} />;
}

export function RoomCategorySection({
  roomId,
  categoryId,
  items,
  services,
  renderItems,
}: {
  roomId: string;
  categoryId: string;
  items: HausAccessory[];
  services?: Snapshot['services'];
  renderItems: (items: HausAccessory[], scopeKey: string) => ReactNode;
}) {
  const cat = categories.find((c) => c.id === categoryId);
  const filtered = accessoriesForCategory(items, categoryId, { services, excludeCameras: true });
  const Icon = categoryIcons[categoryId] ?? LayoutGrid;
  const label = cat?.name ?? titleCase(categoryId);
  return (
    <Box
      semantic="section"
      className={`device-group device-group--${categoryId}`}
      dataAttrs={{ 'data-category': categoryId }}
      key={categoryId}
    >
      <Box className="device-group-heading">
        <Text className={`device-group-icon device-group-icon--${categoryId}`}>
          <Icon size={16} strokeWidth={1.7} />
        </Text>
        <Heading level={2}>{label}</Heading>
        <Text className="device-group-count">
          {filtered.length} {filtered.length === 1 ? 'device' : 'devices'}
        </Text>
        <Text className="device-group-rule" />
      </Box>
      {renderItems(filtered, `room:${roomId}:${categoryId}`)}
    </Box>
  );
}
