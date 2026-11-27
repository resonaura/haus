/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo } from 'react';
import { SceneDetailsModal } from '@haus/ui/components';
import { buildSceneTargetDetails } from '../../../../shared/editor-catalog';
import type { HassEntity, Snapshot } from '../../model';

export interface SceneTargetEntry {
  id: string;
  setting: unknown;
}

export function ScenePreviewModal({
  scene,
  roomName,
  title,
  source,
  targets,
  snapshot,
  hiddenView,
  pending,
  canEdit,
  onClose,
  onEdit,
  onRestore,
  onRun,
}: {
  scene: HassEntity;
  roomName: string;
  title: string;
  source?: string;
  targets: SceneTargetEntry[];
  snapshot: Snapshot;
  hiddenView: boolean;
  pending: string;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRestore: () => void;
  onRun: () => void;
}) {
  const details = useMemo(
    () => buildSceneTargetDetails(targets, snapshot),
    [snapshot, targets],
  );

  return (
    <SceneDetailsModal
      title={title}
      roomName={roomName}
      source={source}
      targets={details}
      hiddenView={hiddenView}
      applying={pending === scene.entity_id}
      unavailable={Boolean(pending) || scene.state === 'unavailable'}
      canEdit={canEdit}
      onClose={onClose}
      onEdit={onEdit}
      onRestore={onRestore}
      onApply={onRun}
    />
  );
}
