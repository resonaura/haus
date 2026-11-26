/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box as UiBox, HausScrollArea, Pressable, SCROLL_SHADOW_PRESETS, Text } from '@haus/ui';
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
  ScrollText,
  TerminalSquare,
  Plus,
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
  hubLogs?: boolean;
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
  onCreateRoom?: () => void;
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
  onCreateRoom,
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
    <UiBox semantic="aside" className="sidebar">
      <UiBox className="window-handle">
        <Text />
        <Text />
        <Text />
      </UiBox>
      <UiBox
        className={`sidebar-context-viewport ${sliding ? 'is-sliding' : ''}`}
        dataAttrs={{ 'data-server-open': String(serverOpen) }}
      >
        <UiBox className="sidebar-context-track">
          <UiBox
            className="sidebar-context-pane"
            inert={Boolean(serverContext)}
            ariaHidden={Boolean(serverContext)}
          >
            <HausScrollArea
              className="sidebar-scroll"
              orientation="vertical"
              size={SCROLL_SHADOW_PRESETS.sidebar}
              hideScrollBar
            >
              <UiBox semantic="nav" ariaLabel="Main navigation">
                <UiBox className="nav-block">
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
                </UiBox>
                <UiBox className="nav-block">
                  <UiBox className="nav-label">YOUR HOME</UiBox>
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
                </UiBox>
                <UiBox className="nav-block rooms-nav">
                  <UiBox className="nav-label">
                    ROOMS <Text>{rooms.length}</Text>
                    {onCreateRoom && (
                      <Pressable
                        type="button"
                        className="nav-label-add"
                        ariaLabel="New room"
                        title="New room"
                        onPress={onCreateRoom}
                      >
                        <Plus size={12} />
                      </Pressable>
                    )}
                  </UiBox>
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
                </UiBox>
                <UiBox className="nav-block management-nav">
                  <UiBox className="nav-label">MANAGE HOME</UiBox>
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
                    Devices<Text className="nav-count">{deviceCount}</Text>
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
                    Apps
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
                    Hidden<Text className="nav-count">{hiddenCount}</Text>
                  </NavButton>
                </UiBox>
              </UiBox>
            </HausScrollArea>
            <UiBox className="sidebar-bottom">
              <NavButton
                active={route.kind === 'settings'}
                icon={<Settings2 size={18} />}
                onClick={() => go({ kind: 'settings' })}
              >
                Settings<Text className="key-hint">⌘ ,</Text>
              </NavButton>
              <UiBox className="sidebar-footnote">A little closer to home.</UiBox>
            </UiBox>
          </UiBox>
          <UiBox
            className="sidebar-context-pane"
            inert={!serverContext}
            ariaHidden={!serverContext}
          >
            <HausScrollArea
              className="sidebar-scroll sidebar-server-scroll"
              orientation="vertical"
              size={SCROLL_SHADOW_PRESETS.sidebar}
              hideScrollBar
            >
              {context && (
                <UiBox
                  semantic="nav"
                  className="sidebar-server-nav"
                  ariaLabel={`${context.name} navigation`}
                >
                  <Pressable className="sidebar-server-back" onPress={context.onBack}>
                    <ArrowLeft size={18} />
                    <Text>Servers</Text>
                  </Pressable>
                  <UiBox className="sidebar-server-heading">
                    <Text>
                      {context.icon ?? <Server size={22} />}
                      <Text
                        semantic="swatch"
                        className="sidebar-server-status"
                        dataAttrs={{ 'data-status': context.status }}
                        role="img"
                        ariaLabel={`Server ${context.status}`}
                      />
                    </Text>
                    <UiBox>
                      <Text semantic="small">HOME SERVER</Text>
                      <Text semantic="strong">{context.name}</Text>
                    </UiBox>
                  </UiBox>
                  <UiBox className="nav-block">
                    {[
                      { id: 'overview', label: 'Overview', icon: Gauge },
                      { id: 'storage', label: 'Disks', icon: HardDrive },
                      { id: 'services', label: 'Services', icon: Boxes },
                      { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
                      ...(context.hubLogs ? [{ id: 'logs', label: 'Logs', icon: ScrollText }] : []),
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
                  </UiBox>
                </UiBox>
              )}
            </HausScrollArea>
          </UiBox>
        </UiBox>
      </UiBox>
    </UiBox>
  );
}
