/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { RoomNameEditor } from '@haus/ui/components';
import { roomNameInput } from '../../model/registry';
import type { Area } from '../../model';
import type { RegistryController } from '../../ha/registry';

export function RoomEditor({
  room,
  areas,
  registry,
  onClose,
  onSaved,
}: {
  room?: Area;
  areas: Area[];
  registry: RegistryController;
  onClose: () => void;
  onSaved: (area: Area) => void;
}) {
  return (
    <RoomNameEditor
      initialName={room?.name}
      onClose={onClose}
      onSave={async (name) => {
        roomNameInput(name, areas, room?.area_id);
        onSaved(await registry.saveRoom(name, room?.area_id));
      }}
    />
  );
}
