/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ConfigEditor } from '../editors/ConfigEditor';
import { ScenePreviewModal } from './ScenePreviewModal';
import { useState } from 'react';
import {
  Box,
  HausButton as Button,
  HausMenu,
  HausScrollArea as ScrollShadow,
  HausSelect,
  Heading,
  Pressable,
  Text,
  TextInput,
  type HausMenuItem,
} from '@haus/ui';
import {
  Check,
  Eye,
  EyeOff,
  FileUp,
  House,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Sparkles,
} from 'lucide-react';
import type { HassEntity, HausModel, Snapshot } from '../../model';
import { lightColor } from '../../model/light-color';
import { scenePresentation, sceneLightingIsDark } from '../../model/scene-presentation';
import { SceneIcon } from '../../components/icons/Icon';
import { SceneImportDialog } from './import';

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
  const targets = (scene: HassEntity) => {
    const config = snapshot.sceneConfigs?.[scene.entity_id];
    const raw = config?.entities ?? scene.attributes.entities ?? scene.attributes.states;
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      return Object.entries(raw as Record<string, unknown>).map(([id, setting]) => ({
        id,
        setting,
      }));
    const ids = scene.attributes.entity_id;
    return (Array.isArray(ids) ? ids : typeof ids === 'string' ? [ids] : [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({ id, setting: undefined as unknown }));
  };
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
  const roomName = (scene: HassEntity) =>
    model.rooms.find((r) => r.id === placement(scene)?.areaId)?.name ?? 'Whole home';
  const presentation = (scene: HassEntity) =>
    scenePresentation(
      scene,
      roomName(scene),
      snapshot.entities.find((entry) => entry.entity_id === scene.entity_id),
    );
  const swatches = (scene: HassEntity) =>
    [
      ...new Set(
        targets(scene).flatMap(({ id, setting }) => {
          if (!id.startsWith('light.') || !setting || typeof setting !== 'object') return [];
          const values = setting as Record<string, unknown>;
          const attributes =
            values.attributes && typeof values.attributes === 'object'
              ? (values.attributes as Record<string, unknown>)
              : values;
          if (values.state === 'off') return [];
          const color = lightColor({ entity_id: id, state: 'on', attributes, last_changed: '' });
          return color ? [color] : [];
        }),
      ),
    ].slice(0, 5);
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
        const { name, title, source } = presentation(scene);
        const artwork = snapshot.sceneArtwork?.[scene.entity_id];
        const colors = artwork?.colors.length ? artwork.colors : swatches(scene);
        const count = targets(scene).length || placement(scene)?.targetCount || 0;
        const room = roomName(scene);
        const settings =
          snapshot.sceneConfigs?.[scene.entity_id]?.entities ??
          scene.attributes.entities ??
          scene.attributes.states;
        const dark =
          artwork?.dark ??
          sceneLightingIsDark(settings as Record<string, unknown> | undefined) ??
          (/night|sleep/i.test(name) && !colors.length);
        const palette = colors.length
          ? `radial-gradient(ellipse at 15% 100%, ${colors[0]}, transparent 65%), radial-gradient(ellipse at 80% 0%, ${colors[1] ?? colors[0]}, transparent 72%), radial-gradient(ellipse at 90% 100%, ${colors[2] ?? colors[0]}, transparent 65%)`
          : undefined;
        const match =
          placement(scene)?.matchScore === 1 && (placement(scene)?.matchCoverage ?? 0) === 1;
        const active = placement(scene)?.active === true;
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
          <Box
            semantic="article"
            className={`mood-card ${active ? 'is-active-scene' : ''} ${dark ? 'is-dark-scene' : ''}`}
            dataAttrs={{
              'data-menu-open': menuScene === scene.entity_id || undefined,
              'data-pending': applying || undefined,
            }}
            key={scene.entity_id}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuScene(scene.entity_id);
            }}
          >
            <Pressable
              className="mood-activate"
              ariaLabel={`${hiddenView ? 'Details for' : 'Apply'} ${name}${source ? `, ${source}` : ''}${active ? ', active settings' : ''}`}
              title={`${hiddenView ? 'Details for' : 'Apply'} ${name}`}
              ariaBusy={applying}
              disabled={!hiddenView && (applying || scene.state === 'unavailable')}
              onPress={() => (hiddenView ? setPreview(scene) : void run(scene))}
            >
              <Text className="mood-art">
                <SceneArtwork palette={palette} />
                {source && <Text className="scene-source-badge">{source}</Text>}
                {(active || applying) && (
                  <Text className="scene-active-badge">
                    {applying ? <LoaderCircle size={11} className="spin" /> : <Check size={11} />}
                    {applying ? 'Applying…' : 'Active'}
                  </Text>
                )}
                <Text className="mood-icon">
                  {applying ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : completed === scene.entity_id ? (
                    <Check size={20} />
                  ) : (
                    <SceneIcon name={name} icon={scene.attributes.icon} />
                  )}
                </Text>
                <Text
                  className="scene-swatches"
                  ariaLabel={colors.length ? 'Configured light colors' : 'No scene colors provided'}
                >
                  {colors.map((color, index) => (
                    <Text semantic="swatch" key={index} surfaceTokens={{ background: color }} />
                  ))}
                </Text>
              </Text>
              <Text className="mood-preview">
                <Text semantic="small">{room}</Text>
                <Text semantic="strong">{title}</Text>
                {showAccessoryCount && (
                  <Text>
                    {completed === scene.entity_id
                      ? 'Applied'
                      : count
                        ? `${count} ${count === 1 ? 'accessory' : 'accessories'}`
                        : 'Scene'}
                    {match && completed !== scene.entity_id ? ' · Settings match' : ''}
                  </Text>
                )}
                {!showAccessoryCount && completed === scene.entity_id && <Text>Applied</Text>}
              </Text>
            </Pressable>
            <HausMenu
              open={menuScene === scene.entity_id}
              onOpenChange={(open) => setMenuScene(open ? scene.entity_id : '')}
              placement="bottom"
              items={menuItems}
              trigger={
                <Button
                  isIconOnly
                  variant="ghost"
                  className="mood-details"
                  aria-label={`Options for ${name}${source ? `, ${source}` : ''}`}
                  onPress={() =>
                    setMenuScene((current) => (current === scene.entity_id ? '' : scene.entity_id))
                  }
                >
                  <MoreHorizontal size={17} />
                </Button>
              }
            />
            {hiddenView && (
              <Pressable className="mood-restore" onPress={() => onToggleApp(scene)}>
                <Eye size={14} />
                Restore to Haus
              </Pressable>
            )}
          </Box>
        );
      })}
    </Box>
  );
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
      {library && (
        <>
          <Box className="management-intro">
            <Text className="management-intro-icon">
              <Sparkles size={25} />
            </Text>
            <Box>
              <Text semantic="strong">A different feeling. One tap away.</Text>
              <Text semantic="p">
                Tap a scene to apply it. Use the menu on a card to inspect its settings.
              </Text>
            </Box>
            <Box className="management-actions">
              {snapshot.config?.version === 'haus-hub' && (
                <Button
                  variant="secondary"
                  isDisabled={!snapshot.user.is_admin}
                  onPress={() => setImportOpen(true)}
                >
                  <FileUp size={15} />
                  Import HA scenes
                </Button>
              )}
              <Button
                variant="secondary"
                isDisabled={!demo && !snapshot.user.is_admin}
                onPress={() => setEditing(null)}
              >
                <Sparkles size={15} />
                Create scene
              </Button>
            </Box>
          </Box>
          <Box className="management-toolbar">
            <Text semantic="label" className="management-search">
              <Search size={17} />
              <TextInput
                ariaLabel="Search scenes"
                placeholder="Find a mood or a moment"
                value={query}
                onChange={setQuery}
              />
            </Text>
            <HausSelect
              aria-label="Filter scenes by room"
              value={scope}
              options={[
                { value: 'all', label: 'Every room' },
                { value: 'home', label: 'Whole home' },
                ...model.rooms
                  .filter((r) => scenes.some((s) => placement(s)?.areaId === r.id))
                  .map((r) => ({ value: r.id, label: r.name })),
              ]}
              onChange={setScope}
            />
          </Box>
        </>
      )}
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
      {horizontal ? (
        <ScrollShadow className="mood-scroll" orientation="horizontal" size={24} hideScrollBar>
          {cards(filtered)}
        </ScrollShadow>
      ) : library ? (
        <Box className="scene-room-groups">
          {['home', ...model.rooms.map((r) => r.id)].map((id) => {
            const items = filtered.filter((s) => (placement(s)?.areaId ?? 'home') === id);
            return items.length ? (
              <Box semantic="section" key={id}>
                <Box className="scene-room-heading">
                  <Heading level={2}>
                    {id === 'home' ? 'Whole home' : model.rooms.find((r) => r.id === id)?.name}
                  </Heading>
                  <Text>{items.length} scenes</Text>
                </Box>
                {cards(items)}
              </Box>
            ) : null;
          })}
        </Box>
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
      {preview && (
        <ScenePreviewModal
          scene={preview}
          roomName={roomName(preview)}
          title={presentation(preview).title}
          source={presentation(preview).source}
          targets={targets(preview)}
          snapshot={snapshot}
          hiddenView={hiddenView}
          pending={pending}
          canEdit={demo || snapshot.user.is_admin}
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

function SceneArtwork({ palette }: { palette?: string }) {
  const [layers, setLayers] = useState({
    current: palette,
    previous: undefined as string | undefined,
  });
  if (layers.current !== palette) setLayers({ current: palette, previous: layers.current });
  return (
    <>
      <Text
        className="scene-artwork-layer"
        surfaceTokens={{ backgroundImage: layers.previous }}
        ariaHidden
      />
      <Text
        key={layers.current ?? 'neutral'}
        className="scene-artwork-layer scene-artwork-current"
        surfaceTokens={{ backgroundImage: layers.current }}
        ariaHidden
      />
    </>
  );
}
