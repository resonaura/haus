/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import type { KeyEvent } from '@gpuix/react';
import type { AlertsTransport, ManagementPort } from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import type { Preferences } from '@haus/ha/view/preferences';
import type { SidebarBackdrop } from '../../platform/sidebar.js';
import type { GpuiCameraStreams } from '../camera/stream.js';
import type { GpuiCameraApi } from '../camera/transport.js';
import type { GpuiSystemPorts } from '../management/servers-port.js';
import type { GpuiPlatform } from '../platform.js';
import type { HomeRoute } from '../shell.js';
import type { DeviceControl } from './cards.js';
import type { StatisticsRequest } from './history.js';
import type { HomeSessionStatusInfo } from './settings-view.js';

export const NON_DEVICE_ROUTES = new Set<HomeRoute>([
  'attention',
  'settings',
  'statistics',
  'cameras',
  'devices',
  'integrations',
  'addons',
  'servers',
  'hidden',
]);

export interface HomeWorkspaceProps {
  snapshot: Snapshot;
  preferences: Preferences;
  systemTheme?: 'light' | 'dark';
  reducedTransparency?: boolean;
  platform?: Pick<
    GpuiPlatform,
    'clipboard' | 'showContextMenu' | 'openExternal' | 'openPaths' | 'toggleFullscreen'
  >;
  alertsTransport?: AlertsTransport;
  management?: ManagementPort;
  system?: GpuiSystemPorts;
  subscribeKeyDown?: (listener: (event: KeyEvent) => void) => () => void;
  sidebar?: SidebarBackdrop;
  streaming?: { hub: string; streams: GpuiCameraStreams };
  cameraApi?: GpuiCameraApi;
  demo?: boolean;
  disabled?: boolean;
  canFavorite?: boolean;
  registry?: Pick<
    RegistryController,
    'saveRoom' | 'deleteRoom' | 'moveDevices' | 'updateDevice' | 'updateEntity'
  >;
  statistics?: StatisticsRequest;
  fetchCameraSnapshot?: (id: string) => Promise<string | null>;
  onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  sessionMeta?: HomeSessionStatusInfo;
  notice?: ReactNode;
  onControl: DeviceControl;
  onFavorite: (id: string, favorite: boolean) => void;
  onTheme: (theme: Preferences['theme']) => void;
  onGrouping: (enabled: boolean) => void;
  onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  onResetLightGroups?: () => void;
  onToggleDemo?: (enabled: boolean) => void;
  onManage?: (url: string) => void;
  onConnect?: () => void;
  onRefresh?: () => void;
  onDisconnect?: () => void;
}
