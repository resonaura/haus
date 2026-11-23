/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, FileInput, HausButton, HausDialog, HausProgressBar, Text } from '@haus/ui';
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
  const ready = entries.some((entry) => entry.status === 'ready');
  return (
    <HausDialog
      title="Import Home Assistant rules"
      backdrop="blur"
      onClose={() => {
        if (canClose) onClose();
      }}
      footer={
        <>
          <HausButton variant="ghost" isDisabled={!canClose} onPress={onClose}>
            {complete ? 'Close' : 'Cancel'}
          </HausButton>
          {!complete && (
            <HausButton
              variant="primary"
              isDisabled={importing || !ready}
              onPress={() => void importRules()}
            >
              {importing ? 'Saving…' : 'Import rules'}
            </HausButton>
          )}
        </>
      }
    >
      <Text semantic="p" className="flow-description">
        Haus stores imported automations disabled. Home Assistant stays active until each rule is
        checked and explicitly cut over.
      </Text>
      <Text semantic="label" className="ha-import-file">
        <Text>Rules transfer file</Text>
        <FileInput
          accept=".json,application/json"
          disabled={importing}
          onFileChange={(file) => void chooseFile(file)}
        />
      </Text>
      {fileName && (
        <Text semantic="p" className="management-notice">
          {fileName}
        </Text>
      )}
      {entries.length > 0 && (
        <Box className="ha-import-summary">
          <Text semantic="strong">
            {entries.length} rules · {saved} saved on Haus
          </Text>
          <Box semantic="list">
            {entries.map((entry) => (
              <Box semantic="listitem" key={entry.key}>
                {entry.name} · {entry.kind}
                {entry.reason ? ` · ${entry.reason}` : ''}
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {(importing || complete || completed > 0) && (
        <HausProgressBar
          value={percent}
          label={complete ? 'Import finished' : `Saving ${completed} of ${entries.length}`}
          ariaLabel="Home Assistant rule import progress"
        />
      )}
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
    </HausDialog>
  );
}
