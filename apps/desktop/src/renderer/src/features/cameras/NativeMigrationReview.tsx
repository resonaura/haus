/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useState } from 'react';
import { Button, Checkbox } from '@heroui/react';
import type { NativeMigration } from './useNativeHandover';

export type MigrationAction = (
  id: string,
  operation: 'review' | 'apply' | 'undo',
  data?: Record<string, unknown>,
) => void;

const messages: Record<NativeMigration['phase'], string> = {
  review:
    'Keep existing entity IDs, names, rooms and preferences. Entity-based automations keep their targets. Review any controls without a replacement below.',
  applying:
    'Moving entity IDs and preferences. Keep Home Assistant connected; the transfer journal is saved.',
  migrated:
    'Transfer prepared. You can undo it until you finish connecting. Finishing switches Home Assistant publication to Haus.',
  undoing: 'Restoring the previous entity IDs and preferences…',
  undone: 'The transfer has been undone. Review again before making another change.',
  interrupted: 'The transfer was interrupted. Restore the previous IDs before reviewing again.',
  needs_attention:
    'Some entries changed outside this transfer. Your edits have been kept. Review the entries below, then retry restoring.',
  commit_pending:
    'Finishing was requested. Check the connection and retry Finish connecting. Undo is unavailable because the bridge may already have switched publication.',
  committed: 'Entity IDs and preferences have been transferred.',
};

export function NativeMigrationReview({
  migration,
  bridgeId,
  disabled,
  onAction,
}: {
  migration: NativeMigration;
  bridgeId: string;
  disabled: boolean;
  onAction: MigrationAction;
}) {
  const [retire, setRetire] = useState<string[]>([]);
  const busy = ['applying', 'undoing'].includes(migration.phase);
  const canUndo = ['migrated', 'interrupted', 'needs_attention'].includes(migration.phase);
  const review = migration.phase === 'review';
  return (
    <div className="camera-ha-migration" aria-busy={busy}>
      <p role="status">{messages[migration.phase]}</p>
      {migration.error === 'migration_review_changed' && (
        <p>The review changed in Home Assistant. Review again to use the current settings.</p>
      )}
      {migration.error === 'migration_references_changed' && (
        <p>
          New saved references need attention before finishing. Resolve them in Home Assistant or
          undo this transfer.
        </p>
      )}
      {review && migration.replacements.length > 0 && (
        <details>
          <summary>Keep existing IDs · {migration.replacements.length}</summary>
          <ul>
            {migration.replacements.map((move) => (
              <li key={move.to}>
                <code>{move.to}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {review && migration.retirements.length > 0 && (
        <div className="camera-ha-migration-retirements">
          <p>
            These older fields have no native replacement. Confirm each field to hide and disable
            it. No entity is deleted during preparation.
          </p>
          {migration.retirements.map((id) => (
            <Checkbox
              key={id}
              isDisabled={disabled || busy}
              isSelected={retire.includes(id)}
              onChange={(selected) =>
                setRetire((items) =>
                  selected ? [...items, id] : items.filter((item) => item !== id),
                )
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <code>{id}</code>
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
      )}
      {review && migration.blockers.length > 0 && (
        <ul>
          {migration.blockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {migration.references.length > 0 && (
        <details>
          <summary>Saved references to review</summary>
          <ul>
            {migration.references.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {migration.rollbackFailures.length > 0 && (
        <ul>
          {migration.rollbackFailures.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      )}
      <div className="camera-ha-migration-actions">
        {review && (
          <Button
            variant="secondary"
            isDisabled={
              disabled ||
              migration.blockers.length > 0 ||
              retire.length !== migration.retirements.length ||
              !!migration.error
            }
            onPress={() => onAction(bridgeId, 'apply', { revision: migration.revision, retire })}
          >
            Prepare transfer
          </Button>
        )}
        {(review || migration.phase === 'undone') && (
          <Button
            variant="tertiary"
            isDisabled={disabled}
            onPress={() => onAction(bridgeId, 'review')}
          >
            Review again
          </Button>
        )}
        {canUndo && (
          <Button
            variant="secondary"
            isDisabled={disabled}
            onPress={() => onAction(bridgeId, 'undo', { revision: migration.revision })}
          >
            Undo transfer
          </Button>
        )}
      </div>
    </div>
  );
}
