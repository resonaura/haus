/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import { categoryIcons } from '../../components/icons/Icon';
import { categories } from '../../model/categories';
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
      <Button variant="secondary" onPress={() => setAdding(true)}>
        <Plus size={15} />
        <span>Add devices</span>
      </Button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Settings for ${area.name}`}
        title="Room settings"
        onClick={() => setEditing(true)}
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${area.name}`}
        title="Remove room"
        onClick={() => setDeleting(true)}
      >
        <Trash2 size={16} />
      </button>
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
      <div className="room-empty-action">
        <Button variant="secondary" onPress={() => setAdding(true)}>
          <Plus size={15} />
          Add devices to {area.name}
        </Button>
      </div>
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
  renderItems,
}: {
  roomId: string;
  categoryId: string;
  items: HausAccessory[];
  renderItems: (items: HausAccessory[], scopeKey: string) => ReactNode;
}) {
  const cat = categories.find((c) => c.id === categoryId);
  const filtered = items.filter((a) => a.category === categoryId);
  const Icon = categoryIcons[categoryId] ?? LayoutGrid;
  const label = cat?.name ?? titleCase(categoryId);
  return (
    <section
      className={`device-group device-group--${categoryId}`}
      data-category={categoryId}
      key={categoryId}
    >
      <div className="device-group-heading">
        <span className={`device-group-icon device-group-icon--${categoryId}`}>
          <Icon size={16} strokeWidth={1.7} />
        </span>
        <h2>{label}</h2>
        <span className="device-group-count">
          {filtered.length} {filtered.length === 1 ? 'device' : 'devices'}
        </span>
        <span className="device-group-rule" />
      </div>
      {renderItems(filtered, `room:${roomId}:${categoryId}`)}
    </section>
  );
}
