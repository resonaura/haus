/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  cutoverHaAutomation,
  describeAutomationMigration,
  type ManagementPort,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { AutomationsListView, type PortableAutomationItem } from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';
import type { DeviceControl } from '../home/cards.js';
import { availableAction } from '../home/model.js';
import { GpuiConfigEditor } from './config-editor.js';
import { GpuiHaRulesImportModal } from './ha-rules-import.js';

export function GpuiAutomationsView({
  snapshot,
  automations,
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
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly management?: ManagementPort;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onControl: DeviceControl;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onSaved?: () => void;
}) {
  const [editing, setEditing] = useState<HassEntity | null | undefined>(undefined);
  const [importingHa, setImportingHa] = useState(false);
  const [cuttingOver, setCuttingOver] = useState('');
  const [error, setError] = useState('');
  const canManage = Boolean(demo || snapshot.user.is_admin);
  const canImportHa = Boolean(demo || snapshot.config.version === 'haus-hub');

  const items: PortableAutomationItem[] = automations.map((entity) => {
    const migration = describeAutomationMigration(entity.attributes, entity.state);
    return {
      entityId: entity.entity_id,
      ruleId: migration.ruleId,
      name: migration.friendlyName,
      statusLabel: migration.statusLabel,
      enabled: entity.state === 'on',
      toggleDisabled:
        disabled ||
        migration.waitingForSourceCutover ||
        !availableAction(snapshot, entity.entity_id, 'toggle'),
      canEdit: canManage,
      cutoverDisabled: Boolean(demo || !snapshot.user.is_admin),
      needsCutover: migration.waitingForSourceCutover,
      cuttingOver: Boolean(migration.ruleId && cuttingOver === migration.ruleId),
    };
  });

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

  return (
    <>
      <AutomationsListView
        items={items}
        canCreate={canManage}
        canImportHa={canImportHa}
        error={error}
        onCreate={() => setEditing(null)}
        onImportHa={() => setImportingHa(true)}
        onEdit={(entityId) => {
          const target = automations.find((a) => a.entity_id === entityId);
          if (target) setEditing(target);
        }}
        onToggle={(entityId) => onControl(entityId, 'toggle')}
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
