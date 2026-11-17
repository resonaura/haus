/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button, Modal } from '@heroui/react';
import { useRef, useState } from 'react';
import { nativeApi } from '../../ha/management';

interface HaSceneImport {
  readonly id: string;
  readonly name: string;
  readonly haEntityId: string;
  readonly icon?: string;
  readonly areaName?: string;
  readonly entities: Record<string, unknown>;
}

interface SceneSummary {
  readonly id: string;
  readonly name: string;
  readonly entities: number;
  readonly exists: boolean;
  readonly areaName?: string;
  readonly restoreRoom?: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 24) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  const object = record(value);
  return Boolean(
    object &&
    Object.entries(object).every(
      ([key, item]) =>
        key !== '__proto__' &&
        key !== 'prototype' &&
        key !== 'constructor' &&
        safeJson(item, depth + 1),
    ),
  );
}

function parseScene(value: unknown): HaSceneImport {
  const scene = record(value);
  const entities = record(scene?.entities);
  if (
    !scene ||
    typeof scene.id !== 'string' ||
    !/^[a-z0-9_-]{1,128}$/.test(scene.id) ||
    typeof scene.name !== 'string' ||
    !scene.name.trim() ||
    scene.name.length > 256 ||
    typeof scene.haEntityId !== 'string' ||
    !/^scene\.[a-z0-9_]+$/.test(scene.haEntityId) ||
    !entities ||
    Object.keys(entities).length > 100
  ) {
    throw new Error('The scene transfer file contains an invalid entry.');
  }
  if (
    Object.entries(entities).some(
      ([id, target]) =>
        !/^(light|switch)\.[a-z0-9_]+$/.test(id) ||
        !(typeof target === 'string' || record(target)) ||
        !safeJson(target),
    )
  ) {
    throw new Error('The scene transfer file contains an unsupported target.');
  }
  if (scene.icon !== undefined && (typeof scene.icon !== 'string' || scene.icon.length > 128)) {
    throw new Error('The scene transfer file contains invalid display metadata.');
  }
  if (
    scene.areaName !== undefined &&
    (typeof scene.areaName !== 'string' || !scene.areaName.trim() || scene.areaName.length > 128)
  ) {
    throw new Error('The scene transfer file contains invalid room metadata.');
  }
  return {
    id: scene.id,
    name: scene.name.trim(),
    haEntityId: scene.haEntityId,
    ...(typeof scene.icon === 'string' ? { icon: scene.icon } : {}),
    ...(typeof scene.areaName === 'string' ? { areaName: scene.areaName.trim() } : {}),
    entities,
  };
}

async function readBundle(file: File): Promise<HaSceneImport[]> {
  if (file.size > 256 * 1024) throw new Error('The scene transfer file exceeds 256 KB.');
  const parsed: unknown = JSON.parse(await file.text());
  const bundle = record(parsed);
  if (!safeJson(parsed) || !bundle || !Array.isArray(bundle.scenes) || bundle.scenes.length > 16) {
    throw new Error('Choose a valid Home Assistant scenes transfer file.');
  }
  const scenes = bundle.scenes.map(parseScene);
  if (scenes.length === 0 || new Set(scenes.map((scene) => scene.id)).size !== scenes.length) {
    throw new Error('The scene transfer file is empty or contains duplicate IDs.');
  }
  return scenes;
}

async function readExistingScenes(): Promise<Map<string, Record<string, unknown>>> {
  const response: unknown = await nativeApi().management({
    method: 'GET',
    path: 'haus/rules/scenes',
  });
  const body = record(response);
  if (!body || !Array.isArray(body.scenes)) {
    throw new Error('Haus could not verify the current scenes before import.');
  }
  return new Map(
    body.scenes.flatMap((value) => {
      const scene = record(value);
      return typeof scene?.id === 'string' ? [[scene.id, scene] as const] : [];
    }),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  const leftRecord = record(left);
  const rightRecord = record(right);
  if (!leftRecord || !rightRecord) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    sameJson(leftKeys, rightKeys) &&
    leftKeys.every((key) => sameJson(leftRecord[key], rightRecord[key]))
  );
}

function sceneMatchesImport(existing: Record<string, unknown>, scene: HaSceneImport): boolean {
  const metadata = record(existing.metadata);
  return (
    existing.name === scene.name &&
    (metadata?.haEntityId === undefined || metadata.haEntityId === scene.haEntityId) &&
    sameJson(metadata?.haEntities, scene.entities)
  );
}

function roomIdForName(
  areaName: string | undefined,
  rooms: readonly { id: string; name: string }[],
) {
  if (!areaName) return undefined;
  const normalized = areaName.trim().toLocaleLowerCase();
  return rooms.find((room) => room.name.trim().toLocaleLowerCase() === normalized)?.id;
}

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
  const [entries, setEntries] = useState<SceneSummary[]>([]);
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
      const scenes = await readBundle(file);
      payloads.current = scenes;
      setEntries(
        scenes.map((scene) => ({
          id: scene.id,
          name: scene.name,
          entities: Object.keys(scene.entities).length,
          exists: existingIds.has(scene.id),
          ...(scene.areaName ? { areaName: scene.areaName } : {}),
        })),
      );
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
      const currentScenes = await readExistingScenes();
      const roomIds = new Map<string, string>();
      for (const scene of payloads.current) {
        const roomId = roomIdForName(scene.areaName, rooms);
        if (scene.areaName && !roomId) {
          throw new Error(`Haus has no room matching “${scene.areaName}”. No scenes were changed.`);
        }
        if (roomId) roomIds.set(scene.id, roomId);
      }
      const restoreRoomIds = new Set<string>();
      const updatedEntries = payloads.current.map((scene) => {
        const existing = currentScenes.get(scene.id);
        const restoreRoom = Boolean(
          existing &&
          !existing.roomId &&
          roomIds.has(scene.id) &&
          sceneMatchesImport(existing, scene),
        );
        if (restoreRoom) restoreRoomIds.add(scene.id);
        return {
          id: scene.id,
          name: scene.name,
          entities: Object.keys(scene.entities).length,
          exists: Boolean(existing),
          ...(scene.areaName ? { areaName: scene.areaName } : {}),
          ...(restoreRoom ? { restoreRoom: true } : {}),
        };
      });
      setEntries(updatedEntries);
      for (let index = 0; index < payloads.current.length; index += 1) {
        const scene = payloads.current[index];
        if (!scene) throw new Error('The selected transfer data is no longer available.');
        const existing = currentScenes.get(scene.id);
        const restoreRoom = restoreRoomIds.has(scene.id);
        if (existing && !restoreRoom) {
          setCompleted(index + 1);
          continue;
        }
        if (stagedIds.current.has(scene.id)) {
          setCompleted(index + 1);
          continue;
        }
        await nativeApi().management({
          method: 'POST',
          path: `config/scene/config/${encodeURIComponent(scene.id)}`,
          data: {
            name: scene.name,
            ...(scene.icon ? { icon: scene.icon } : {}),
            haEntityId: scene.haEntityId,
            ...(roomIds.has(scene.id) ? { room_id: roomIds.get(scene.id) } : {}),
            entities: scene.entities,
          },
        });
        stagedIds.current.add(scene.id);
        setCompleted(index + 1);
      }
      onComplete();
      setComplete(true);
    } catch (cause) {
      if (stagedIds.current.size > 0) onComplete();
      setError(cause instanceof Error ? cause.message : 'Scene import stopped before completion.');
    } finally {
      setImporting(false);
    }
  };

  const percent = entries.length ? Math.round((completed / entries.length) * 100) : 0;
  const canClose = !importing;

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
              <Modal.Heading>Import Home Assistant scenes</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="flow-description">
                Scenes are saved on Haus without running them. Existing Haus scenes are skipped to
                preserve your edits.
              </p>
              <label className="ha-import-file">
                <span>Scene transfer file</span>
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
                  <strong>{entries.length} scenes ready</strong>
                  <ul>
                    {entries.map((scene) => (
                      <li key={scene.id}>
                        {scene.name} · {scene.entities} devices
                        {scene.areaName ? ` · ${scene.areaName}` : ''}
                        {scene.restoreRoom
                          ? ' · restore room'
                          : scene.exists
                            ? ' · already in Haus, will skip'
                            : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(importing || complete || completed > 0) && (
                <div className="ha-import-progress">
                  <div className="ha-import-progress-label">
                    <span>{complete ? 'Saved' : `Saving ${completed} of ${entries.length}`}</span>
                    <span>{percent}%</span>
                  </div>
                  <div
                    className="ha-import-progress-track"
                    role="progressbar"
                    aria-label="Home Assistant scene import progress"
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
                  isDisabled={importing || entries.length === 0}
                  onPress={() => void importScenes()}
                >
                  {importing ? 'Saving…' : 'Save scenes'}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
