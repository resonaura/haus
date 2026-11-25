/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { cutoverHaAutomation, describeAutomationMigration } from '@haus/core/transport';
import { AutomationsListView, type PortableAutomationItem } from '@haus/ui/components';
import { ConfigEditor } from '../editors/ConfigEditor';
import { nativeApi } from '../../ha/management';
import { buildAction, type HassEntity, type Snapshot } from '../../model';
import type { Action } from '../../hooks/useHaus';
import { HaRulesImportDialog } from './import';

export function AutomationsPage({
  states,
  onAction,
  snapshot,
  demo,
  onSaved,
}: {
  states: HassEntity[];
  onAction: (action: Action) => Promise<void>;
  openServer?: (path: string) => void;
  snapshot: Snapshot;
  demo: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<HassEntity | null | undefined>();
  const [importingHa, setImportingHa] = useState(false);
  const [cuttingOver, setCuttingOver] = useState<string>();
  const [cutoverError, setCutoverError] = useState('');
  const isHub = snapshot.config?.version === 'haus-hub';
  const canManage = Boolean(demo || snapshot.user.is_admin);
  const automationStates = states.filter((entity) => entity.entity_id.startsWith('automation.'));

  const items: PortableAutomationItem[] = automationStates.map((entity) => {
    const migration = describeAutomationMigration(entity.attributes, entity.state);
    return {
      entityId: entity.entity_id,
      ruleId: migration.ruleId,
      name: migration.friendlyName,
      statusLabel: migration.statusLabel,
      enabled: entity.state === 'on',
      toggleDisabled: migration.waitingForSourceCutover,
      canEdit: canManage,
      cutoverDisabled: demo || !snapshot.user.is_admin,
      needsCutover: migration.waitingForSourceCutover,
      cuttingOver: Boolean(migration.ruleId && cuttingOver === migration.ruleId),
    };
  });

  const cutOver = async (item: PortableAutomationItem) => {
    const entity = automationStates.find((candidate) => candidate.entity_id === item.entityId);
    const migration = entity
      ? describeAutomationMigration(entity.attributes, entity.state)
      : undefined;
    if (!migration?.ruleId || !migration.sourceEntityId) {
      setCutoverError('Haus could not identify this imported rule. No changes were made.');
      return;
    }
    setCutoverError('');
    setCuttingOver(migration.ruleId);
    try {
      await cutoverHaAutomation(nativeApi(), migration.ruleId, migration.sourceEntityId);
      onSaved();
    } catch {
      setCutoverError(
        'Haus could not verify the cutover. The Home Assistant copy remains available for rollback.',
      );
    } finally {
      setCuttingOver(undefined);
    }
  };

  return (
    <>
      <AutomationsListView
        items={items}
        canCreate={canManage}
        canImportHa={isHub}
        error={cutoverError || undefined}
        onCreate={() => setEditing(null)}
        onImportHa={() => setImportingHa(true)}
        onEdit={(entityId) => {
          const target = automationStates.find((candidate) => candidate.entity_id === entityId);
          if (target) setEditing(target);
        }}
        onToggle={(entityId) => {
          const target = automationStates.find((candidate) => candidate.entity_id === entityId);
          if (target) void onAction(buildAction(target, 'toggle')).catch(() => {});
        }}
        onCutover={(item) => void cutOver(item)}
      />

      {importingHa && (
        <HaRulesImportDialog onClose={() => setImportingHa(false)} onComplete={onSaved} />
      )}

      {editing !== undefined && (
        <ConfigEditor
          kind="automation"
          entity={editing ?? undefined}
          snapshot={snapshot}
          demo={demo}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
