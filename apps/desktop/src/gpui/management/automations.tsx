/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  cutoverHaAutomation,
  describeAutomationMigration,
  type ManagementPort,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import {
  AutomationsListView,
  useAutomationConfigs,
  type PortableAutomationItem,
} from '@haus/ui/components';
import {
  buildDesktopEditorCatalog,
  buildPortableAutomationItems,
} from '../../shared/editor-catalog.js';
import type { GpuiPlatform } from '../platform.js';
import type { DeviceControl } from '../home/cards.js';
import { availableAction } from '../home/model.js';
import { GpuiConfigEditor } from './config-editor.js';
import { GpuiHaRulesImportModal } from './ha-rules-import.js';

export function GpuiAutomationsView({
  snapshot,
  automations,
  columns = 3,
  demo,
  disabled,
  management,
  openPaths,
  onControl,
  onApplySceneEntities,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly automations: readonly HassEntity[];
  readonly columns?: number;
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly management?: ManagementPort;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onControl: DeviceControl;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onSaved?: () => void;
}) {
  const [editing, setEditing] = useState<{
    readonly entity?: HassEntity;
    readonly templateId?: string;
  } | null>(null);
  const [importingHa, setImportingHa] = useState(false);
  const [cuttingOver, setCuttingOver] = useState('');
  const [error, setError] = useState('');
  const canManage = Boolean(demo || snapshot.user.is_admin);
  const canImportHa = Boolean(demo || snapshot.config.version === 'haus-hub');

  const catalog = useMemo(() => buildDesktopEditorCatalog(snapshot), [snapshot]);
  const ruleRefs = useMemo(
    () =>
      automations.map((entity) => ({
        entityId: entity.entity_id,
        ruleId: describeAutomationMigration(entity.attributes, entity.state).ruleId,
      })),
    [automations],
  );
  const configs = useAutomationConfigs(management, ruleRefs, demo);

  const items = useMemo(
    () =>
      buildPortableAutomationItems({
        automations,
        configs,
        canManage,
        cutoverDisabled: Boolean(demo || !snapshot.user.is_admin),
        cuttingOverId: cuttingOver,
        isToggleDisabled: (entity, waitingForCutover) =>
          disabled || waitingForCutover || !availableAction(snapshot, entity.entity_id, 'toggle'),
      }),
    [automations, canManage, configs, cuttingOver, demo, disabled, snapshot],
  );

  const handleCutover = (item: PortableAutomationItem) => {
    const entity = automations.find((a) => a.entity_id === item.entityId);
    const migration = entity
      ? describeAutomationMigration(entity.attributes, entity.state)
      : undefined;
    if (!migration?.ruleId || !migration.sourceEntityId || !management) {
      setError('Haus could not identify this imported rule. No changes were made.');
      return;
    }
    setError('');
    setCuttingOver(migration.ruleId);
    void cutoverHaAutomation(management, migration.ruleId, migration.sourceEntityId)
      .then(() => onSaved?.())
      .catch(() =>
        setError(
          'Haus could not verify the cutover. The Home Assistant copy remains available for rollback.',
        ),
      )
      .finally(() => setCuttingOver(''));
  };

  if (editing !== null) {
    return (
      <GpuiConfigEditor
        kind="automation"
        asScreen
        columns={columns}
        entity={editing.entity}
        initialTemplateId={editing.templateId}
        snapshot={snapshot}
        demo={demo}
        management={management}
        onApplySceneEntities={onApplySceneEntities}
        onClose={() => setEditing(null)}
        onSaved={() => onSaved?.()}
      />
    );
  }

  return (
    <>
      <AutomationsListView
        items={items}
        canCreate={canManage}
        canImportHa={canImportHa}
        columns={columns}
        error={error || undefined}
        resolveEntityName={catalog.resolveEntityName}
        onCreate={() => setEditing({})}
        onCreateFromTemplate={(templateId) => setEditing({ templateId })}
        onImportHa={() => setImportingHa(true)}
        onEdit={(entityId) => {
          const target = automations.find((a) => a.entity_id === entityId);
          if (target) setEditing({ entity: target });
        }}
        onToggle={(entityId) => onControl(entityId, 'toggle')}
        onRun={
          disabled
            ? undefined
            : (entityId) => {
                if (availableAction(snapshot, entityId, 'run')) onControl(entityId, 'run');
              }
        }
        onCutover={handleCutover}
      />

      {importingHa && (
        <GpuiHaRulesImportModal
          demo={demo}
          management={management}
          openPaths={openPaths}
          onClose={() => setImportingHa(false)}
          onComplete={() => onSaved?.()}
        />
      )}
    </>
  );
}
