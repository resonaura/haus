/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo } from 'react';
import type { EditableKind, ManagementPort, ManagementRequest } from '@haus/core/transport';
import { UnifiedConfigEditorModal } from '@haus/ui/components';
import {
  buildDesktopEditorCatalog,
  toEditableEntitySeed,
} from '../../../../shared/editor-catalog';
import type { HassEntity, Snapshot } from '../../model';

export function ConfigEditor({
  kind,
  asScreen = false,
  entity,
  initialTemplateId,
  snapshot,
  demo,
  onClose,
  onSaved,
}: {
  kind: EditableKind;
  asScreen?: boolean;
  entity?: HassEntity;
  initialTemplateId?: string;
  snapshot: Snapshot;
  demo: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const catalog = useMemo(() => buildDesktopEditorCatalog(snapshot), [snapshot]);
  const seed = useMemo(() => toEditableEntitySeed(entity, snapshot), [entity, snapshot]);

  const management = useMemo<ManagementPort | undefined>(() => {
    const api = window.hausNative;
    if (!api) return undefined;
    return {
      management: <T = unknown,>(input: ManagementRequest) =>
        api.management(input as { method: 'GET' | 'POST' | 'DELETE'; path: string; data?: Record<string, unknown> }) as Promise<T>,
    };
  }, []);

  const runActionRecord = async (action: Record<string, unknown>) => {
    const api = window.hausNative;
    if (!api) throw new Error('Connect your home first.');
    const service = String(action.action ?? action.service ?? '');
    if (!service.includes('.')) return;
    const [domain, method] = service.split('.', 2);
    if (!domain || !method) return;
    const target =
      action.target && typeof action.target === 'object' && !Array.isArray(action.target)
        ? (action.target as Record<string, unknown>)
        : undefined;
    const data =
      action.data && typeof action.data === 'object' && !Array.isArray(action.data)
        ? (action.data as Record<string, unknown>)
        : {};
    await api.request({
      type: 'call_service',
      domain,
      service: method,
      ...(target ? { target } : {}),
      service_data: data,
    });
  };

  return (
    <UnifiedConfigEditorModal
      kind={kind}
      asScreen={asScreen}
      entity={seed}
      initialTemplateId={initialTemplateId}
      templateContext={catalog.templateContext}
      demo={demo}
      management={management}
      devices={catalog.devices}
      scenes={catalog.scenes}
      roomOptions={snapshot.config?.version === 'haus-hub' ? catalog.roomOptions : undefined}
      entityOptions={catalog.entityOptions}
      buttonControllers={catalog.buttonControllers}
      targetPlatform={catalog.targetPlatform}
      resolveDeviceEventEntity={catalog.resolveDeviceEventEntity}
      serviceOptions={catalog.serviceOptions}
      onTestSceneEntities={async (entities) => {
        if (!window.hausNative) throw new Error('Connect your home first.');
        await window.hausNative.request({
          type: 'call_service',
          domain: 'scene',
          service: 'apply',
          service_data: { entities },
        });
      }}
      onTestAutomationActions={async (actions) => {
        for (const action of actions) {
          await runActionRecord(action);
        }
      }}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
