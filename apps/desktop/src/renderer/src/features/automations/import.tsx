/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { FileInput, Text } from '@haus/ui';
import { HaRulesImportModal } from '@haus/ui/components';
import { useRef, useState } from 'react';
import { nativeApi } from '../../ha/management';
import {
  buildInitialTransferEntries,
  importTransferBundle,
  readBundle,
  type RuleImportEntry,
  type TransferBundle,
} from './transfer';

export function HaRulesImportDialog({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const bundleRef = useRef<TransferBundle | null>(null);
  const [entries, setEntries] = useState<RuleImportEntry[]>([]);
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
      setEntries(buildInitialTransferEntries(bundle));
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
    try {
      const result = await importTransferBundle(nativeApi(), bundle, (progress) => {
        setEntries([...progress.entries]);
        setCompleted(progress.completed);
        setSaved(progress.saved);
      });
      setEntries([...result.entries]);
      setCompleted(result.completed);
      setSaved(result.saved);
      if (result.saved > 0) onComplete();
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Haus could not start the rule import.');
      attempted.current = false;
    } finally {
      setImporting(false);
    }
  };

  return (
    <HaRulesImportModal
      fileName={fileName || undefined}
      entries={entries}
      importing={importing}
      complete={complete}
      completed={completed}
      saved={saved}
      error={error || undefined}
      filePickerSlot={
        <Text semantic="label" className="ha-import-file">
          <Text>Rules transfer file</Text>
          <FileInput
            accept=".json,application/json"
            disabled={importing}
            onFileChange={(file) => void chooseFile(file)}
          />
        </Text>
      }
      onImport={() => void importRules()}
      onClose={onClose}
    />
  );
}
