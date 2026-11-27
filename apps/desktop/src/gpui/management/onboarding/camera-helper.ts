/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { CAMERA_SETUP_DOMAINS, type BrandCatalogItem } from '@haus/core/transport';
import { evaluateFlowStep } from '@haus/ha/flow';
import type { Snapshot } from '@haus/ha/types';
import type {
  CameraExistingOption,
  EcosystemPluginInstallInfo,
  FlowUnsupportedInfo,
} from '@haus/ui/components';
import type { FlowStepRecord } from '@haus/core/transport';

export function buildCameraDomainSet(snapshot: Snapshot): ReadonlySet<string> {
  const out = new Set<string>(CAMERA_SETUP_DOMAINS);
  for (const entry of snapshot.entities) {
    if (entry.entity_id.startsWith('camera.') && entry.platform) {
      out.add(entry.platform);
    }
  }
  return out;
}

export function buildExistingCameraOptions(snapshot: Snapshot): readonly CameraExistingOption[] {
  const stateById = new Map(snapshot.states.map((s) => [s.entity_id, s]));
  const deviceById = new Map(snapshot.devices.map((d) => [d.id, d]));
  return snapshot.entities
    .filter(
      (entry) =>
        entry.entity_id.startsWith('camera.') &&
        !entry.disabled_by &&
        !entry.entity_id.endsWith('_internal'),
    )
    .map((entry) => {
      const state = stateById.get(entry.entity_id);
      const device = entry.device_id ? deviceById.get(entry.device_id) : undefined;
      const friendly =
        typeof state?.attributes?.friendly_name === 'string'
          ? state.attributes.friendly_name
          : undefined;
      const areaId = entry.area_id ?? device?.area_id ?? undefined;
      return {
        entityId: entry.entity_id,
        name: entry.name || friendly || entry.entity_id,
        ...(areaId ? { areaId } : {}),
      };
    });
}

export function pluginInfoFromDriver(driver: BrandCatalogItem): EcosystemPluginInstallInfo | null {
  if (
    !driver.appId ||
    (driver.runtime !== 'hacs' &&
      driver.runtime !== 'homebridge' &&
      driver.runtime !== 'scrypted' &&
      driver.runtime !== 'docker')
  ) {
    return null;
  }
  return {
    appId: driver.appId,
    title: driver.title,
    runtime: driver.runtime,
    ...(driver.packageName ? { packageName: driver.packageName } : {}),
    ...(driver.description ? { description: driver.description } : {}),
    ...(driver.verified ? { verified: true } : {}),
    ...(driver.documentationUrl ? { documentationUrl: driver.documentationUrl } : {}),
    ...(driver.repositoryUrl ? { repositoryUrl: driver.repositoryUrl } : {}),
    ...(driver.hacsRepositoryId ? { hacsRepositoryId: driver.hacsRepositoryId } : {}),
    ...(driver.domain ? { hacsDomain: driver.domain } : {}),
  };
}

export function assessLiveFlowStep(
  step: FlowStepRecord | null,
  isHubSession: boolean,
  demo: boolean,
): FlowUnsupportedInfo | null {
  if (!step || demo) return null;
  const assessment = evaluateFlowStep(step as Parameters<typeof evaluateFlowStep>[0], {
    mode: isHubSession ? 'standalone-hub' : 'remote-ha',
  });
  if (assessment.status !== 'unsupported') return null;
  return {
    reason:
      assessment.fallbackReason ??
      `The setup flow for ${step.handler} requires Home Assistant Web controls.`,
    requirements: assessment.unsupportedRequirements,
    ...(assessment.fallbackUrl ? { fallbackUrl: assessment.fallbackUrl } : {}),
  };
}
