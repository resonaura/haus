import type { ReactNode, RefObject } from 'react';
import { Bell, ChevronRight, House, Radio } from 'lucide-react';
import type { HausAccessory, HassEntity, HausModel, HausRoom } from '../../model';
import type { Preferences } from '../../model/preferences';
import type { Route } from '../../app/navigation';
import { Section } from '../../components/ui/Section';
import { EmptyState as Empty } from '../../components/ui/EmptyState';
import { VirtualSections } from '../../components/ui/VirtualSections';
import { RoomIconPicker } from '../rooms/RoomIconPicker';
import { isEntityActive } from '../../model/device-appearance';
import { groupNumberedLights } from '../../model/room-devices';
type Props = {
  mode: 'live' | 'demo';
  preferences: Preferences;
  homeCameras: HassEntity[];
  sortedHomeScenes: HassEntity[];
  homeQuickControls: HausAccessory[];
  hasHomeFavorites: boolean;
  homeAttention: HausModel['attention'];
  homeRooms: HausRoom[];
  scrollRef: RefObject<HTMLDivElement | null>;
  go: (route: Route) => void;
  renderGrid: (
    items: HausAccessory[],
    hidden?: boolean,
    className?: string,
    scope?: string,
  ) => ReactNode;
  renderCameras: (items: HassEntity[], horizontal?: boolean) => ReactNode;
  renderScenes: (items: HassEntity[]) => ReactNode;
  homeCamerasForRoom: (areaId: string) => HassEntity[];
  setRoomIcon: (areaId: string, icon: string) => void;
};
const isActive = (item: HausAccessory) => isEntityActive(item.state);
export function HomeOverview({
  mode,
  preferences,
  homeCameras,
  sortedHomeScenes,
  homeQuickControls,
  hasHomeFavorites,
  homeAttention,
  homeRooms,
  scrollRef,
  go,
  renderGrid,
  renderCameras,
  renderScenes,
  homeCamerasForRoom,
  setRoomIcon,
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
      {sortedHomeScenes.length > 0 && (
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
