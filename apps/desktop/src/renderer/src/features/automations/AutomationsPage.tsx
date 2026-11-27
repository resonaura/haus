/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  cutoverHaAutomation,
  describeAutomationMigration,
  type ManagementPort,
  type ManagementRequest,
} from '@haus/core/transport';
import {
  AutomationsListView,
  useAutomationConfigs,
  type PortableAutomationItem,
} from '@haus/ui/components';
import {
  buildDesktopEditorCatalog,
  buildPortableAutomationItems,
} from '../../../../shared/editor-catalog';
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
  const [editing, setEditing] = useState<{
    readonly entity?: HassEntity;
    readonly templateId?: string;
  } | null>(null);
  const [importingHa, setImportingHa] = useState(false);
  const [cuttingOver, setCuttingOver] = useState<string>();
  const [cutoverError, setCutoverError] = useState('');
  const isHub = snapshot.config?.version === 'haus-hub';
  const canManage = Boolean(demo || snapshot.user.is_admin);
  const automationStates = useMemo(
    () => states.filter((entity) => entity.entity_id.startsWith('automation.')),
    [states],
  );

  const management = useMemo<ManagementPort | undefined>(() => {
    const api = window.hausNative;
    if (!api) return undefined;
    return {
      management: <T = unknown,>(input: ManagementRequest) =>
        api.management(input as { method: 'GET' | 'POST' | 'DELETE'; path: string; data?: Record<string, unknown> }) as Promise<T>,
    };
  }, []);

  const catalog = useMemo(() => buildDesktopEditorCatalog(snapshot), [snapshot]);
  const ruleRefs = useMemo(
    () =>
      automationStates.map((entity) => ({
        entityId: entity.entity_id,
        ruleId: describeAutomationMigration(entity.attributes, entity.state).ruleId,
      })),
    [automationStates],
  );
  const configs = useAutomationConfigs(management, ruleRefs, demo);

  const items = useMemo(
    () =>
      buildPortableAutomationItems({
        automations: automationStates,
        configs,
        canManage,
        cutoverDisabled: demo || !snapshot.user.is_admin,
        cuttingOverId: cuttingOver,
      }),
    [automationStates, canManage, configs, cuttingOver, demo, snapshot.user.is_admin],
  );

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

  if (editing !== null) {
    return (
      <ConfigEditor
        kind="automation"
        asScreen
        entity={editing.entity}
        initialTemplateId={editing.templateId}
        snapshot={snapshot}
        demo={demo}
        onClose={() => setEditing(null)}
        onSaved={onSaved}
      />
    );
  }

  return (
    <>
      <AutomationsListView
        items={items}
        canCreate={canManage}
        canImportHa={isHub}
        error={cutoverError || undefined}
        resolveEntityName={catalog.resolveEntityName}
        onCreate={() => setEditing({})}
        onCreateFromTemplate={(templateId) => setEditing({ templateId })}
        onImportHa={() => setImportingHa(true)}
        onEdit={(entityId) => {
          const target = automationStates.find((candidate) => candidate.entity_id === entityId);
          if (target) setEditing({ entity: target });
        }}
        onToggle={(entityId) => {
          const target = automationStates.find((candidate) => candidate.entity_id === entityId);
          if (target) void onAction(buildAction(target, 'toggle')).catch(() => {});
        }}
        onRun={(entityId) => {
          const target = automationStates.find((candidate) => candidate.entity_id === entityId);
          if (target) void onAction(buildAction(target, 'run')).catch(() => {});
        }}
        onCutover={(item) => void cutOver(item)}
      />

      {importingHa && (
        <HaRulesImportDialog onClose={() => setImportingHa(false)} onComplete={onSaved} />
      )}
    </>
  );
}
