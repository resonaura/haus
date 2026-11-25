/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { useRef, useState } from 'react';
import {
  buildDemoSceneTransferBundleJson,
  buildInitialSceneImportEntries,
  importSceneTransferBundle,
  MAX_SCENE_TRANSFER_BYTES,
  parseSceneTransferBundleText,
  simulateDemoSceneTransferImport,
  type HaSceneImport,
  type ManagementPort,
  type SceneImportSummary,
  type SceneRoomRef,
} from '@haus/core/transport';
import { HaScenesImportModal } from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';

export function GpuiHaScenesImportModal({
  demo,
  existingIds,
  rooms,
  management,
  openPaths,
  onClose,
  onComplete,
}: {
  readonly demo?: boolean;
  readonly existingIds: ReadonlySet<string>;
  readonly rooms: readonly SceneRoomRef[];
  readonly management?: ManagementPort;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onClose: () => void;
  readonly onComplete: () => void;
}) {
  const payloadsRef = useRef<HaSceneImport[]>([]);
  const stagedIdsRef = useRef(new Set<string>());
  const [entries, setEntries] = useState<SceneImportSummary[]>([]);
  const [fileName, setFileName] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [complete, setComplete] = useState(false);

  const resetState = () => {
    setError('');
    payloadsRef.current = [];
    stagedIdsRef.current.clear();
    setEntries([]);
    setCompleted(0);
    setComplete(false);
  };

  const loadBundleText = (text: string, label: string, byteLength?: number) => {
    resetState();
    try {
      const scenes = parseSceneTransferBundleText(text, byteLength);
      payloadsRef.current = scenes;
      setEntries(buildInitialSceneImportEntries(scenes, existingIds));
      setFileName(label);
    } catch (cause) {
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this file.');
    }
  };

  const handlePickFile = async () => {
    if (!openPaths || importing) return;
    try {
      const selected = await openPaths({
        files: true,
        directories: false,
        multiple: false,
        prompt: 'Choose Home Assistant scenes transfer file',
      });
      const filePath = selected?.[0];
      if (!filePath) return;
      const info = await stat(filePath);
      if (info.size > MAX_SCENE_TRANSFER_BYTES) {
        resetState();
        setFileName('');
        setError('The scene transfer file exceeds 256 KB.');
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
    if (importing) return;
    const sample = buildDemoSceneTransferBundleJson();
    setRawJson(sample);
    loadBundleText(sample, 'willow-house-ha-scenes.json');
  };

  const handleImport = async () => {
    if (importing || payloadsRef.current.length === 0) return;
    setImporting(true);
    setError('');
    try {
      if (management) {
        const result = await importSceneTransferBundle(
          management,
          payloadsRef.current,
          rooms,
          (progress) => {
            setEntries([...progress.entries]);
            setCompleted(progress.completed);
          },
          stagedIdsRef.current,
        );
        setEntries([...result.entries]);
        setCompleted(result.completed);
        onComplete();
        setComplete(true);
        return;
      }
      if (demo) {
        const result = simulateDemoSceneTransferImport(
          payloadsRef.current,
          rooms,
          existingIds,
          (progress) => {
            setEntries([...progress.entries]);
            setCompleted(progress.completed);
          },
        );
        setEntries([...result.entries]);
        setCompleted(result.completed);
        onComplete();
        setComplete(true);
        return;
      }
      setError('Connect to a Haus Hub to import Home Assistant scenes.');
    } catch (cause) {
      if (stagedIdsRef.current.size > 0) onComplete();
      setError(cause instanceof Error ? cause.message : 'Scene import stopped before completion.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <HaScenesImportModal
      fileName={fileName || undefined}
      entries={entries}
      importing={importing}
      complete={complete}
      completed={completed}
      error={error || undefined}
      onPickFile={openPaths ? () => void handlePickFile() : undefined}
      onLoadSample={demo ? handleLoadSample : undefined}
      allowJsonPaste
      rawJson={rawJson}
      onRawJsonChange={setRawJson}
      onParseJson={() => loadBundleText(rawJson, 'Pasted scenes JSON')}
      onImport={() => void handleImport()}
      onClose={onClose}
    />
  );
}
