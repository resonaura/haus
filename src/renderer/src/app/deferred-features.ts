import { lazy } from 'react';

// Declared once so loading a feature never resets its local state.
export const DeviceControl = lazy(() =>
  import('../features/devices/DeviceControl').then((module) => ({ default: module.DeviceControl })),
);
export const CameraModal = lazy(() =>
  import('../features/cameras/CameraModal').then((module) => ({ default: module.CameraModal })),
);
export const LightGroupControl = lazy(() =>
  import('../features/devices/LightGroupControl').then((module) => ({
    default: module.LightGroupControl,
  })),
);
export const StatisticsPanel = lazy(() =>
  import('../features/statistics/StatisticsPanel').then((module) => ({
    default: module.StatisticsPanel,
  })),
);
export const AddDeviceFlow = lazy(() =>
  import('../features/connections/AddDevice').then((module) => ({ default: module.AddDeviceFlow })),
);
export const ConnectionsPage = lazy(() =>
  import('../features/connections/ConnectionsPage').then((module) => ({
    default: module.ConnectionsPage,
  })),
);
export const DeviceInventory = lazy(() =>
  import('../features/connections/DeviceInventory').then((module) => ({
    default: module.DeviceInventory,
  })),
);
export const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
export const AttentionPage = lazy(() =>
  import('../features/notifications/AttentionPage').then((module) => ({
    default: module.AttentionPage,
  })),
);
export const ConnectDialog = lazy(() =>
  import('../features/connections/ConnectDialog').then((module) => ({
    default: module.ConnectDialog,
  })),
);

export const RoomsPage = lazy(() =>
  import('../features/rooms/RoomsPage').then((module) => ({ default: module.RoomsPage })),
);

export const ServersPage = lazy(() =>
  import('../features/servers/ServersPage').then((module) => ({ default: module.ServersPage })),
);
