/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo } from 'react';
import type { EditableKind, ManagementPort } from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { UnifiedConfigEditorModal } from '@haus/ui/components';
import {
  buildDesktopEditorCatalog,
  toEditableEntitySeed,
} from '../../shared/editor-catalog.js';

export function GpuiConfigEditor({
  kind,
  asScreen = false,
  columns = 3,
  entity,
  initialTemplateId,
  snapshot,
  demo,
  management,
  onApplySceneEntities,
  onClose,
  onSaved,
}: {
  readonly kind: EditableKind;
  readonly asScreen?: boolean;
  readonly columns?: number;
  readonly entity?: HassEntity;
  readonly initialTemplateId?: string;
  readonly snapshot: Snapshot;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const catalog = useMemo(() => buildDesktopEditorCatalog(snapshot), [snapshot]);
  const seed = useMemo(() => toEditableEntitySeed(entity, snapshot), [entity, snapshot]);

  return (
    <UnifiedConfigEditorModal
      kind={kind}
      asScreen={asScreen}
      columns={columns}
      entity={seed}
      initialTemplateId={initialTemplateId}
      templateContext={catalog.templateContext}
      demo={Boolean(demo)}
      management={management}
      devices={catalog.devices}
      scenes={catalog.scenes}
      roomOptions={snapshot.config.version === 'haus-hub' ? catalog.roomOptions : undefined}
      entityOptions={catalog.entityOptions}
      buttonControllers={catalog.buttonControllers}
      targetPlatform={catalog.targetPlatform}
      resolveDeviceEventEntity={catalog.resolveDeviceEventEntity}
      serviceOptions={catalog.serviceOptions}
      onTestSceneEntities={onApplySceneEntities}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
