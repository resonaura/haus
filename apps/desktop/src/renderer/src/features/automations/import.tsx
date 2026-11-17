/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button, Modal } from '@heroui/react';
import { useRef, useState } from 'react';
import { nativeApi } from '../../ha/management';
import {
  friendlyError,
  buildEntityAliases,
  normalizedRule,
  readBundle,
  readExisting,
  readTargetEntities,
  record,
  ruleStatusKey,
  type RuleKind,
  type TransferBundle,
  type TransferRule,
} from './transfer';

type RuleResult = {
  key: string;
  name: string;
  kind: RuleKind;
  status: 'ready' | 'saved' | 'skipped' | 'failed';
  reason?: string;
};

export function HaRulesImportDialog({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const bundleRef = useRef<TransferBundle | null>(null);
  const [entries, setEntries] = useState<RuleResult[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [saved, setSaved] = useState(0);
  const attempted = useRef(false);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    bundleRef.current = null;
    setEntries([]);
    setCompleted(0);
    setSaved(0);
    setComplete(false);
    attempted.current = false;
    try {
      const bundle = await readBundle(file);
      bundleRef.current = bundle;
      const rules = [
        ...bundle.scripts.map((rule) => ({ kind: 'script' as const, rule })),
        ...bundle.automations.map((rule) => ({ kind: 'automation' as const, rule })),
      ];
      setEntries(
        rules.map(({ kind, rule }) => ({
          key: ruleStatusKey(kind, rule),
          name: rule.name,
          kind,
          status: 'ready',
        })),
      );
      setFileName(file.name);
    } catch (cause) {
      bundleRef.current = null;
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this transfer file.');
    }
  };

  const importRules = async () => {
    const bundle = bundleRef.current;
    if (!bundle || importing || attempted.current) return;
    attempted.current = true;
    setImporting(true);
    setError('');
    let count = 0;
    try {
      const [existingScripts, existingAutomations, targetEntities] = await Promise.all([
        readExisting('script'),
        readExisting('automation'),
        readTargetEntities(),
      ]);
      const entityAliases = buildEntityAliases(bundle, targetEntities);
      const update = (key: string, change: Partial<RuleResult>) =>
        setEntries((current) =>
          current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
        );
      const rules = [
        ...bundle.scripts.map((rule) => ({
          kind: 'script' as const,
          rule,
          existing: existingScripts,
        })),
        ...bundle.automations.map((rule) => ({
          kind: 'automation' as const,
          rule,
          existing: existingAutomations,
        })),
      ];
      for (let index = 0; index < rules.length; index += 1) {
        const item = rules[index];
        if (!item) continue;
        const { kind, rule, existing } = item;
        const key = ruleStatusKey(kind, rule);
        const current = existing.get(rule.id);
        if (current) {
          const metadata = record(current.metadata);
          const migration = record(metadata?.migration);
          if (migration?.sourceEntityId === rule.sourceEntityId) {
            update(key, { status: 'skipped', reason: 'Already imported; no changes made.' });
          } else {
            update(key, { status: 'failed', reason: 'This Haus ID belongs to a different rule.' });
          }
          setCompleted(index + 1);
          continue;
        }
        try {
          const data = normalizedRule(rule, kind, bundle, entityAliases);
          await nativeApi().management({
            method: 'POST',
            path: `config/${kind}/config/${encodeURIComponent(rule.id)}`,
            data,
          });
          count += 1;
          update(key, {
            status: 'saved',
            reason: 'Saved disabled on Haus; Home Assistant stays active.',
          });
        } catch (cause) {
          update(key, {
            status: 'failed',
            reason: friendlyError(cause instanceof Error ? cause.message : ''),
          });
        }
        setCompleted(index + 1);
      }
      setSaved(count);
      if (count > 0) onComplete();
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Haus could not start the rule import.');
      attempted.current = false;
    } finally {
      setImporting(false);
    }
  };

  const percent = entries.length ? Math.round((completed / entries.length) * 100) : 0;
  const canClose = !importing;
  const ready = entries.length > 0 && entries.some((entry) => entry.status === 'ready');
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && canClose) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container>
          <Modal.Dialog className="haus-dialog">
            <Modal.CloseTrigger isDisabled={!canClose} />
            <Modal.Header>
              <Modal.Heading>Import Home Assistant rules</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="flow-description">
                Haus stores imported automations disabled. Home Assistant stays active until each
                rule is checked and explicitly cut over.
              </p>
              <label className="ha-import-file">
                <span>Rules transfer file</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={importing}
                  onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
                />
              </label>
              {fileName && <p className="management-notice">{fileName}</p>}
              {entries.length > 0 && (
                <div className="ha-import-summary">
                  <strong>
                    {entries.length} rules · {saved} saved on Haus
                  </strong>
                  <ul>
                    {entries.map((entry) => (
                      <li key={entry.key}>
                        {entry.name} · {entry.kind}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(importing || complete || completed > 0) && (
                <div className="ha-import-progress">
                  <div className="ha-import-progress-label">
                    <span>
                      {complete ? 'Import finished' : `Saving ${completed} of ${entries.length}`}
                    </span>
                    <span>{percent}%</span>
                  </div>
                  <div
                    className="ha-import-progress-track"
                    role="progressbar"
                    aria-label="Home Assistant rule import progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )}
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={!canClose} onPress={onClose}>
                {complete ? 'Close' : 'Cancel'}
              </Button>
              {!complete && (
                <Button
                  variant="primary"
                  isDisabled={importing || !ready}
                  onPress={() => void importRules()}
                >
                  {importing ? 'Saving…' : 'Import rules'}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
