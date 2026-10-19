import { ScrollShadow } from '@heroui/react';
import {
  House,
  Sparkles,
  Heart,
  Zap,
  Radio,
  LayoutGrid,
  Cable,
  Box,
  Activity,
  Archive,
  Settings2,
} from 'lucide-react';
import { categoryIcons, roomIconFor } from '../../components/icons/Icon';
import type { HausRoom } from '../../model';
import type { Route } from '../navigation';
import { NavButton } from './NavButton';
type Props = {
  route: Route;
  go: (route: Route) => void;
  categories: { id: string; name: string }[];
  rooms: HausRoom[];
  roomIcons?: Record<string, string>;
  cameraCount: number;
  deviceCount: number;
  hiddenCount: number;
  online: boolean;
  mode: 'live' | 'demo';
};
export function Sidebar({
  route,
  go,
  categories,
  rooms,
  roomIcons,
  cameraCount,
  deviceCount,
  hiddenCount,
  online,
  mode,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="window-handle">
        <span />
        <span />
        <span />
      </div>
      <button className="brand" onClick={() => go({ kind: 'home' })} aria-label="Haus home">
        <House size={30} strokeWidth={1.8} />
        <span>
          haus<span className="brand-dot">.</span>
        </span>
      </button>
      <ScrollShadow className="sidebar-scroll" orientation="vertical" size={28} hideScrollBar>
        <nav aria-label="Main navigation">
          <div className="nav-block">
            <NavButton
              active={route.kind === 'home'}
              icon={<House size={19} />}
              onClick={() => go({ kind: 'home' })}
            >
              Home
            </NavButton>
            <NavButton
              active={route.kind === 'scenes'}
              icon={<Sparkles size={19} />}
              onClick={() => go({ kind: 'scenes' })}
            >
              Scenes
            </NavButton>
            <NavButton
              active={route.kind === 'favorites'}
              icon={<Heart size={19} />}
              onClick={() => go({ kind: 'favorites' })}
            >
              Favorites
            </NavButton>
            <NavButton
              active={route.kind === 'automations'}
              icon={<Zap size={19} />}
              onClick={() => go({ kind: 'automations' })}
            >
              Automations
            </NavButton>
          </div>
          <div className="nav-block">
            <div className="nav-label">YOUR HOME</div>
            {categories.map((c) => {
              const Icon = categoryIcons[c.id];
              return (
                <NavButton
                  key={c.id}
                  active={route.kind === 'category' && route.id === c.id}
                  icon={<Icon size={18} />}
                  onClick={() => go({ kind: 'category', id: c.id })}
                >
                  {c.name}
                </NavButton>
              );
            })}
            <NavButton
              active={route.kind === 'cameras'}
              icon={<Radio size={18} />}
              onClick={() => go({ kind: 'cameras' })}
            >
              Cameras<span className="nav-count">{cameraCount}</span>
            </NavButton>
          </div>
          <div className="nav-block rooms-nav">
            <div className="nav-label">
              ROOMS <span>{rooms.length}</span>
            </div>
            {rooms.map((r) => {
              const Icon = roomIconFor(r.name, roomIcons?.[r.id]);
              return (
                <NavButton
                  key={r.id}
                  active={route.kind === 'room' && route.id === r.id}
                  icon={<Icon size={18} />}
                  onClick={() => go({ kind: 'room', id: r.id })}
                >
                  {r.name}
                </NavButton>
              );
            })}
          </div>
          <div className="nav-block management-nav">
            <div className="nav-label">MANAGE HOME</div>
            <NavButton
              active={route.kind === 'rooms'}
              icon={<House size={18} />}
              onClick={() => go({ kind: 'rooms' })}
            >
              Rooms
            </NavButton>
            <NavButton
              active={route.kind === 'devices'}
              icon={<LayoutGrid size={18} />}
              onClick={() => go({ kind: 'devices' })}
            >
              Devices<span className="nav-count">{deviceCount}</span>
            </NavButton>
            <NavButton
              active={route.kind === 'integrations'}
              icon={<Cable size={18} />}
              onClick={() => go({ kind: 'integrations' })}
            >
              Integrations
            </NavButton>
            <NavButton
              active={route.kind === 'addons'}
              icon={<Box size={18} />}
              onClick={() => go({ kind: 'addons' })}
            >
              Add-ons
            </NavButton>
            <NavButton
              active={route.kind === 'statistics'}
              icon={<Activity size={18} />}
              onClick={() => go({ kind: 'statistics' })}
            >
              Statistics
            </NavButton>
            <NavButton
              active={route.kind === 'hidden'}
              icon={<Archive size={18} />}
              onClick={() => go({ kind: 'hidden' })}
            >
              Hidden<span className="nav-count">{hiddenCount}</span>
            </NavButton>
          </div>
        </nav>
      </ScrollShadow>
      <div className="sidebar-bottom">
        <div className="connected-hint">
          <i className={online ? '' : 'offline'} />
          {mode === 'demo'
            ? 'You’re in the demo home'
            : online
              ? 'Connected to your home'
              : 'Reconnecting to your home'}
        </div>
        <NavButton
          active={route.kind === 'settings' || route.kind === 'nvr'}
          icon={<Settings2 size={18} />}
          onClick={() => go({ kind: 'settings' })}
        >
          Settings<span className="key-hint">⌘ ,</span>
        </NavButton>
        <div className="sidebar-footnote">A little closer to home.</div>
      </div>
    </aside>
  );
}
