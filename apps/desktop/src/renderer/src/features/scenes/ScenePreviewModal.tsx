/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { formatSceneTargetSetting, parseRgbColorString } from '@haus/core/transport';
import { SceneDetailsModal, type PortableSceneTargetDetail } from '@haus/ui/components';
import type { HassEntity, Snapshot } from '../../model';
import { lightColor } from '../../model/light-color';

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
  const details: PortableSceneTargetDetail[] = targets.map(({ id, setting }) => {
    const current = snapshot.states.find((s) => s.entity_id === id);
    const { targetSummary, attributes } = formatSceneTargetSetting(setting);
    const swatchRgb = attributes
      ? parseRgbColorString(
          lightColor({ entity_id: id, state: 'on', attributes, last_changed: '' }),
        )
      : undefined;
    const friendlyName =
      typeof current?.attributes.friendly_name === 'string' ? current.attributes.friendly_name : id;

    return {
      id,
      name: friendlyName,
      targetSummary,
      currentState: current?.state ?? 'No live state',
      swatchRgb,
    };
  });

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
