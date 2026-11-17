/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import { ConfigEditor } from '../editors/ConfigEditor';
import { ExternalLink, Zap } from 'lucide-react';
import { nativeApi } from '../../ha/management';
import { buildAction, type HassEntity, type Snapshot } from '../../model';
import type { Action } from '../../hooks/useHaus';
import { EmptyState as Empty } from '../../components/ui/EmptyState';
import { HaRulesImportDialog } from './import';
import { record } from './transfer';
export function AutomationsPage({
  states,
  onAction,
  openServer,
  snapshot,
  demo,
  onSaved,
}: {
  states: HassEntity[];
  onAction: (action: Action) => Promise<void>;
  openServer: (path: string) => void;
  snapshot: Snapshot;
  demo: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<HassEntity | null | undefined>();
  const [importingHa, setImportingHa] = useState(false);
  const [cuttingOver, setCuttingOver] = useState<string>();
  const [cutoverError, setCutoverError] = useState('');
  const isHub = snapshot.config?.version === 'haus-hub';

  const cutOver = async (entity: HassEntity) => {
    const ruleId = typeof entity.attributes.id === 'string' ? entity.attributes.id : undefined;
    const sourceEntityId =
      typeof entity.attributes.haus_migration_source_entity_id === 'string'
        ? entity.attributes.haus_migration_source_entity_id
        : undefined;
    if (!ruleId || !sourceEntityId) {
      setCutoverError('Haus could not identify this imported rule. No changes were made.');
      return;
    }
    setCutoverError('');
    setCuttingOver(ruleId);
    try {
      const response: unknown = await nativeApi().management({
        method: 'POST',
        path: 'haus/rules/automations/cutover',
        data: { id: ruleId, sourceEntityId, confirmSourceDisabled: true },
      });
      const automation = record(record(response)?.automation);
      const migration = record(record(automation?.metadata)?.migration);
      if (automation?.enabled !== true || typeof migration?.cutoverAt !== 'string') {
        throw new Error('cutover_verification_failed');
      }
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
    <div className="automation-list">
      <Button onPress={() => setEditing(null)} isDisabled={!demo && !snapshot.user.is_admin}>
        Create automation
      </Button>
      {isHub && (
        <Button
          variant="ghost"
          onPress={() => setImportingHa(true)}
          isDisabled={!demo && !snapshot.user.is_admin}
        >
          Import Home Assistant rules
        </Button>
      )}
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
      {states
        .filter((s) => s.entity_id.startsWith('automation.'))
        .map((s) => {
          const importedFromHa = s.attributes.haus_migration_source === 'home_assistant';
          const cutoverComplete = typeof s.attributes.haus_migration_source_cutover_at === 'string';
          const sourceRemoved = typeof s.attributes.haus_migration_source_removed_at === 'string';
          const waitingForSourceCutover = importedFromHa && !cutoverComplete;
          const ruleId = typeof s.attributes.id === 'string' ? s.attributes.id : '';
          return (
            <div className="automation-row" key={s.entity_id}>
              <span className="automation-icon">
                <Zap size={23} />
              </span>
              <span>
                <strong>{String(s.attributes.friendly_name ?? 'Automation')}</strong>
                <small>
                  {waitingForSourceCutover
                    ? 'Imported and paused here · Home Assistant is the source'
                    : sourceRemoved
                      ? 'Haus runs this rule · Removed from Home Assistant'
                      : cutoverComplete
                        ? 'Haus runs this rule · Home Assistant copy is paused for rollback'
                        : `${s.state === 'on' ? 'Ready when you need it' : 'Paused'} · Managed by ${isHub ? 'Haus Hub' : 'Home Assistant'}`}
                </small>
              </span>
              <Button
                variant="ghost"
                onPress={() => setEditing(s)}
                isDisabled={!demo && !snapshot.user.is_admin}
              >
                Edit
              </Button>
              {waitingForSourceCutover && (
                <Button
                  variant="ghost"
                  onPress={() => void cutOver(s)}
                  isDisabled={demo || !snapshot.user.is_admin || cuttingOver === ruleId}
                >
                  {cuttingOver === ruleId ? 'Cutting over…' : 'I disabled the HA source'}
                </Button>
              )}
              <button
                role="switch"
                aria-checked={s.state === 'on'}
                aria-label={`Enable ${s.attributes.friendly_name}`}
                className={`toggle-switch ${s.state === 'on' ? 'checked' : ''}`}
                disabled={waitingForSourceCutover}
                title={
                  waitingForSourceCutover
                    ? 'Keep the Haus copy paused until the Home Assistant source is safely cut over.'
                    : undefined
                }
                onClick={() => void onAction(buildAction(s, 'toggle')).catch(() => {})}
              >
                <i />
              </button>
            </div>
          );
        })}
      {cutoverError && <p role="alert">{cutoverError}</p>}
      {!states.some((s) => s.entity_id.startsWith('automation.')) && (
        <Empty
          icon={<Zap />}
          title="Let home take care of it"
          description={
            isHub
              ? 'Create an automation to run your scenes and devices automatically.'
              : 'Automations from Home Assistant will appear here.'
          }
        />
      )}
      {!isHub && (
        <button className="text-link" onClick={() => openServer('/config/automation/dashboard')}>
          Manage in Home Assistant <ExternalLink size={15} />
        </button>
      )}
    </div>
  );
}
