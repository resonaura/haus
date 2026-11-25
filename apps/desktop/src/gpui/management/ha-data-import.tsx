/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { useRef, useState } from 'react';
import {
  buildDemoHaImportBundleJson,
  buildHaImportSummaries,
  describeHaImportFailure,
  MAX_HA_DATA_TRANSFER_BYTES,
  parseHaImportBundleText,
  stageHaImportEntries,
  type HaImportEntry,
  type HaImportSummary,
} from '@haus/core/transport';
import { HaDataImportModal } from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';
import type { GpuiRpcRequest } from './integrations.js';

export function GpuiHaDataImportModal({
  demo,
  busy = false,
  formatDomain,
  requestRpc,
  openPaths,
  onClose,
  onComplete,
}: {
  readonly demo?: boolean;
  readonly busy?: boolean;
  readonly formatDomain: (domain: string) => string;
  readonly requestRpc?: GpuiRpcRequest;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onClose: () => void;
  readonly onComplete: () => void;
}) {
  const payloadsRef = useRef<HaImportEntry[]>([]);
  const [entries, setEntries] = useState<HaImportSummary[]>([]);
  const [fileName, setFileName] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStarted, setImportStarted] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [complete, setComplete] = useState(false);

  const resetState = () => {
    setError('');
    payloadsRef.current = [];
    setEntries([]);
    setCompleted(0);
    setImportStarted(false);
    setComplete(false);
  };

  const loadBundleText = (text: string, label: string, byteLength?: number) => {
    resetState();
    try {
      const parsed = parseHaImportBundleText(text, byteLength);
      payloadsRef.current = parsed;
      setEntries(buildHaImportSummaries(parsed));
      setFileName(label);
    } catch (cause) {
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this file.');
    }
  };

  const handlePickFile = async () => {
    if (!openPaths || busy || importing) return;
    try {
      const selected = await openPaths({
        files: true,
        directories: false,
        multiple: false,
        prompt: 'Choose Home Assistant transfer JSON file',
      });
      const filePath = selected?.[0];
      if (!filePath) return;
      const info = await stat(filePath);
      if (info.size > MAX_HA_DATA_TRANSFER_BYTES) {
        resetState();
        setFileName('');
        setError('The transfer file exceeds 80 KB.');
        return;
      }
      const text = await readFile(filePath, 'utf8');
      setRawJson(text);
      loadBundleText(text, basename(filePath), info.size);
    } catch (cause) {
      resetState();
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this file.');
    }
  };

  const handleLoadSample = () => {
    if (busy || importing) return;
    const sample = buildDemoHaImportBundleJson();
    setRawJson(sample);
    loadBundleText(sample, 'willow-house-ha-entries.json');
  };

  const handleImport = async () => {
    if (importing || entries.length === 0) return;
    setImporting(true);
    setImportStarted(true);
    setError('');
    let imported = 0;
    try {
      if (requestRpc) {
        await stageHaImportEntries(
          payloadsRef.current,
          async (entry) => {
            await requestRpc({ type: 'ha/config_entries/import', entry });
            imported += 1;
          },
          ({ completed: done }) => setCompleted(done),
        );
        payloadsRef.current = [];
        setComplete(true);
        onComplete();
        return;
      }
      if (demo) {
        await stageHaImportEntries(
          payloadsRef.current,
          async () => {
            imported += 1;
          },
          ({ completed: done }) => setCompleted(done),
        );
        payloadsRef.current = [];
        setComplete(true);
        onComplete();
        return;
      }
      setError('Connect to a Haus Hub to import Home Assistant data.');
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
      onPickFile={openPaths ? () => void handlePickFile() : undefined}
      onLoadSample={demo ? handleLoadSample : undefined}
      allowJsonPaste
      rawJson={rawJson}
      onRawJsonChange={setRawJson}
      onParseJson={() => loadBundleText(rawJson, 'Pasted transfer JSON')}
      onImport={() => void handleImport()}
      onClose={onClose}
    />
  );
}
