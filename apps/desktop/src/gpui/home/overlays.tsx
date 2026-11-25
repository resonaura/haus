/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { EditableKind, ManagementPort, PendingPairingRequest } from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import {
  ActionMenuDialog,
  PortablePairingRequestDialog,
  SpotlightDialog,
  type SpotlightResultItem,
} from '@haus/ui/components';
import { GpuiCameraModal } from '../camera/modal.js';
import type { GpuiCameraStreams } from '../camera/stream.js';
import type { GpuiCameraApi } from '../camera/transport.js';
import { GpuiAddDeviceModal, type GpuiAddDeviceRequest } from '../management/add-device.js';
import { GpuiConfigEditor } from '../management/config-editor.js';
import type { GpuiRpcRequest } from '../management/integrations.js';
import { GpuiScenePreviewModal } from '../management/scenes.js';
import type { GpuiPlatform } from '../platform.js';
import type { DeviceControl } from './cards.js';
import type { ActiveFallbackMenu } from './menus.js';

export interface CameraModalOverlayProps {
  readonly cameraId: string;
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly allAccessories: readonly HausAccessory[];
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly streaming?: { readonly hub: string; readonly streams: GpuiCameraStreams };
  readonly cameraApi?: GpuiCameraApi;
  readonly fetchSnapshot?: (id: string) => Promise<string | null>;
  readonly onControl: DeviceControl;
  readonly onToggleFullscreen?: () => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onClose: () => void;
}

export interface ScenePreviewOverlayProps {
  readonly scene: HassEntity;
  readonly snapshot: Snapshot;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onApply: () => void;
}

export interface ConfigEditorOverlayProps {
  readonly kind: EditableKind;
  readonly entity?: HassEntity;
  readonly snapshot: Snapshot;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export interface AddDeviceOverlayProps {
  readonly snapshot: Snapshot;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly openExternal?: (url: string) => Promise<void>;
  readonly initialRequest: GpuiAddDeviceRequest;
  readonly onOpenApps: () => void;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}

export function WorkspaceOverlays({
  search,
  query,
  onQueryChange,
  spotlightItems,
  onCloseSearch,
  fallbackMenu,
  onCloseMenu,
  activePairing,
  platform,
  onDismissPairing,
  cameraModal,
  scenePreview,
  configEditor,
  addDevice,
}: {
  readonly search: boolean;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly spotlightItems: readonly SpotlightResultItem[];
  readonly onCloseSearch: () => void;
  readonly fallbackMenu: ActiveFallbackMenu | null;
  readonly onCloseMenu: () => void;
  readonly activePairing: PendingPairingRequest | null;
  readonly platform?: Pick<GpuiPlatform, 'clipboard'>;
  readonly onDismissPairing: (sessionId: string) => void;
  readonly cameraModal?: CameraModalOverlayProps;
  readonly scenePreview?: ScenePreviewOverlayProps;
  readonly configEditor?: ConfigEditorOverlayProps;
  readonly addDevice?: AddDeviceOverlayProps;
}) {
  return (
    <>
      {cameraModal && <GpuiCameraModal key={cameraModal.cameraId} {...cameraModal} />}
      {scenePreview && <GpuiScenePreviewModal {...scenePreview} />}
      {configEditor && <GpuiConfigEditor {...configEditor} />}
      {addDevice && <GpuiAddDeviceModal {...addDevice} />}
      {search && (
        <SpotlightDialog
          query={query}
          onQueryChange={onQueryChange}
          items={spotlightItems}
          onClose={onCloseSearch}
        />
      )}
      {fallbackMenu && (
        <ActionMenuDialog
          title={fallbackMenu.title}
          items={fallbackMenu.items}
          onSelect={fallbackMenu.onSelect}
          onClose={onCloseMenu}
        />
      )}
      {activePairing && (
        <PortablePairingRequestDialog
          request={activePairing}
          onCopy={
            platform?.clipboard
              ? (code) =>
                  platform.clipboard!.writeText(code).then(
                    () => true,
                    () => false,
                  )
              : undefined
          }
          onDismiss={onDismissPairing}
        />
      )}
    </>
  );
}
