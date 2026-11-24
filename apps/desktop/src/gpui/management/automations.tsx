/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { cutoverHaAutomation, type ManagementPort } from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { AutomationsListView, type PortableAutomationItem } from '@haus/ui/components';
import type { DeviceControl } from '../home/cards.js';
import { availableAction } from '../home/model.js';
import { GpuiConfigEditor } from './config-editor.js';

export function GpuiAutomationsView({
  snapshot,
  automations,
  demo,
  disabled,
  management,
  onControl,
  onApplySceneEntities,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly automations: readonly HassEntity[];
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly management?: ManagementPort;
  readonly onControl: DeviceControl;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onSaved?: () => void;
}) {
  const [editing, setEditing] = useState<HassEntity | null | undefined>(undefined);
  const [cuttingOver, setCuttingOver] = useState('');
  const [error, setError] = useState('');
  const canManage = Boolean(demo || snapshot.user.is_admin);

  const items: PortableAutomationItem[] = automations.map((entity) => {
    const importedFromHa = entity.attributes.haus_migration_source === 'home_assistant';
    const cutoverComplete = typeof entity.attributes.haus_migration_source_cutover_at === 'string';
    const sourceRemoved = typeof entity.attributes.haus_migration_source_removed_at === 'string';
    const waitingForSourceCutover = importedFromHa && !cutoverComplete;
    const ruleId = typeof entity.attributes.id === 'string' ? entity.attributes.id : '';
    const friendlyName =
      typeof entity.attributes.friendly_name === 'string'
        ? entity.attributes.friendly_name
        : 'Automation';

    const statusLabel = waitingForSourceCutover
      ? 'Imported and paused here · Home Assistant is the source'
      : sourceRemoved
        ? 'Haus runs this rule · Removed from Home Assistant'
        : cutoverComplete
          ? 'Haus runs this rule · Home Assistant copy is paused for rollback'
          : `${entity.state === 'on' ? 'Ready when you need it' : 'Paused'} · Managed by Haus Hub`;

    return {
      entityId: entity.entity_id,
      ruleId,
      name: friendlyName,
      statusLabel,
      enabled: entity.state === 'on',
      toggleDisabled:
        disabled ||
        waitingForSourceCutover ||
        !availableAction(snapshot, entity.entity_id, 'toggle'),
      canEdit: canManage,
      needsCutover: waitingForSourceCutover,
      cuttingOver: Boolean(ruleId && cuttingOver === ruleId),
    };
  });

  const handleCutover = (item: PortableAutomationItem) => {
    const entity = automations.find((a) => a.entity_id === item.entityId);
    const sourceEntityId =
      typeof entity?.attributes.haus_migration_source_entity_id === 'string'
        ? entity.attributes.haus_migration_source_entity_id
        : '';
    if (!item.ruleId || !sourceEntityId || !management) {
      setError('Haus could not identify this imported rule. No changes were made.');
      return;
    }
    setError('');
    setCuttingOver(item.ruleId);
    void cutoverHaAutomation(management, item.ruleId, sourceEntityId)
      .then(() => onSaved?.())
      .catch(() =>
        setError(
          'Haus could not verify the cutover. The Home Assistant copy remains available for rollback.',
        ),
      )
      .finally(() => setCuttingOver(''));
  };

  return (
    <>
      <AutomationsListView
        items={items}
        canCreate={canManage}
        error={error}
        onCreate={() => setEditing(null)}
        onEdit={(entityId) => {
          const target = automations.find((a) => a.entity_id === entityId);
          if (target) setEditing(target);
        }}
        onToggle={(entityId) => onControl(entityId, 'toggle')}
        onCutover={handleCutover}
      />

      {editing !== undefined && (
        <GpuiConfigEditor
          kind="automation"
          entity={editing ?? undefined}
          snapshot={snapshot}
          demo={demo}
          management={management}
          onApplySceneEntities={onApplySceneEntities}
          onClose={() => setEditing(undefined)}
          onSaved={() => onSaved?.()}
        />
      )}
    </>
  );
}
