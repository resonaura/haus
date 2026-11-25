/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { useRef, useState } from 'react';
import {
  buildDemoTransferBundleJson,
  buildInitialTransferEntries,
  importTransferBundle,
  MAX_TRANSFER_BUNDLE_BYTES,
  parseTransferBundleText,
  simulateDemoTransferImport,
  type ManagementPort,
  type RuleImportEntry,
  type TransferBundle,
} from '@haus/core/transport';
import { HaRulesImportModal } from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';

export function GpuiHaRulesImportModal({
  demo,
  management,
  openPaths,
  onClose,
  onComplete,
}: {
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onClose: () => void;
  readonly onComplete: () => void;
}) {
  const bundleRef = useRef<TransferBundle | null>(null);
  const attemptedRef = useRef(false);
  const [entries, setEntries] = useState<RuleImportEntry[]>([]);
  const [fileName, setFileName] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [saved, setSaved] = useState(0);

  const resetProgress = () => {
    setError('');
    bundleRef.current = null;
    setEntries([]);
    setCompleted(0);
    setSaved(0);
    setComplete(false);
    attemptedRef.current = false;
  };

  const loadBundleText = (text: string, label: string, byteLength?: number) => {
    resetProgress();
    try {
      const bundle = parseTransferBundleText(text, byteLength);
      bundleRef.current = bundle;
      setEntries(buildInitialTransferEntries(bundle));
      setFileName(label);
    } catch (cause) {
      bundleRef.current = null;
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this transfer file.');
    }
  };

  const handlePickFile = async () => {
    if (!openPaths || importing) return;
    try {
      const selected = await openPaths({
        files: true,
        directories: false,
        multiple: false,
        prompt: 'Choose Home Assistant rules transfer file',
      });
      const filePath = selected?.[0];
      if (!filePath) return;
      const info = await stat(filePath);
      if (info.size > MAX_TRANSFER_BUNDLE_BYTES) {
        resetProgress();
        setFileName('');
        setError('The rule transfer file exceeds 1 MB.');
        return;
      }
      const text = await readFile(filePath, 'utf8');
      setRawJson(text);
      loadBundleText(text, basename(filePath), info.size);
    } catch (cause) {
      resetProgress();
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this transfer file.');
    }
  };

  const handleLoadSample = () => {
    if (importing) return;
    const sample = buildDemoTransferBundleJson();
    setRawJson(sample);
    loadBundleText(sample, 'willow-house-ha-rules.json');
  };

  const handleImport = async () => {
    const bundle = bundleRef.current;
    if (!bundle || importing || attemptedRef.current) return;
    attemptedRef.current = true;
    setImporting(true);
    setError('');
    try {
      if (management) {
        const result = await importTransferBundle(management, bundle, (progress) => {
          setEntries([...progress.entries]);
          setCompleted(progress.completed);
          setSaved(progress.saved);
        });
        setEntries([...result.entries]);
        setCompleted(result.completed);
        setSaved(result.saved);
        if (result.saved > 0) onComplete();
        setComplete(true);
        return;
      }
      if (demo) {
        const result = simulateDemoTransferImport(bundle, (progress) => {
          setEntries([...progress.entries]);
          setCompleted(progress.completed);
          setSaved(progress.saved);
        });
        setEntries([...result.entries]);
        setCompleted(result.completed);
        setSaved(result.saved);
        if (result.saved > 0) onComplete();
        setComplete(true);
        return;
      }
      setError('Connect to a Haus Hub to import Home Assistant rules.');
      attemptedRef.current = false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Haus could not start the rule import.');
      attemptedRef.current = false;
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
