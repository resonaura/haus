/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  buildHaImportSummaries,
  describeHaImportFailure,
  MAX_HA_DATA_TRANSFER_BYTES,
  parseHaImportBundleText,
  stageHaImportEntries,
  type HaImportEntry,
  type HaImportSummary,
} from '@haus/core/transport';
import { FileInput, Text } from '@haus/ui';
import { HaDataImportModal } from '@haus/ui/components';
import { useRef, useState } from 'react';

export type { HaImportEntry };

export function HaImportDialog({
  busy,
  onClose,
  onImport,
  onComplete,
  formatDomain,
}: {
  busy: boolean;
  onClose: () => void;
  onImport: (entry: HaImportEntry) => Promise<unknown>;
  onComplete: () => void;
  formatDomain: (domain: string) => string;
}) {
  const payloads = useRef<HaImportEntry[]>([]);
  const [entries, setEntries] = useState<HaImportSummary[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStarted, setImportStarted] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [complete, setComplete] = useState(false);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    payloads.current = [];
    setEntries([]);
    setCompleted(0);
    setImportStarted(false);
    setComplete(false);
    try {
      if (file.size > MAX_HA_DATA_TRANSFER_BYTES) {
        throw new Error('The transfer file exceeds 80 KB.');
      }
      const parsed = parseHaImportBundleText(await file.text(), file.size);
      payloads.current = parsed;
      setEntries(buildHaImportSummaries(parsed));
      setFileName(file.name);
    } catch (cause) {
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this file.');
    }
  };

  const importEntries = async () => {
    if (importing || entries.length === 0) return;
    setImporting(true);
    setImportStarted(true);
    setError('');
    let imported = 0;
    try {
      await stageHaImportEntries(
        payloads.current,
        async (item) => {
          await onImport(item);
          imported += 1;
        },
        ({ completed: done }) => setCompleted(done),
      );
      payloads.current = [];
      setComplete(true);
      onComplete();
    } catch (cause) {
      if (imported > 0) onComplete();
      setError(describeHaImportFailure(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <HaDataImportModal
      fileName={fileName || undefined}
      entries={entries}
      busy={busy}
      importing={importing}
      importStarted={importStarted}
      complete={complete}
      completed={completed}
      error={error || undefined}
      formatDomain={formatDomain}
      filePickerSlot={
        <Text semantic="label" className="ha-import-file">
          <Text>Transfer file</Text>
          <FileInput
            accept=".json,application/json"
            disabled={importing || busy}
            onFileChange={(file) => void chooseFile(file)}
          />
        </Text>
      }
      onImport={() => void importEntries()}
      onClose={onClose}
    />
  );
}
