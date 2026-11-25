/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  buildInitialSceneImportEntries,
  importSceneTransferBundle,
  MAX_SCENE_TRANSFER_BYTES,
  parseSceneTransferBundleText,
  type HaSceneImport,
  type SceneImportSummary,
} from '@haus/core/transport';
import { FileInput, Text } from '@haus/ui';
import { HaScenesImportModal } from '@haus/ui/components';
import { useRef, useState } from 'react';
import { nativeApi } from '../../ha/management';

export function SceneImportDialog({
  existingIds,
  rooms,
  onClose,
  onComplete,
}: {
  existingIds: ReadonlySet<string>;
  rooms: readonly { id: string; name: string }[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const payloads = useRef<HaSceneImport[]>([]);
  const stagedIds = useRef(new Set<string>());
  const [entries, setEntries] = useState<SceneImportSummary[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [complete, setComplete] = useState(false);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    payloads.current = [];
    stagedIds.current.clear();
    setEntries([]);
    setCompleted(0);
    setComplete(false);
    try {
      if (file.size > MAX_SCENE_TRANSFER_BYTES) {
        throw new Error('The scene transfer file exceeds 256 KB.');
      }
      const scenes = parseSceneTransferBundleText(await file.text(), file.size);
      payloads.current = scenes;
      setEntries(buildInitialSceneImportEntries(scenes, existingIds));
      setFileName(file.name);
    } catch (cause) {
      setFileName('');
      setError(cause instanceof Error ? cause.message : 'Could not read this file.');
    }
  };

  const importScenes = async () => {
    if (importing || payloads.current.length === 0) return;
    setImporting(true);
    setError('');
    try {
      const result = await importSceneTransferBundle(
        nativeApi(),
        payloads.current,
        rooms,
        (progress) => {
          setEntries([...progress.entries]);
          setCompleted(progress.completed);
        },
        stagedIds.current,
      );
      setEntries([...result.entries]);
      setCompleted(result.completed);
      onComplete();
      setComplete(true);
    } catch (cause) {
      if (stagedIds.current.size > 0) onComplete();
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
      filePickerSlot={
        <Text semantic="label" className="ha-import-file">
          <Text>Scene transfer file</Text>
          <FileInput
            accept=".json,application/json"
            disabled={importing}
            onFileChange={(file) => void chooseFile(file)}
          />
        </Text>
      }
      onImport={() => void importScenes()}
      onClose={onClose}
    />
  );
}
