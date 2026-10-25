import { ScrollShadow } from '@heroui/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  House,
  Sparkles,
  Heart,
  Zap,
  LayoutGrid,
  Cable,
  Box,
  Activity,
  Archive,
  Settings2,
  Server,
  ArrowLeft,
  Gauge,
  HardDrive,
  Boxes,
  Video,
  TerminalSquare,
} from 'lucide-react';
import { categoryIcons, roomIconFor } from '../../components/icons/Icon';
import type { HausRoom } from '../../model';
import type { Route } from '../navigation';
import { NavButton } from './NavButton';
import './sidebar-server.scss';
type ServerContext = {
  name: string;
  icon?: ReactNode;
  status: 'online' | 'offline' | 'paused' | 'unknown';
  activeTab: string;
  admin: boolean;
  nvr?: boolean;
  onTabChange: (tab: string) => void;
  onBack: () => void;
};
type Props = {
  route: Route;
  go: (route: Route) => void;
  categories: { id: string; name: string }[];
  rooms: HausRoom[];
  roomIcons?: Record<string, string>;
  cameraCount: number;
  deviceCount: number;
  hiddenCount: number;
  serverContext?: ServerContext;
};
export function Sidebar({
  route,
  go,
  categories,
  rooms,
  roomIcons,
  deviceCount,
  hiddenCount,
  serverContext,
}: Props) {
  // Retain the outgoing navigation while it slides out; the material and its host never unmount.
  const [lastServerContext, setLastServerContext] = useState(serverContext);
  const [sliding, setSliding] = useState(false);
  const serverOpen = Boolean(serverContext);
  const wasOpen = useRef(serverOpen);
  useEffect(() => {
    if (wasOpen.current === serverOpen) return;
    wasOpen.current = serverOpen;
    setSliding(true);
    const timer = setTimeout(() => setSliding(false), 340);
    return () => clearTimeout(timer);
  }, [serverOpen]);
  useEffect(() => {
    if (serverContext) setLastServerContext(serverContext);
  }, [serverContext]);
  const context = serverContext ?? lastServerContext;
  const yourHome = categories.some((category) => category.id === 'other')
    ? categories.flatMap((category) =>
        category.id === 'other' ? [{ id: 'servers', name: 'Servers' }, category] : [category],
      )
    : [...categories, { id: 'servers', name: 'Servers' }];
  return (
    <aside className="sidebar">
      <div className="window-handle">
        <span />
        <span />
        <span />
      </div>
      <div
        className={`sidebar-context-viewport ${sliding ? 'is-sliding' : ''}`}
        data-server-open={serverOpen}
      >
        <div className="sidebar-context-track">
          <div
            className="sidebar-context-pane"
            inert={Boolean(serverContext)}
            aria-hidden={Boolean(serverContext)}
          >
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
                  {yourHome.map((c) => {
                    if (c.id === 'servers')
                      return (
                        <NavButton
                          key="servers"
                          active={route.kind === 'servers' || route.kind === 'nvr'}
                          icon={<Server size={18} />}
                          onClick={() => go({ kind: 'servers' })}
                        >
                          Servers
                        </NavButton>
                      );
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
              <NavButton
                active={route.kind === 'settings'}
                icon={<Settings2 size={18} />}
                onClick={() => go({ kind: 'settings' })}
              >
                Settings<span className="key-hint">⌘ ,</span>
              </NavButton>
              <div className="sidebar-footnote">A little closer to home.</div>
            </div>
          </div>
          <div className="sidebar-context-pane" inert={!serverContext} aria-hidden={!serverContext}>
            <ScrollShadow
              className="sidebar-scroll sidebar-server-scroll"
              orientation="vertical"
              size={28}
              hideScrollBar
            >
              {context && (
                <nav className="sidebar-server-nav" aria-label={`${context.name} navigation`}>
                  <button className="sidebar-server-back" onClick={context.onBack}>
                    <ArrowLeft size={18} />
                    <span>Servers</span>
                  </button>
                  <div className="sidebar-server-heading">
                    <span>
                      {context.icon ?? <Server size={22} />}
                      <i
                        className="sidebar-server-status"
                        data-status={context.status}
                        role="img"
                        aria-label={`Server ${context.status}`}
                      />
                    </span>
                    <div>
                      <small>HOME SERVER</small>
                      <strong>{context.name}</strong>
                    </div>
                  </div>
                  <div className="nav-block">
                    {[
                      { id: 'overview', label: 'Overview', icon: Gauge },
                      { id: 'storage', label: 'Disks', icon: HardDrive },
                      { id: 'services', label: 'Services', icon: Boxes },
                      { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
                      ...(context.nvr !== false
                        ? [{ id: 'backups', label: 'NVR', icon: Video }]
                        : []),
                      ...(context.admin
                        ? [{ id: 'settings', label: 'Settings', icon: Settings2 }]
                        : []),
                    ].map(({ id, label, icon: Icon }) => (
                      <NavButton
                        key={id}
                        active={context.activeTab === id}
                        icon={<Icon size={18} />}
                        onClick={() => context.onTabChange(id)}
                      >
                        {label}
                      </NavButton>
                    ))}
                  </div>
                </nav>
              )}
            </ScrollShadow>
          </div>
        </div>
      </div>
    </aside>
  );
}
