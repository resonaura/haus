import type { ReactNode, RefObject } from 'react';
import { ScrollShadow } from '@heroui/react';
import { Bell, Check, ChevronRight, House, Radio } from 'lucide-react';
import type { HausAccessory, HassEntity, HausModel, HausRoom } from '../../model';
import type { Preferences } from '../../hooks/useHaus';
import type { Route } from '../../app/navigation';
import { Section } from '../../components/ui/Section';
import { EmptyState as Empty } from '../../components/ui/EmptyState';
import { VirtualSections } from '../../components/ui/VirtualSections';
import { RoomIconPicker } from '../rooms/RoomIconPicker';
import { SceneIcon } from '../../components/icons/Icon';
import { isEntityActive } from '../../model/device-appearance';
import { groupNumberedLights } from '../../model/room-devices';
import { sortScenesByName, scenePresentation } from '../../model/scene-presentation';
type Props = {
  mode: 'live' | 'demo';
  preferences: Preferences;
  homeCameras: HassEntity[];
  homeVisibleScenes: HassEntity[];
  sortedHomeScenes: HassEntity[];
  homeQuickControls: HausAccessory[];
  hasHomeFavorites: boolean;
  homeAttention: HausModel['attention'];
  homeRooms: HausRoom[];
  scrollRef: RefObject<HTMLDivElement | null>;
  likelyActiveSceneIds: Set<string>;
  go: (route: Route) => void;
  renderGrid: (
    items: HausAccessory[],
    hidden?: boolean,
    className?: string,
    scope?: string,
  ) => ReactNode;
  renderCameras: (items: HassEntity[], horizontal?: boolean) => ReactNode;
  renderScenes: (items: HassEntity[]) => ReactNode;
  scenesForRoom: (areaId: string, homeView?: boolean) => HassEntity[];
  homeCamerasForRoom: (areaId: string) => HassEntity[];
  setRoomIcon: (areaId: string, icon: string) => void;
  sceneRun: (scene: HassEntity) => Promise<void>;
};
const isActive = (item: HausAccessory) => isEntityActive(item.state);
export function HomeOverview({
  mode,
  preferences,
  homeCameras,
  homeVisibleScenes,
  sortedHomeScenes,
  homeQuickControls,
  hasHomeFavorites,
  homeAttention,
  homeRooms,
  scrollRef,
  likelyActiveSceneIds,
  go,
  renderGrid,
  renderCameras,
  renderScenes,
  scenesForRoom,
  homeCamerasForRoom,
  setRoomIcon,
  sceneRun,
}: Props) {
  return (
    <>
      <Section
        className="home-section-unboxed overview-cameras"
        title="Cameras"
        subtitle={
          homeCameras.length ? `${homeCameras.length} views of home.` : 'Keep an eye on home.'
        }
        action="All cameras"
        onAction={() => go({ kind: 'cameras' })}
      >
        {homeCameras.length ? (
          renderCameras(homeCameras, true)
        ) : (
          <Empty
            icon={<Radio />}
            title="No cameras on Home"
            description="Cameras you add to Home view will appear here."
          />
        )}
      </Section>
      {homeVisibleScenes.length > 0 && (
        <Section
          title="Set the mood"
          subtitle="Tap a scene. Change the atmosphere."
          action="All scenes"
          onAction={() => go({ kind: 'scenes' })}
        >
          {renderScenes(sortedHomeScenes)}
        </Section>
      )}
      <div className="home-primary-grid">
        {homeQuickControls.length > 0 && (
          <Section
            className="home-section-unboxed overview-controls"
            title={hasHomeFavorites ? 'Quick controls' : 'At your fingertips'}
            subtitle={
              hasHomeFavorites
                ? 'Pinned for one-tap access.'
                : mode === 'demo'
                  ? 'Ranked by the changes you make here.'
                  : 'The controls you reach for most.'
            }
            action={hasHomeFavorites ? 'Favorites' : 'Statistics'}
            onAction={() => go(hasHomeFavorites ? { kind: 'favorites' } : { kind: 'statistics' })}
          >
            {renderGrid(homeQuickControls, false, 'accessory-grid home-device-grid', 'home:quick')}
          </Section>
        )}
      </div>
      {homeAttention.length > 0 && (
        <button className="attention-banner" onClick={() => go({ kind: 'attention' })}>
          <span className="attention-icon">
            <Bell size={20} />
          </span>
          <span>
            <strong>A few things to check</strong>
            <small>
              {homeAttention
                .slice(0, 2)
                .map((a) => a.title)
                .join(' · ')}
            </small>
          </span>
          <span className="attention-count">{homeAttention.length}</span>
          <ChevronRight size={19} />
        </button>
      )}
      <div className="home-room-stream" aria-label="Devices by room">
        {homeRooms.length ? (
          <VirtualSections
            items={homeRooms}
            getKey={(item) => item.id}
            scrollRef={scrollRef}
            estimateHeight={(item, columns) =>
              100 +
              Math.ceil(
                groupNumberedLights(
                  item.accessories.filter((a) => !a.primaryEntityId.startsWith('camera.')),
                  preferences.autoGroupLights !== false,
                  preferences.disabledLightGroups,
                ).length / columns,
              ) *
                137
            }
            renderSection={(item) => {
              const roomScenes = sortScenesByName(scenesForRoom(item.id, true), () => item.name);
              const roomDevices = item.accessories.filter(
                (accessory) => !accessory.primaryEntityId.startsWith('camera.'),
              );
              const roomCameraCount = homeCamerasForRoom(item.id).length;
              const activeCount = roomDevices.filter(isActive).length;
              return (
                <section className="device-group home-room-section" key={item.id}>
                  <div className="device-group-heading">
                    <RoomIconPicker
                      name={item.name}
                      value={preferences.roomIcons?.[item.id]}
                      onChange={(icon) => setRoomIcon(item.id, icon)}
                    />
                    <h2>
                      <button
                        className="group-room-link"
                        onClick={() => go({ kind: 'room', id: item.id })}
                      >
                        {item.name}
                        <ChevronRight size={14} />
                      </button>
                    </h2>
                    <span className="device-group-count">
                      {roomDevices.length} devices
                      {roomCameraCount > 0 &&
                        ` · ${roomCameraCount} ${roomCameraCount === 1 ? 'camera' : 'cameras'}`}
                      {activeCount > 0 && ` · ${activeCount} active`}
                    </span>
                    <span className="device-group-rule" />
                  </div>
                  {roomDevices.length > 0 &&
                    renderGrid(roomDevices, false, 'accessory-grid', `home:room:${item.id}`)}
                  {roomScenes.length > 0 && (
                    <ScrollShadow
                      className="room-overview-scenes-scroll"
                      orientation="horizontal"
                      size={22}
                      hideScrollBar
                    >
                      <div className="room-overview-scenes" aria-label={`${item.name} scenes`}>
                        {roomScenes.map((scene) => (
                          <button
                            className={`room-scene-chip ${likelyActiveSceneIds.has(scene.entity_id) ? 'is-likely-active' : ''}`}
                            key={scene.entity_id}
                            aria-label={`${scenePresentation(scene).name}${scenePresentation(scene).source ? ', Hue' : ''}${likelyActiveSceneIds.has(scene.entity_id) ? ', settings match' : ''}`}
                            onClick={() => void sceneRun(scene).catch(() => {})}
                          >
                            <SceneIcon name={String(scene.attributes.friendly_name)} />
                            {scenePresentation(scene, item.name).title}
                            {scenePresentation(scene).source && (
                              <span className="scene-source-badge scene-source-inline">Hue</span>
                            )}
                            {likelyActiveSceneIds.has(scene.entity_id) && (
                              <Check size={12} className="scene-active-check" aria-hidden="true" />
                            )}
                          </button>
                        ))}
                      </div>
                    </ScrollShadow>
                  )}
                </section>
              );
            }}
          />
        ) : (
          <Empty
            icon={<House />}
            title="No rooms yet"
            description="Rooms from Home Assistant will appear here."
          />
        )}
      </div>
    </>
  );
}
