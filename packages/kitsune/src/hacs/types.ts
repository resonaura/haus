/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Reading } from '@haus/core/types';
import type { HausDevice, SystemIssue, ActionableNotification } from '@haus/core/device';

export interface HacsIntegrationConfig {
  domain: string;
  entryId: string;
  data: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface HacsEntityPayload {
  entityId: string;
  uniqueId?: string;
  name: string;
  domain: string;
  state: string | number | boolean | null;
  attributes: Record<string, unknown>;
  deviceId?: string;
  areaId?: string;
}

export interface HacsEntityUpdatePayload {
  entityId: string;
  state: string | number | boolean | null;
  attributes?: Record<string, unknown>;
}

export interface HacsServiceCallPayload {
  domain: string;
  service: string;
  serviceData?: Record<string, unknown>;
}

export interface HacsVirtualizerEvents {
  deviceDiscovered: (device: HausDevice) => void;
  deviceStateChanged: (deviceId: string, readings: Record<string, Reading>) => void;
  deviceAvailabilityChanged: (
    deviceId: string,
    availability: 'online' | 'offline' | 'unknown',
  ) => void;
  issueCreated: (issue: SystemIssue) => void;
  notificationCreated: (notification: ActionableNotification) => void;
}
