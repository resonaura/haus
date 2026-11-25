/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState, type ReactNode } from 'react';
import {
  formatSceneTargetSetting,
  parseRgbColorString,
  type ManagementPort,
} from '@haus/core/transport';
import { lightColor } from '@haus/ha/light-color';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { normalizeHome } from '@haus/ha/view/normalize';
import { groupScenes, sceneCard } from '@haus/ha/view/scene-presentation';
import {
  SceneDetailsModal,
  SceneRooms,
  ScenesLibraryView,
  type PortableSceneTargetDetail,
  type SceneScopeOption,
} from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';
import { availableAction, type homeDashboard } from '../home/model.js';
import { GpuiConfigEditor } from './config-editor.js';
import { GpuiHaScenesImportModal } from './ha-scenes-import.js';

export function GpuiScenePreviewModal({
  scene,
  snapshot,
  applying,
  canEdit,
  onClose,
  onEdit,
  onApply,
}: {
  readonly scene: HassEntity;
  readonly snapshot: Snapshot;
  readonly applying?: boolean;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onApply: () => void;
}) {
  const model = useMemo(() => normalizeHome(snapshot), [snapshot]);
  const card = useMemo(() => sceneCard(scene, snapshot, model), [model, scene, snapshot]);

  const targets: PortableSceneTargetDetail[] = card.targets.map(({ id, setting }) => {
    const current = snapshot.states.find((s) => s.entity_id === id);
    const { targetSummary, attributes } = formatSceneTargetSetting(setting);
    const swatchRgb = attributes
      ? parseRgbColorString(
          lightColor({ entity_id: id, state: 'on', attributes, last_changed: '' }),
        )
      : undefined;
    const friendlyName =
      typeof current?.attributes.friendly_name === 'string' ? current.attributes.friendly_name : id;

    return {
      id,
      name: friendlyName,
      targetSummary,
      currentState: current?.state ?? 'No live state',
      swatchRgb,
    };
  });

  return (
    <SceneDetailsModal
      title={card.title}
      roomName={card.room}
      source={card.source}
      targets={targets}
      applying={applying}
      unavailable={
        scene.state === 'unavailable' || !availableAction(snapshot, scene.entity_id, 'run')
      }
      canEdit={canEdit}
      onClose={onClose}
      onEdit={onEdit}
      onApply={onApply}
    />
  );
}

export function GpuiScenesView({
  snapshot,
  scenes,
  home,
  demo,
  management,
  openPaths,
  renderScenes,
  onApplyScene,
  onApplySceneEntities,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly scenes: readonly HassEntity[];
  readonly home: ReturnType<typeof homeDashboard>;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly renderScenes: (scenes: readonly HassEntity[], showAccessoryCount?: boolean) => ReactNode;
  readonly onApplyScene: (sceneId: string) => void;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onSaved?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [importOpen, setImportOpen] = useState(false);
  const [previewScene, setPreviewScene] = useState<HassEntity | null>(null);
  const [editingScene, setEditingScene] = useState<HassEntity | null | undefined>(undefined);
  const canEdit = Boolean(demo || snapshot.user.is_admin);
  const canImportHa = Boolean(demo || snapshot.config.version === 'haus-hub');

  const model = useMemo(() => normalizeHome(snapshot), [snapshot]);
  const placements = useMemo(
    () => new Map(model.scenePlacements.map((p) => [p.sceneId, p.areaId])),
    [model.scenePlacements],
  );
  const existingIds = useMemo(
    () =>
      new Set(
        scenes
          .map((scene) =>
            typeof scene.attributes.id === 'string'
              ? scene.attributes.id
              : scene.entity_id.startsWith('scene.')
                ? scene.entity_id.slice(6)
                : '',
          )
          .filter(Boolean),
      ),
    [scenes],
  );

  const scopeOptions = useMemo<SceneScopeOption[]>(
    () => [
      { value: 'all', label: 'Every room' },
      { value: 'home', label: 'Whole home' },
      ...model.rooms
        .filter((room) => scenes.some((scene) => placements.get(scene.entity_id) === room.id))
        .map((room) => ({ value: room.id, label: room.name })),
    ],
    [model.rooms, placements, scenes],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scenes.filter((scene) => {
      const areaId = placements.get(scene.entity_id) ?? 'home';
      if (scope !== 'all' && areaId !== scope) return false;
      if (!needle) return true;
      const friendly =
        typeof scene.attributes.friendly_name === 'string'
          ? scene.attributes.friendly_name
          : scene.entity_id;
      return friendly.toLowerCase().includes(needle);
    });
  }, [placements, query, scenes, scope]);

  const groups = useMemo(
    () =>
      groupScenes(filtered, model).map(({ id, name, items }) => ({
        id,
        name,
        count: items.length,
        children: renderScenes(items),
      })),
    [filtered, model, renderScenes],
  );

  void home;

  return (
    <>
      <ScenesLibraryView
        query={query}
        scope={scope}
        scopeOptions={scopeOptions}
        canCreate={canEdit}
        canImportHa={canImportHa}
        hasAnyScenes={scenes.length > 0}
        hasFilteredScenes={groups.length > 0}
        onQueryChange={setQuery}
        onScopeChange={setScope}
        onCreate={() => setEditingScene(null)}
        onImportHa={() => setImportOpen(true)}
      >
        <SceneRooms groups={groups} />
      </ScenesLibraryView>

      {importOpen && (
        <GpuiHaScenesImportModal
          demo={demo}
          existingIds={existingIds}
          rooms={model.rooms}
          management={management}
          openPaths={openPaths}
          onClose={() => setImportOpen(false)}
          onComplete={() => onSaved?.()}
        />
      )}

      {previewScene && (
        <GpuiScenePreviewModal
          scene={previewScene}
          snapshot={snapshot}
          applying={snapshot.pendingEntityIds?.includes(previewScene.entity_id)}
          canEdit={canEdit}
          onClose={() => setPreviewScene(null)}
          onEdit={() => {
            setEditingScene(previewScene);
            setPreviewScene(null);
          }}
          onApply={() => {
            onApplyScene(previewScene.entity_id);
            setPreviewScene(null);
          }}
        />
      )}

      {editingScene !== undefined && (
        <GpuiConfigEditor
          kind="scene"
          entity={editingScene ?? undefined}
          snapshot={snapshot}
          demo={demo}
          management={management}
          onApplySceneEntities={onApplySceneEntities}
          onClose={() => setEditingScene(undefined)}
          onSaved={() => onSaved?.()}
        />
      )}
    </>
  );
}
