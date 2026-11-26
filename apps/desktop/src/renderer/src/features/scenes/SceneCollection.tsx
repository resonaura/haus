/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  Box,
  HausButton as Button,
  HausMenu,
  HausScrollArea as ScrollShadow,
  Heading,
  Pressable,
  SceneCard,
  Text,
  type HausMenuItem,
} from '@haus/ui';
import { SceneRooms, ScenesLibraryView } from '@haus/ui/components';
import { groupScenes, sceneCard } from '@haus/ha/view/scene-presentation';
import { Eye, EyeOff, House, Info, MoreHorizontal, Sparkles } from 'lucide-react';
import type { HassEntity, HausModel, Snapshot } from '../../model';
import { ConfigEditor } from '../editors/ConfigEditor';
import { SceneImportDialog } from './import';
import { ScenePreviewModal } from './ScenePreviewModal';

type Props = {
  demo: boolean;
  onSaved: () => void;
  scenes: HassEntity[];
  snapshot: Snapshot;
  model: HausModel;
  onRun: (scene: HassEntity) => Promise<void>;
  openServer: (path: string) => void;
  hiddenHomeIds: ReadonlySet<string>;
  onToggleHome: (scene: HassEntity) => void;
  onToggleApp: (scene: HassEntity) => void;
  horizontal?: boolean;
  library?: boolean;
  hiddenView?: boolean;
  showAccessoryCount?: boolean;
};

export function SceneCollection({
  scenes,
  demo,
  onSaved,
  snapshot,
  model,
  onRun,
  hiddenHomeIds,
  onToggleHome,
  onToggleApp,
  horizontal = false,
  library = false,
  hiddenView = false,
  showAccessoryCount = true,
}: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<HassEntity | null | undefined>();
  const [scope, setScope] = useState('all');
  const [preview, setPreview] = useState<HassEntity | null>(null);
  const [pending, setPending] = useState('');
  const [completed, setCompleted] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState('');
  const [menuScene, setMenuScene] = useState('');

  const run = async (scene: HassEntity) => {
    setPending(scene.entity_id);
    setError('');
    try {
      await onRun(scene);
      setCompleted(scene.entity_id);
      setTimeout(() => setCompleted(''), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scene could not be applied.');
    } finally {
      setPending((current) => (current === scene.entity_id ? '' : current));
    }
  };

  const placement = (scene: HassEntity) =>
    model.scenePlacements.find((p) => p.sceneId === scene.entity_id);

  const filtered = scenes.filter(
    (scene) =>
      (scope === 'all' || (placement(scene)?.areaId ?? 'home') === scope) &&
      String(scene.attributes.friendly_name ?? scene.entity_id)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  const cards = (items: HassEntity[]) => (
    <Box className={`scene-collection ${horizontal ? 'scene-collection-rail' : ''}`}>
      {items.map((scene) => {
        const card = sceneCard(scene, snapshot, model);
        const { name, source } = card;
        const applying =
          pending === scene.entity_id ||
          snapshot.pendingEntityIds?.includes(scene.entity_id) === true;
        const menuItems: HausMenuItem[] = [
          {
            id: 'details',
            label: 'Scene details',
            icon: <Info size={16} />,
            onAction: () => setPreview(scene),
          },
          {
            id: 'edit',
            label: 'Edit scene',
            icon: <Info size={16} />,
            disabled: !demo && !snapshot.user.is_admin,
            onAction: () => setEditing(scene),
          },
          ...(!hiddenView
            ? [
                {
                  id: 'home',
                  label: hiddenHomeIds.has(scene.entity_id)
                    ? 'Show on Home view'
                    : 'Hide from Home view',
                  icon: <House size={16} />,
                  separatorBefore: true,
                  onAction: () => onToggleHome(scene),
                },
              ]
            : []),
          {
            id: 'app',
            label: hiddenView ? 'Restore to Haus' : 'Hide from Haus',
            icon: hiddenView ? <Eye size={16} /> : <EyeOff size={16} />,
            separatorBefore: hiddenView,
            onAction: () => onToggleApp(scene),
          },
        ];
        return (
          <SceneCard
            {...card}
            key={scene.entity_id}
            applying={applying}
            completed={completed === scene.entity_id}
            details={hiddenView}
            disabled={!hiddenView && (applying || scene.state === 'unavailable')}
            showAccessoryCount={showAccessoryCount}
            menuOpen={menuScene === scene.entity_id}
            onContextOptions={() => setMenuScene(scene.entity_id)}
            onActivate={() => (hiddenView ? setPreview(scene) : void run(scene))}
            options={
              <>
                <Box className="mood-details-slot">
                  <HausMenu
                    open={menuScene === scene.entity_id}
                    onOpenChange={(open) => setMenuScene(open ? scene.entity_id : '')}
                    placement="bottom"
                    items={menuItems}
                    trigger={
                      <Button
                        isIconOnly
                        variant="ghost"
                        className="mood-details button"
                        aria-label={`Options for ${name}${source ? `, ${source}` : ''}`}
                        onPress={() =>
                          setMenuScene((current) =>
                            current === scene.entity_id ? '' : scene.entity_id,
                          )
                        }
                      >
                        <MoreHorizontal size={17} />
                      </Button>
                    }
                  />
                </Box>
                {hiddenView && (
                  <Pressable className="mood-restore" onPress={() => onToggleApp(scene)}>
                    <Eye size={14} />
                    Restore to Haus
                  </Pressable>
                )}
              </>
            }
          />
        );
      })}
    </Box>
  );

  const previewCard = preview && sceneCard(preview, snapshot, model);
  const scopeOptions = [
    { value: 'all', label: 'Every room' },
    { value: 'home', label: 'Whole home' },
    ...model.rooms
      .filter((r) => scenes.some((s) => placement(s)?.areaId === r.id))
      .map((r) => ({ value: r.id, label: r.name })),
  ];
  const groups = groupScenes(filtered, model).map(({ id, name, items }) => ({
    id,
    name,
    count: items.length,
    children: cards(items),
  }));

  return (
    <Box className="scenes-workspace">
      {editing !== undefined && (
        <ConfigEditor
          kind="scene"
          entity={editing ?? undefined}
          snapshot={snapshot}
          demo={demo}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      )}

      {importOpen && (
        <SceneImportDialog
          existingIds={
            new Set(
              scenes
                .map((scene) => scene.attributes.id)
                .filter((id): id is string => typeof id === 'string'),
            )
          }
          rooms={model.rooms}
          onClose={() => setImportOpen(false)}
          onComplete={onSaved}
        />
      )}

      {library ? (
        <ScenesLibraryView
          query={query}
          scope={scope}
          scopeOptions={scopeOptions}
          canCreate={Boolean(demo || snapshot.user.is_admin)}
          canImportHa={snapshot.config?.version === 'haus-hub'}
          hasAnyScenes={scenes.length > 0}
          hasFilteredScenes={filtered.length > 0}
          error={error || undefined}
          onQueryChange={setQuery}
          onScopeChange={setScope}
          onCreate={() => setEditing(null)}
          onImportHa={() => setImportOpen(true)}
        >
          <SceneRooms portable={false} groups={groups} />
        </ScenesLibraryView>
      ) : (
        <>
          {error && (
            <Text semantic="p" role="alert" className="form-error">
              {error}
            </Text>
          )}
          {horizontal ? (
            <ScrollShadow className="mood-scroll" orientation="horizontal" size={24} hideScrollBar>
              {cards(filtered)}
            </ScrollShadow>
          ) : (
            cards(filtered)
          )}
          {!filtered.length && (
            <Box className="management-empty">
              <Sparkles size={28} />
              <Heading level={3}>
                {scenes.length ? 'No scenes match' : 'Set the feeling of home'}
              </Heading>
              <Text semantic="p">
                {scenes.length
                  ? 'Try another room or scene name.'
                  : 'Create a scene to bring your favorite device settings together.'}
              </Text>
            </Box>
          )}
        </>
      )}

      {preview && previewCard && (
        <ScenePreviewModal
          scene={preview}
          roomName={previewCard.room}
          title={previewCard.title}
          source={previewCard.source}
          targets={previewCard.targets}
          snapshot={snapshot}
          hiddenView={hiddenView}
          pending={pending}
          canEdit={Boolean(demo || snapshot.user.is_admin)}
          onClose={() => setPreview(null)}
          onEdit={() => {
            setEditing(preview);
            setPreview(null);
          }}
          onRestore={() => {
            onToggleApp(preview);
            setPreview(null);
          }}
          onRun={() => void run(preview)}
        />
      )}
    </Box>
  );
}
