import { useState } from 'react';
import { Button, Dropdown, Label, Modal, ScrollShadow, Separator } from '@heroui/react';
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  House,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import type { HassEntity, HausModel, Snapshot } from '../../model';
import { lightColor } from '../../model/light-color';
import { scenePresentation, sceneLightingIsDark } from '../../model/scene-presentation';
import { SceneIcon } from '../../components/icons/Icon';

type Props = {
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
  snapshot,
  model,
  onRun,
  openServer,
  hiddenHomeIds,
  onToggleHome,
  onToggleApp,
  horizontal = false,
  library = false,
  hiddenView = false,
  showAccessoryCount = true,
}: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [preview, setPreview] = useState<HassEntity | null>(null);
  const [pending, setPending] = useState('');
  const [completed, setCompleted] = useState('');
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
    <div className={`scene-collection ${horizontal ? 'scene-collection-rail' : ''}`}>
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
        return (
          <article
            className={`mood-card ${active ? 'is-active-scene' : ''} ${dark ? 'is-dark-scene' : ''}`}
            data-menu-open={menuScene === scene.entity_id || undefined}
            data-pending={applying || undefined}
            key={scene.entity_id}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuScene(scene.entity_id);
            }}
          >
            <button
              className="mood-activate"
              aria-label={`${hiddenView ? 'Details for' : 'Apply'} ${name}${source ? `, ${source}` : ''}${active ? ', active settings' : ''}`}
              title={`${hiddenView ? 'Details for' : 'Apply'} ${name}`}
              aria-busy={applying}
              disabled={!hiddenView && (applying || scene.state === 'unavailable')}
              onClick={() => (hiddenView ? setPreview(scene) : void run(scene))}
            >
              <span className="mood-art">
                <SceneArtwork palette={palette} />
                {source && <span className="scene-source-badge">{source}</span>}
                {(active || applying) && (
                  <span className="scene-active-badge">
                    {applying ? <LoaderCircle size={11} className="spin" /> : <Check size={11} />}
                    {applying ? 'Applying…' : 'Active'}
                  </span>
                )}
                <span className="mood-icon">
                  {applying ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : completed === scene.entity_id ? (
                    <Check size={20} />
                  ) : (
                    <SceneIcon name={name} />
                  )}
                </span>
                <span
                  className="scene-swatches"
                  aria-label={
                    colors.length ? 'Configured light colors' : 'No scene colors provided'
                  }
                >
                  {colors.map((color, index) => (
                    <i key={index} style={{ background: color }} />
                  ))}
                </span>
              </span>
              <span className="mood-preview">
                <small>{room}</small>
                <strong>{title}</strong>
                {showAccessoryCount && (
                  <span>
                    {completed === scene.entity_id
                      ? 'Applied'
                      : count
                        ? `${count} ${count === 1 ? 'accessory' : 'accessories'}`
                        : 'Scene'}
                    {match && completed !== scene.entity_id ? ' · Settings match' : ''}
                  </span>
                )}
                {!showAccessoryCount && completed === scene.entity_id && <span>Applied</span>}
              </span>
            </button>
            <Dropdown
              isOpen={menuScene === scene.entity_id}
              onOpenChange={(open) => setMenuScene(open ? scene.entity_id : '')}
            >
              <Button
                isIconOnly
                variant="ghost"
                className="mood-details"
                aria-label={`Options for ${name}${source ? `, ${source}` : ''}`}
              >
                <MoreHorizontal size={17} />
              </Button>
              <Dropdown.Popover className="scene-options-popover" placement="bottom end">
                <Dropdown.Menu
                  aria-label={`Scene options for ${name}`}
                  onAction={(key) => {
                    setMenuScene('');
                    if (key === 'details') setPreview(scene);
                    else if (key === 'home') onToggleHome(scene);
                    else if (key === 'app') onToggleApp(scene);
                  }}
                >
                  <Dropdown.Item id="details" textValue="Scene details">
                    <Info size={16} />
                    <Label>Scene details</Label>
                  </Dropdown.Item>
                  <Separator />
                  {!hiddenView && (
                    <Dropdown.Item
                      id="home"
                      textValue={
                        hiddenHomeIds.has(scene.entity_id)
                          ? 'Show on Home view'
                          : 'Hide from Home view'
                      }
                    >
                      <House size={16} />
                      <Label>
                        {hiddenHomeIds.has(scene.entity_id)
                          ? 'Show on Home view'
                          : 'Hide from Home view'}
                      </Label>
                    </Dropdown.Item>
                  )}
                  <Dropdown.Item
                    id="app"
                    textValue={hiddenView ? 'Restore to Haus' : 'Hide from Haus'}
                  >
                    {hiddenView ? <Eye size={16} /> : <EyeOff size={16} />}
                    <Label>{hiddenView ? 'Restore to Haus' : 'Hide from Haus'}</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            {hiddenView && (
              <button className="mood-restore" onClick={() => onToggleApp(scene)}>
                <Eye size={14} />
                Restore to Haus
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
  return (
    <div className="scenes-workspace">
      {library && (
        <>
          <div className="management-intro">
            <span className="management-intro-icon">
              <Sparkles size={25} />
            </span>
            <div>
              <strong>A different feeling. One tap away.</strong>
              <p>Tap a scene to apply it. Use the menu on a card to inspect its settings.</p>
            </div>
            <Button variant="secondary" onPress={() => openServer('/config/scene/dashboard')}>
              <ExternalLink size={15} />
              Manage scenes
            </Button>
          </div>
          <div className="management-toolbar">
            <label className="management-search">
              <Search size={17} />
              <input
                aria-label="Search scenes"
                placeholder="Find a mood or a moment"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter scenes by room"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">Every room</option>
              <option value="home">Whole home</option>
              {model.rooms
                .filter((r) => scenes.some((s) => placement(s)?.areaId === r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {horizontal ? (
        <ScrollShadow className="mood-scroll" orientation="horizontal" size={24} hideScrollBar>
          {cards(filtered)}
        </ScrollShadow>
      ) : library ? (
        <div className="scene-room-groups">
          {['home', ...model.rooms.map((r) => r.id)].map((id) => {
            const items = filtered.filter((s) => (placement(s)?.areaId ?? 'home') === id);
            return items.length ? (
              <section key={id}>
                <div className="scene-room-heading">
                  <h2>
                    {id === 'home' ? 'Whole home' : model.rooms.find((r) => r.id === id)?.name}
                  </h2>
                  <span>{items.length} scenes</span>
                </div>
                {cards(items)}
              </section>
            ) : null;
          })}
        </div>
      ) : (
        cards(filtered)
      )}
      {!filtered.length && (
        <div className="management-empty">
          <Sparkles size={28} />
          <h3>{scenes.length ? 'No scenes match' : 'Set the feeling of home'}</h3>
          <p>
            {scenes.length
              ? 'Try another room or scene name.'
              : 'Create a scene in Home Assistant to bring your favorite device settings together.'}
          </p>
        </div>
      )}
      {preview && (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
        >
          <Modal.Backdrop variant="blur">
            <Modal.Container size="lg">
              <Modal.Dialog className="haus-dialog scene-preview-dialog">
                <Modal.CloseTrigger />
                <Modal.Header>
                  <span className="flow-eyebrow">SCENE DETAILS · {roomName(preview)}</span>
                  <Modal.Heading>{presentation(preview).title}</Modal.Heading>
                  {presentation(preview).source && (
                    <span className="scene-source-badge scene-source-inline">
                      {presentation(preview).source}
                    </span>
                  )}
                </Modal.Header>
                <Modal.Body>
                  <p className="flow-description">
                    These are the targets reported by Home Assistant. Previewing does not change
                    your devices.
                  </p>
                  <div className="scene-target-list">
                    {targets(preview).map(({ id, setting }) => {
                      const current = snapshot.states.find((s) => s.entity_id === id);
                      const values =
                        setting && typeof setting === 'object'
                          ? (setting as Record<string, unknown>)
                          : undefined;
                      const attributes =
                        values?.attributes && typeof values.attributes === 'object'
                          ? (values.attributes as Record<string, unknown>)
                          : values;
                      const state = typeof setting === 'string' ? setting : values?.state;
                      const brightness = attributes?.brightness;
                      const color = attributes
                        ? lightColor({ entity_id: id, state: 'on', attributes, last_changed: '' })
                        : undefined;
                      return (
                        <div key={id}>
                          <span
                            className="scene-target-icon"
                            style={color ? { background: color } : undefined}
                          />
                          <span>
                            <strong>{String(current?.attributes.friendly_name ?? id)}</strong>
                            <small>
                              {state !== undefined ? String(state) : 'Target setting not supplied'}
                              {typeof brightness === 'number'
                                ? ` · ${Math.round(brightness / 2.55)}% brightness`
                                : ''}
                            </small>
                          </span>
                          <span className="scene-current">
                            Now: {current?.state ?? 'No live state'}
                          </span>
                        </div>
                      );
                    })}
                    {!targets(preview).length && (
                      <p>
                        This integration does not expose scene targets. You can inspect the scene in
                        Home Assistant.
                      </p>
                    )}
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={() => openServer('/config/scene/dashboard')}>
                    Edit in Home Assistant <ExternalLink size={14} />
                  </Button>
                  {hiddenView ? (
                    <Button
                      onPress={() => {
                        onToggleApp(preview);
                        setPreview(null);
                      }}
                    >
                      <Eye size={14} />
                      Restore to Haus
                    </Button>
                  ) : (
                    <Button
                      isDisabled={Boolean(pending) || preview.state === 'unavailable'}
                      isPending={pending === preview.entity_id}
                      onPress={() => void run(preview)}
                    >
                      <Play size={14} />
                      Apply scene
                    </Button>
                  )}
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}
    </div>
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
      <span
        className="scene-artwork-layer"
        style={{ backgroundImage: layers.previous }}
        aria-hidden
      />
      <span
        key={layers.current ?? 'neutral'}
        className="scene-artwork-layer scene-artwork-current"
        style={{ backgroundImage: layers.current }}
        aria-hidden
      />
    </>
  );
}
